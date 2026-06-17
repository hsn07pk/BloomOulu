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
   *   donationCount  — settled (completed) donations
   *   raisedCents    — lifetime sum of settled donor payments, minor units
   *   asOf           — ISO timestamp so the client can show "as of …"
   *
   * Cheap: three independent count/sum queries dispatched in parallel.
   * Postgres answers each from an index scan in single-digit ms even on
   * millions of rows. Safe to cache for ~5 min via Next.js \`revalidate\`.
   */
  @Get('homepage')
  async homepage() {
    const [plantCount, donationCount, raisedAgg] = await Promise.all([
      this.prisma.plant.count({ where: { status: 'active' } }),
      this.prisma.donation.count({ where: { status: 'completed' } }),
      this.prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { status: 'succeeded' },
      }),
    ]);
    return {
      plantCount,
      donationCount,
      raisedCents: raisedAgg._sum.amountCents ?? 0,
      asOf: new Date().toISOString(),
    };
  }

  /**
   * Donor wall — list of donors who opted in (showOnWall=true, not anonymous)
   * and whose donation has settled. Newest first. Returns only display-safe
   * fields: name (publicName takes precedence over donor.name), the optional
   * directed species, dedication, and the gift amount. No emails, no
   * addresses, no payment info.
   */
  @Get('donor-wall')
  async donorWall() {
    const donations = await this.prisma.donation.findMany({
      where: {
        status: 'completed',
        showOnWall: true,
        anonymous: false,
      },
      orderBy: [{ startedAt: 'desc' }],
      take: 500,
      include: {
        donor: { select: { name: true } },
        plant: { select: { slug: true, nameEn: true, nameFi: true, nameSv: true } },
      },
    });
    return {
      donations: donations.map((d) => ({
        id: d.id,
        displayName: d.publicName ?? d.donor.name ?? 'A friend of the Garden',
        dedication: d.dedication,
        amountCents: d.amountCents,
        startedAt: d.startedAt?.toISOString() ?? null,
        plant: d.plant,
      })),
      count: donations.length,
      asOf: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [PublicStatsController] })
export class StatsModule {}
