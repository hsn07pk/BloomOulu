/**
 * "Me" endpoints — per-user state that the donor's browser reads + writes.
 *
 *   GET    /v1/me/profile            → donor's own profile fields
 *   PATCH  /v1/me/profile            → update name/locale/homeRegion/marketing
 *   GET    /v1/me/saved              → list of saved plants for the donor
 *   PUT    /v1/me/saved/:slug        → upsert a bookmark (idempotent)
 *   DELETE /v1/me/saved/:slug        → remove a bookmark (no-op if absent)
 *   POST   /v1/me/saved/sync         → bulk merge from the anonymous-localStorage
 *                                      shadow list (called on first sign-in)
 *
 * Auth: every endpoint requires a signed Bearer JWT (the bloomoulu.session
 * cookie content forwarded by the web's server-side proxy). RolesGuard
 * additionally rejects subjects whose User.deactivatedAt is set.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { LocaleEnum } from '@bloomoulu/constants';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PatchProfile = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  locale: LocaleEnum.optional(),
  homeRegion: z.string().max(32).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
});

/**
 * Per-user accessibility preferences. Lives under
 * `User.preferences.a11y` as a JSON sub-object. All fields optional; the
 * client sends only what changed, server merges. Closed enum so the
 * Json column can't drift into junk values.
 */
const A11yPrefs = z.object({
  textSize: z.enum(['small', 'normal', 'large']).optional(),
  contrast: z.enum(['normal', 'high']).optional(),
  motion: z.enum(['normal', 'reduced']).optional(),
});
type A11yPrefs = z.infer<typeof A11yPrefs>;

@Controller('me')
@Roles('donor', 'curator', 'finance', 'admin')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Donor's own profile. Returns just the safe-to-render fields. */
  @Get('profile')
  async profile(@CurrentUser() actor: AuthenticatedUser) {
    const userId = actor.sub;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        role: true,
        homeRegion: true,
        preferences: true,
        emailVerified: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  /** Donor edits their own profile. Whitelist of fields only — name,
   *  locale, homeRegion, marketingOptIn. Role/email/emailVerified/etc.
   *  cannot be touched here (admin-only via /v1/admin/users). */
  @Patch('profile')
  async patchProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(PatchProfile)) body: z.infer<typeof PatchProfile>,
  ) {
    const userId = actor.sub;
    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, locale: true, homeRegion: true, preferences: true },
    });
    if (!before) throw new NotFoundException();

    const prefs = (typeof before.preferences === 'object' && before.preferences !== null
      ? (before.preferences as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const nextPrefs =
      body.marketingOptIn === undefined ? prefs : { ...prefs, marketingOptIn: body.marketingOptIn };

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: body.name === undefined ? undefined : body.name,
        locale: body.locale,
        homeRegion: body.homeRegion === undefined ? undefined : body.homeRegion,
        preferences: body.marketingOptIn === undefined ? undefined : (nextPrefs as never),
      },
      select: {
        id: true, email: true, name: true, locale: true, homeRegion: true,
        preferences: true, role: true, createdAt: true,
      },
    });
    // ADR-0001 §"Robustness": every donor-initiated mutation is audited.
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'me.profile.patch',
        resource: `User/${userId}`,
        before,
        after: { name: updated.name, locale: updated.locale, homeRegion: updated.homeRegion, preferences: updated.preferences },
      },
    });
    return updated;
  }

  /**
   * Read the donor's accessibility preferences. Empty object when the user
   * has never opened the a11y panel yet — the client treats missing fields
   * as "normal" and lets localStorage be authoritative until the user picks
   * something.
   */
  @Get('a11y')
  async getA11y(@CurrentUser() actor: AuthenticatedUser): Promise<A11yPrefs> {
    const userId = actor.sub;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!user) throw new NotFoundException();
    const prefs = (typeof user.preferences === 'object' && user.preferences !== null
      ? (user.preferences as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const a11y = (typeof prefs['a11y'] === 'object' && prefs['a11y'] !== null
      ? (prefs['a11y'] as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    // Defensive parse — the JSON column could in theory contain anything
    // from older clients; A11yPrefs strips unknown fields and rejects junk.
    const parsed = A11yPrefs.safeParse(a11y);
    return parsed.success ? parsed.data : {};
  }

  /**
   * Merge accessibility preferences into the user's preferences JSON.
   * Sparse — clients send only changed fields. Each call is one update
   * statement; no audit log entry (these are personal display choices,
   * not financial / GDPR-sensitive data).
   */
  @Patch('a11y')
  async patchA11y(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(A11yPrefs)) body: A11yPrefs,
  ): Promise<A11yPrefs> {
    const userId = actor.sub;
    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!before) throw new NotFoundException();
    const prefs = (typeof before.preferences === 'object' && before.preferences !== null
      ? (before.preferences as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const currentA11y = (typeof prefs['a11y'] === 'object' && prefs['a11y'] !== null
      ? (prefs['a11y'] as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const nextA11y = { ...currentA11y, ...body };
    const nextPrefs = { ...prefs, a11y: nextA11y };
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: nextPrefs as never },
    });
    // Return the merged shape so the client doesn't have to refetch.
    const parsed = A11yPrefs.safeParse(nextA11y);
    return parsed.success ? parsed.data : {};
  }

  @Get('saved')
  async list(@CurrentUser() actor: AuthenticatedUser) {
    const userId = actor.sub;
    const rows = await this.prisma.savedPlant.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
      take: 200,
      include: {
        plant: {
          include: {
            primaryImage: true,
            taxon: { select: { latinName: true, family: true } },
          },
        },
      },
    });
    return { items: rows };
  }

  @Put('saved/:slug')
  async save(@Param('slug') slug: string, @CurrentUser() actor: AuthenticatedUser) {
    const userId = actor.sub;
    const plant = await this.prisma.plant.findUnique({ where: { slug }, select: { id: true } });
    if (!plant) throw new NotFoundException();
    // Check first so we only bump the denormalized Plant.saveCount on a
    // true insert (not on an idempotent re-save of an already-saved row).
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.savedPlant.findUnique({
        where: { userId_plantId: { userId, plantId: plant.id } },
      });
      if (existing) return existing;
      const created = await tx.savedPlant.create({
        data: { userId, plantId: plant.id },
      });
      await tx.plant.update({
        where: { id: plant.id },
        data: { saveCount: { increment: 1 } },
      });
      return created;
    });
    return { ok: true, id: row.id, savedAt: row.savedAt };
  }

  @Delete('saved/:slug')
  async remove(@Param('slug') slug: string, @CurrentUser() actor: AuthenticatedUser) {
    const userId = actor.sub;
    const plant = await this.prisma.plant.findUnique({ where: { slug }, select: { id: true } });
    if (!plant) return { ok: true, deleted: 0 };
    // Decrement only by what was actually deleted — handles the case where
    // the row was already gone (idempotent unsave) without going negative.
    // Using GREATEST(0, …) as a safety net against drift.
    const deleted = await this.prisma.$transaction(async (tx) => {
      const r = await tx.savedPlant.deleteMany({
        where: { userId, plantId: plant.id },
      });
      if (r.count > 0) {
        await tx.$executeRaw`
          UPDATE "Plant"
          SET "saveCount" = GREATEST(0, "saveCount" - ${r.count})
          WHERE id = ${plant.id}::uuid
        `;
      }
      return r.count;
    });
    return { ok: true, deleted };
  }

  /**
   * Bulk merge for the anonymous → signed-in handoff. The frontend reads
   * its localStorage shadow on first sign-in and posts the slug list once.
   * Already-saved rows are left alone (upsert + skipDuplicates semantics).
   */
  @Post('saved/sync')
  async sync(@CurrentUser() actor: AuthenticatedUser, @Body() body: { slugs: string[] }) {
    const userId = actor.sub;
    if (!Array.isArray(body.slugs) || body.slugs.length === 0) return { ok: true, merged: 0 };
    const plants = await this.prisma.plant.findMany({
      where: { slug: { in: body.slugs.slice(0, 200) } },
      select: { id: true },
    });
    if (plants.length === 0) return { ok: true, merged: 0 };
    const data = plants.map((p) => ({ userId, plantId: p.id }));
    // createMany returns how many rows it actually inserted (the rest were
    // skipped as duplicates) but doesn't tell us which specific plantIds got
    // a new row. We recompute saveCount from SavedPlant for every plant in
    // the input — accurate regardless of which were dupes. Single update,
    // bounded by the 200-slug cap.
    const merged = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.savedPlant.createMany({ data, skipDuplicates: true });
      if (inserted.count > 0) {
        const ids = plants.map((p) => p.id);
        await tx.$executeRaw`
          UPDATE "Plant" p
          SET "saveCount" = (
            SELECT COUNT(*)::int FROM "SavedPlant" sp WHERE sp."plantId" = p.id
          )
          WHERE p.id = ANY(${ids}::uuid[])
        `;
      }
      return inserted.count;
    });
    return { ok: true, merged };
  }

  /**
   * Unified donor-activity timeline for the MyGarden page.
   *
   * Aggregates four event sources that already live in the DB:
   *   - Adoption.createdAt           (kind: 'adoption_created')
   *   - Payment.createdAt + succeeded (kind: 'payment_succeeded')
   *   - AskMessage.createdAt          (kind: 'ask_asked')
   *   - SavedPlant.savedAt            (kind: 'plant_saved')
   *
   * Each source is queried for its top `limit` rows (so 4 × limit = 80
   * candidates max for the default), the union is sorted ts-DESC, and
   * the top `limit` is returned. No new tables, no denormalised
   * activity log — keeps the source of truth in each entity's own
   * column.
   *
   * Plant scans aren't included even though they're per-user: PlantScan
   * intentionally stores only `visitorHash` (anonymised SHA-256 of
   * ip|ua), not userId, so we can't tie scans to a specific donor
   * without breaking the GDPR posture. Worth revisiting later if we
   * add an opt-in `PlantView` event tied to userId.
   *
   * Response is a discriminated union: each item has `kind` + `ts` +
   * exactly one of `adoption | payment | ask | plantSaved` populated.
   * The web layer formats the human-readable copy with i18n.
   */
  @Get('activity')
  async activity(@CurrentUser() actor: AuthenticatedUser) {
    const userId = actor.sub;
    // Limit is fixed for now — if we ever need ?limit=N, add @Query
    // without changing the response shape. The per-source cap keeps
    // each individual query bounded so the union is at most 4 × N.
    const PER_SOURCE = 20;
    const FINAL_LIMIT = 20;

    const [adoptions, payments, asks, saves] = await Promise.all([
      this.prisma.adoption.findMany({
        where: { donorId: userId },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
        select: {
          id: true,
          createdAt: true,
          intent: true,
          plant: {
            select: {
              slug: true,
              nameEn: true,
              nameFi: true,
              nameSv: true,
              taxon: { select: { latinName: true } },
            },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: { donorId: userId, status: 'succeeded' },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
        select: { id: true, createdAt: true, amountCents: true, currency: true },
      }),
      this.prisma.askMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
        select: { id: true, createdAt: true, text: true },
      }),
      this.prisma.savedPlant.findMany({
        where: { userId },
        orderBy: { savedAt: 'desc' },
        take: PER_SOURCE,
        select: {
          savedAt: true,
          plant: {
            select: {
              slug: true,
              nameEn: true,
              nameFi: true,
              nameSv: true,
              taxon: { select: { latinName: true } },
            },
          },
        },
      }),
    ]);

    // Normalize each row into a tagged item with a `ts` for sorting.
    type Item = {
      kind: 'adoption_created' | 'payment_succeeded' | 'ask_asked' | 'plant_saved';
      ts: Date;
      adoption?: {
        id: string;
        plantSlug: string;
        plantNameEn: string;
        plantNameFi: string;
        plantNameSv: string;
        plantLatin: string | null;
        intent: string;
      };
      payment?: { id: string; amountCents: number; currency: string };
      ask?: { messageId: string; prompt: string };
      plantSaved?: {
        plantSlug: string;
        plantNameEn: string;
        plantNameFi: string;
        plantNameSv: string;
        plantLatin: string | null;
      };
    };

    const items: Item[] = [
      ...adoptions.map((a): Item => ({
        kind: 'adoption_created',
        ts: a.createdAt,
        adoption: {
          id: a.id,
          plantSlug: a.plant.slug,
          plantNameEn: a.plant.nameEn,
          plantNameFi: a.plant.nameFi,
          plantNameSv: a.plant.nameSv,
          plantLatin: a.plant.taxon?.latinName ?? null,
          intent: a.intent,
        },
      })),
      ...payments.map((p): Item => ({
        kind: 'payment_succeeded',
        ts: p.createdAt,
        payment: { id: p.id, amountCents: p.amountCents, currency: p.currency },
      })),
      ...asks.map((m): Item => ({
        kind: 'ask_asked',
        ts: m.createdAt,
        ask: { messageId: m.id, prompt: m.text.slice(0, 120) },
      })),
      ...saves.map((s): Item => ({
        kind: 'plant_saved',
        ts: s.savedAt,
        plantSaved: {
          plantSlug: s.plant.slug,
          plantNameEn: s.plant.nameEn,
          plantNameFi: s.plant.nameFi,
          plantNameSv: s.plant.nameSv,
          plantLatin: s.plant.taxon?.latinName ?? null,
        },
      })),
    ];

    items.sort((a, b) => b.ts.getTime() - a.ts.getTime());
    return {
      items: items.slice(0, FINAL_LIMIT).map((i) => ({ ...i, ts: i.ts.toISOString() })),
    };
  }

  /**
   * RSVP to an event-category benefit. The donor flips their attendance
   * intent (accepted / declined / attended) on a specific AdoptionBenefit
   * row. Persists rsvpStatus + rsvpAt. Ownership check ensures one donor
   * can't manipulate another's benefits.
   */
  @Patch('benefits/:benefitId/rsvp')
  @Roles('donor', 'curator', 'finance', 'admin')
  async rsvp(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('benefitId') benefitId: string,
    @Body(
      new ZodValidationPipe(
        z.object({
          status: z.enum(['accepted', 'declined', 'attended']),
        }),
      ),
    )
    body: { status: 'accepted' | 'declined' | 'attended' },
  ) {
    const benefit = await this.prisma.adoptionBenefit.findUnique({
      where: { id: benefitId },
      include: {
        adoption: { select: { donorId: true, giftRecipientId: true } },
      },
    });
    if (!benefit) throw new NotFoundException();
    if (benefit.category !== 'event') {
      throw new BadRequestException('RSVP only applies to event-category benefits');
    }
    const isOwner =
      benefit.adoption.donorId === actor.sub ||
      benefit.adoption.giftRecipientId === actor.sub;
    if (!isOwner && actor.role !== 'admin' && actor.role !== 'curator') {
      throw new NotFoundException();
    }
    const updated = await this.prisma.adoptionBenefit.update({
      where: { id: benefitId },
      data: {
        rsvpStatus: body.status,
        rsvpAt: new Date(),
        // Attended marks the benefit fulfilled too — the donor showed
        // up to the event, that's the deliverable.
        ...(body.status === 'attended'
          ? { status: 'fulfilled' as const, fulfilledAt: new Date() }
          : {}),
      },
      select: { id: true, rsvpStatus: true, rsvpAt: true, status: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.sub,
        action: `benefit.rsvp.${body.status}`,
        resource: `AdoptionBenefit/${benefitId}`,
      },
    });
    return updated;
  }
}
