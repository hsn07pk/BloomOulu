import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/garden')
  async myGarden(@Param('id') id: string) {
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
