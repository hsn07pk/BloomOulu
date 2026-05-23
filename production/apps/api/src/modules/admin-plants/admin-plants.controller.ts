/**
 * Curator/admin CRUD for plants.
 *
 *   POST   /v1/admin/plants            → create
 *   PATCH  /v1/admin/plants/:slug      → partial update
 *   DELETE /v1/admin/plants/:slug      → soft-delete (status='hidden')
 *
 * Every mutation:
 *   - is wrapped in a Prisma transaction with the AuditLog write
 *   - re-uses upsert semantics so reruns are idempotent
 *   - validates payload with zod
 *   - requires curator or admin role on the caller's JWT
 */
import {
  Body,
  Controller,
  Delete,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { RedListStatusEnum } from '@bloomoulu/constants';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CreateBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  taxonLatinName: z.string().min(2),
  taxonFamily: z.string().min(2),
  nameEn: z.string().min(1),
  nameFi: z.string().min(1),
  nameSv: z.string().min(1),
  redListStatus: RedListStatusEnum,
  bloomSeason: z.enum(['spring', 'summer', 'autumn', 'winter', 'all']),
  bloomWindow: z.string().nullable().optional(),
  origin: z.string(),
  habitat: z.string(),
  biome: z.string(),
  microLat: z.number().nullable().optional(),
  microLng: z.number().nullable().optional(),
  gardenZone: z.string().nullable().optional(),
  story: z.object({ en: z.string(), fi: z.string(), sv: z.string() }),
  status: z.enum(['active', 'hidden', 'retired']).optional(),
});

const PatchBody = z.object({
  taxonLatinName: z.string().min(2).optional(),
  taxonFamily: z.string().min(2).optional(),
  nameEn: z.string().min(1).optional(),
  nameFi: z.string().min(1).optional(),
  nameSv: z.string().min(1).optional(),
  redListStatus: RedListStatusEnum.optional(),
  bloomSeason: z.enum(['spring', 'summer', 'autumn', 'winter', 'all']).optional(),
  bloomWindow: z.string().nullable().optional(),
  origin: z.string().optional(),
  habitat: z.string().optional(),
  biome: z.string().optional(),
  microLat: z.number().nullable().optional(),
  microLng: z.number().nullable().optional(),
  gardenZone: z.string().nullable().optional(),
  story: z.object({ en: z.string(), fi: z.string(), sv: z.string() }).optional(),
  status: z.enum(['active', 'hidden', 'retired']).optional(),
});

@Controller('admin/plants')
@Roles('curator', 'admin')
export class AdminPlantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateBody)) body: z.infer<typeof CreateBody>,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const taxon = await tx.taxon.upsert({
        where: { latinName: body.taxonLatinName },
        create: { latinName: body.taxonLatinName, family: body.taxonFamily },
        update: { family: body.taxonFamily },
      });
      const created = await tx.plant.create({
        data: {
          slug: body.slug,
          taxonId: taxon.id,
          nameEn: body.nameEn,
          nameFi: body.nameFi,
          nameSv: body.nameSv,
          redListStatus: body.redListStatus,
          bloomSeason: body.bloomSeason,
          bloomWindow: body.bloomWindow ?? null,
          origin: body.origin,
          habitat: body.habitat,
          biome: body.biome,
          microLat: body.microLat ?? null,
          microLng: body.microLng ?? null,
          gardenZone: body.gardenZone ?? null,
          story: body.story,
          quickFacts: [
            ['origin', body.origin],
            ['bloom', body.bloomWindow ?? body.bloomSeason],
            ['redList', body.redListStatus],
            ['habitat', body.habitat],
          ],
          status: body.status ?? 'hidden',
        },
        select: { id: true, slug: true, nameEn: true, redListStatus: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'admin.plant.create',
          resource: `Plant/${created.id}`,
          after: created,
        },
      });
      return created;
    });
    return { ok: true, plant: result };
  }

  @Patch(':slug')
  async patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(PatchBody)) body: z.infer<typeof PatchBody>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.plant.findUnique({
        where: { slug },
        select: {
          id: true,
          nameEn: true,
          nameFi: true,
          nameSv: true,
          redListStatus: true,
          bloomSeason: true,
          bloomWindow: true,
          origin: true,
          habitat: true,
          biome: true,
          microLat: true,
          microLng: true,
          gardenZone: true,
          status: true,
          story: true,
          taxonId: true,
        },
      });
      if (!before) throw new NotFoundException();
      let taxonId = before.taxonId;
      if (body.taxonLatinName) {
        const t = await tx.taxon.upsert({
          where: { latinName: body.taxonLatinName },
          create: {
            latinName: body.taxonLatinName,
            family: body.taxonFamily ?? 'Unknown',
          },
          update: { family: body.taxonFamily ?? undefined },
        });
        taxonId = t.id;
      }
      const updated = await tx.plant.update({
        where: { slug },
        data: {
          taxonId,
          nameEn: body.nameEn ?? undefined,
          nameFi: body.nameFi ?? undefined,
          nameSv: body.nameSv ?? undefined,
          redListStatus: body.redListStatus ?? undefined,
          bloomSeason: body.bloomSeason ?? undefined,
          bloomWindow: body.bloomWindow ?? undefined,
          origin: body.origin ?? undefined,
          habitat: body.habitat ?? undefined,
          biome: body.biome ?? undefined,
          microLat: body.microLat === undefined ? undefined : body.microLat,
          microLng: body.microLng === undefined ? undefined : body.microLng,
          gardenZone: body.gardenZone === undefined ? undefined : body.gardenZone,
          story: body.story ?? undefined,
          status: body.status ?? undefined,
        },
        select: { id: true, slug: true, nameEn: true, redListStatus: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'admin.plant.patch',
          resource: `Plant/${updated.id}`,
          before,
          after: updated,
        },
      });
      return updated;
    });
  }

  @Delete(':slug')
  async softDelete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('slug') slug: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.plant.findUnique({
        where: { slug },
        select: { id: true, status: true },
      });
      if (!before) throw new NotFoundException();
      const updated = await tx.plant.update({
        where: { slug },
        data: { status: 'retired' },
        select: { id: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'admin.plant.retire',
          resource: `Plant/${updated.id}`,
          before,
          after: updated,
        },
      });
      return { ok: true, plant: updated };
    });
  }
}
