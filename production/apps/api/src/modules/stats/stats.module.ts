/**
 * Public stats — read-only aggregates safe to surface on the marketing
 * site. Each endpoint here is meant for unauthenticated traffic and must
 * stay cheap (single index scans, no PII, no per-user breakdowns).
 *
 * For admin / operator metrics (funnels, conversion, escalations) see
 * `admin-plants/admin-metrics.controller.ts` instead — that one's behind
 * the IP allowlist + auth and can do heavier work.
 *
 * Phase 1 here = the homepage hero strip. See
 * `docs/handover-files/stats-roadmap.md` for the broader plan.
 */
import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('stats')
class PublicStatsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Homepage hero strip. Returns the three live engagement numbers the
   * site renders alongside the LIFE+ESCAPE conservation context tile:
   *
   *   plantCount     — active plants in the public catalogue
   *   adoptionCount  — currently-active adoptions (donor-facing, excludes
   *                    pending checkouts and cancelled rows)
   *   raisedCents    — lifetime sum of settled donor payments, minor units
   *   asOf           — ISO timestamp so the client can show "as of …"
   *
   * Cheap: three independent count/sum queries dispatched in parallel.
   * Postgres answers each from an index scan in single-digit ms even on
   * millions of rows. Safe to cache for ~5 min via Next.js \`revalidate\`.
   */
  @Get('homepage')
  async homepage() {
    const [plantCount, adoptionCount, raisedAgg] = await Promise.all([
      this.prisma.plant.count({ where: { status: 'active' } }),
      this.prisma.adoption.count({ where: { status: 'active' } }),
      this.prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { status: 'succeeded' },
      }),
    ]);
    return {
      plantCount,
      adoptionCount,
      raisedCents: raisedAgg._sum.amountCents ?? 0,
      asOf: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [PublicStatsController] })
export class StatsModule {}
