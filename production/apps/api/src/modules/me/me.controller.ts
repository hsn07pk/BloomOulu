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
}
