/**
 * "Me" endpoints — per-user state that the donor's browser reads + writes.
 *
 *   GET    /v1/me/profile            → donor's own profile fields
 *   PATCH  /v1/me/profile            → update name/locale/homeRegion/marketing
 *
 * Auth: every endpoint requires a signed Bearer JWT (the bloomoulu.session
 * cookie content forwarded by the web's server-side proxy). RolesGuard
 * additionally rejects subjects whose User.deactivatedAt is set.
 */
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
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

  /**
   * Unified donor-activity timeline for the MyGarden page.
   *
   * Aggregates four event sources that already live in the DB:
   *   - Donation.createdAt           (kind: 'donation_created')
   *   - Payment.createdAt + succeeded (kind: 'payment_succeeded')
   *   - AskMessage.createdAt          (kind: 'ask_asked')
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
   * exactly one of `donation | payment | ask | plantSaved` populated.
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

    const [donations, payments, asks] = await Promise.all([
      this.prisma.donation.findMany({
        where: { donorId: userId },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
        select: {
          id: true,
          createdAt: true,
          amountCents: true,
          status: true,
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
    ]);

    // Normalize each row into a tagged item with a `ts` for sorting.
    type Item = {
      kind: 'donation_created' | 'payment_succeeded' | 'ask_asked';
      ts: Date;
      donation?: {
        id: string;
        plantSlug: string | null;
        plantNameEn: string | null;
        plantNameFi: string | null;
        plantNameSv: string | null;
        plantLatin: string | null;
        amountCents: number;
        status: string;
      };
      payment?: { id: string; amountCents: number; currency: string };
      ask?: { messageId: string; prompt: string };
    };

    const items: Item[] = [
      ...donations.map((d): Item => ({
        kind: 'donation_created',
        ts: d.createdAt,
        donation: {
          id: d.id,
          plantSlug: d.plant?.slug ?? null,
          plantNameEn: d.plant?.nameEn ?? null,
          plantNameFi: d.plant?.nameFi ?? null,
          plantNameSv: d.plant?.nameSv ?? null,
          plantLatin: d.plant?.taxon?.latinName ?? null,
          amountCents: d.amountCents,
          status: d.status,
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
    ];

    items.sort((a, b) => b.ts.getTime() - a.ts.getTime());
    return {
      items: items.slice(0, FINAL_LIMIT).map((i) => ({ ...i, ts: i.ts.toISOString() })),
    };
  }

  /**
   * My Garden dashboard — the donor's one-time donations plus the
   * financial documents tied to them.
   *
   *   - donations:       newest-first, with the optional directed species
   *   - receipts:        per-payment donation receipts (PDF links)
   *   - taxCertificates: annual aggregate certificates (PDF links)
   *
   * Replaces the old loyalty-card / tier / impact-breakdown / benefits /
   * plaques / gifts surface (those concepts no longer exist).
   */
  @Get('donations')
  async donations(@CurrentUser() actor: AuthenticatedUser) {
    const userId = actor.sub;
    const [donations, receipts, taxCertificates] = await Promise.all([
      this.prisma.donation.findMany({
        where: { donorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          amountCents: true,
          currency: true,
          status: true,
          dedication: true,
          startedAt: true,
          createdAt: true,
          plant: { select: { slug: true, nameEn: true, nameFi: true, nameSv: true } },
        },
      }),
      this.prisma.receipt.findMany({
        where: { donorId: userId },
        orderBy: { issuedAt: 'desc' },
        select: {
          id: true,
          number: true,
          kind: true,
          amountCents: true,
          currency: true,
          pdfUrl: true,
          issuedAt: true,
        },
      }),
      this.prisma.taxCertificate.findMany({
        where: { donorId: userId },
        orderBy: { taxYear: 'desc' },
        select: {
          id: true,
          taxYear: true,
          totalCents: true,
          scheme: true,
          pdfUrl: true,
          issuedAt: true,
        },
      }),
    ]);
    return { donations, receipts, taxCertificates };
  }
}
