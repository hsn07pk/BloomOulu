/**
 * Read-only admin audit log. Cursor-paginated, filterable by actor /
 * resource / action prefix. Admin role required (enforced by RolesGuard).
 */
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('admin/audit')
@Roles('admin')
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('actor') actor?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '', 10) || 50, 1), 200);
    const where: Record<string, unknown> = {};
    if (action) where.action = { startsWith: action };
    if (resource) where.resource = { contains: resource };
    if (actor) where.actorUserId = actor;
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        resource: true,
        actorUserId: true,
        before: true,
        after: true,
        occurredAt: true,
        ip: true,
        userAgent: true,
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }
}
