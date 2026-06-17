/**
 * Admin user management — list, search, role assignment, deactivate.
 * Requires admin role on the caller's session JWT (enforced by RolesGuard).
 *
 * The donor-facing profile endpoint (PATCH /v1/me/profile) lives in
 * MeController; this one is the curator/admin operational view.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { LocaleEnum } from '@bloomoulu/constants';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PatchUser = z.object({
  role: z.enum(['donor', 'curator', 'finance', 'admin']).optional(),
  name: z.string().nullable().optional(),
  locale: LocaleEnum.optional(),
  status: z.enum(['active', 'deactivated']).optional(),
});

@Controller('admin/users')
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '', 10) || 50, 1), 200);
    const where: Record<string, unknown> = {};
    if (q && q.trim().length >= 2) {
      where.OR = [
        { email: { contains: q.trim(), mode: 'insensitive' } },
        { name: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        locale: true,
        emailVerified: true,
        createdAt: true,
        ouluUid: true,
        _count: { select: { donations: true, payments: true } },
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  @Patch(':id')
  async patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchUser)) body: z.infer<typeof PatchUser>,
  ) {
    if (!id || id === actor.sub) {
      if (body.role && body.role !== 'admin') {
        throw new BadRequestException("An admin cannot remove their own admin role.");
      }
      if (body.status === 'deactivated') {
        throw new BadRequestException("An admin cannot deactivate their own account.");
      }
    }
    const before = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, name: true, locale: true, deactivatedAt: true },
    });
    if (!before) throw new BadRequestException('user not found');
    const deactivatedAt =
      body.status === 'deactivated'
        ? before.deactivatedAt ?? new Date()
        : body.status === 'active'
          ? null
          : undefined;
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        role: body.role,
        name: body.name === undefined ? undefined : body.name,
        locale: body.locale,
        deactivatedAt,
      },
      select: { id: true, email: true, name: true, role: true, locale: true, deactivatedAt: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.sub,
        action: 'admin.user.patch',
        resource: `User/${updated.id}`,
        before,
        after: updated,
      },
    });
    return updated;
  }
}
