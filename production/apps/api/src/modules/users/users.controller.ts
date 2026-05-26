import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

const STAFF_ROLES = new Set(['curator', 'finance', 'admin']);

@Controller('users')
@Roles('donor', 'curator', 'finance', 'admin')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/garden')
  async myGarden(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    // ADR-0003: donor sees own data only; finance/curator/admin can read any
    // donor's garden (finance for refund context, curator for plaque
    // installation, admin for ops). Anything else → 403.
    if (actor.sub !== id && !STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException();
    }
    // Staff reads are audited so finance/curator access leaves a trail
    // any donor can request via /v1/exports/me/data (full audit history
    // is part of their GDPR export).
    if (actor.sub !== id && STAFF_ROLES.has(actor.role)) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'staff.donor-garden.read',
          resource: `User/${id}`,
        },
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        createdAt: true,
        adoptions: {
          orderBy: { createdAt: 'desc' },
          include: {
            plant: { include: { primaryImage: true, taxon: true } },
            tier: true,
            plaque: true,
            payments: { orderBy: { createdAt: 'desc' }, take: 1 },
            // Gift recipient join — needed by the "Gifts you've sent"
            // card on MyGarden. Select only the recipient's display
            // fields, never their PII (no address / phone / preferences).
            // Returns null for non-gift adoptions; donor sees their own
            // recipient list only via the gates enforced at line 18.
            giftRecipient: { select: { id: true, name: true, email: true } },
          },
        },
        receipts: { orderBy: { issuedAt: 'desc' }, take: 50 },
        taxCertificates: { orderBy: { taxYear: 'desc' } },
      },
    });
    if (!user) throw new NotFoundException();

    // Derived: cumulative donations + loyalty tier (Silver / Gold / Platinum)
    // computed from succeeded payments. Thresholds mirror the prototype.
    const succeededTotal = await this.prisma.payment.aggregate({
      where: { donorId: id, status: 'succeeded' },
      _sum: { amountCents: true },
      _count: { id: true },
    });
    const lifetimeCents = succeededTotal._sum.amountCents ?? 0;
    const loyalty =
      lifetimeCents >= 250_000
        ? 'Platinum'
        : lifetimeCents >= 100_000
          ? 'Gold'
          : lifetimeCents >= 20_000
            ? 'Silver'
            : 'Seedling';
    const nextThresholdCents =
      loyalty === 'Platinum'
        ? null
        : loyalty === 'Gold'
          ? 250_000
          : loyalty === 'Silver'
            ? 100_000
            : 20_000;

    // Impact breakdown — derived from the published funds-flow ratio in
    // ContentBlock 'policy.funds-flow' (62 / 18 / 12 / 8). Tiny rounding
    // drift is fine; finance-of-record is the Receipt table.
    const impact = {
      directExSitu: Math.round(lifetimeCents * 0.62),
      seedBank: Math.round(lifetimeCents * 0.18),
      gardenOperations: Math.round(lifetimeCents * 0.12),
      platformCosts: Math.round(lifetimeCents * 0.08),
    };

    return {
      ...user,
      lifetimeCents,
      paymentCount: succeededTotal._count.id ?? 0,
      loyalty,
      nextThresholdCents,
      impact,
    };
  }
}
