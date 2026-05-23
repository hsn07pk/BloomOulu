/**
 * Admin metrics — read-only dashboards built off the PlantScan event table
 * and Adoption rows. Everything served from a single Postgres query so the
 * AdminJS / future custom dashboard can render the funnel + leaderboard
 * without N+1.
 *
 *   GET /v1/admin/metrics/qr           Top-scanned plants over a window
 *   GET /v1/admin/metrics/qr/timeline  Daily scan totals (last 30 days)
 *   GET /v1/admin/metrics/funnel       Scan → adoption funnel + conversion
 *
 * The PlantScan row already keeps GDPR-safe data only (no raw IP / UA);
 * these aggregates are safe to surface to operators.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_LEADERBOARD = 50;

function windowStart(daysParam: string | undefined, fallback: number): Date {
  const days = Math.max(1, Math.min(365, parseInt(daysParam ?? '', 10) || fallback));
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Leaderboard: plants with the most QR scans inside the window. Returns
   * id + slug + names + scanCount + scansInWindow so the admin UI can
   * show both "lifetime" and "recent" columns.
   */
  @Get('qr')
  async qrLeaderboard(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    const from = windowStart(days, DEFAULT_WINDOW_DAYS);
    const max = Math.max(1, Math.min(MAX_LEADERBOARD, parseInt(limit ?? '', 10) || 20));
    // Two queries (recent + lifetime) joined client-side. A single
    // GROUP BY query would also work but adds a window function on a
    // potentially large table; this stays index-friendly.
    const recent = await this.prisma.plantScan.groupBy({
      by: ['plantId'],
      where: { scannedAt: { gte: from } },
      _count: { _all: true },
      orderBy: { _count: { plantId: 'desc' } },
      take: max,
    });
    const plantIds = recent.map((r) => r.plantId);
    if (plantIds.length === 0) {
      return { windowStart: from.toISOString(), items: [] };
    }
    const plants = await this.prisma.plant.findMany({
      where: { id: { in: plantIds } },
      select: {
        id: true,
        slug: true,
        nameEn: true,
        nameFi: true,
        nameSv: true,
        redListStatus: true,
        scanCount: true,
        adopterCount: true,
        primaryImage: { select: { url: true } },
        taxon: { select: { latinName: true } },
      },
    });
    const byId = new Map(plants.map((p) => [p.id, p]));
    const items = recent
      .map((r) => {
        const p = byId.get(r.plantId);
        if (!p) return null;
        return {
          plantId: p.id,
          slug: p.slug,
          latinName: p.taxon?.latinName ?? p.nameEn,
          nameEn: p.nameEn,
          nameFi: p.nameFi,
          nameSv: p.nameSv,
          redListStatus: p.redListStatus,
          scansInWindow: r._count._all,
          scanCountLifetime: p.scanCount,
          adopterCount: p.adopterCount,
          primaryImageUrl: p.primaryImage?.url ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { windowStart: from.toISOString(), items };
  }

  /** Daily scan count timeline for the last N days. */
  @Get('qr/timeline')
  async qrTimeline(@Query('days') days?: string) {
    const from = windowStart(days, DEFAULT_WINDOW_DAYS);
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT
        date_trunc('day', "scannedAt") AS day,
        COUNT(*)::bigint AS count
      FROM "PlantScan"
      WHERE "scannedAt" >= ${from}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return {
      windowStart: from.toISOString(),
      points: rows.map((r) => ({ day: r.day.toISOString(), count: Number(r.count) })),
    };
  }

  /**
   * Scan → adoption funnel for the window:
   *   - totalScans              every PlantScan in the window
   *   - uniqueVisitors          DISTINCT visitorHash (excluding empty)
   *   - uniqueScannedPlants     DISTINCT plantId
   *   - adoptionsAfterScan      Adoptions whose plant was scanned in the
   *                             same window (proxy for funnel conversion)
   */
  @Get('funnel')
  async funnel(@Query('days') days?: string) {
    const from = windowStart(days, DEFAULT_WINDOW_DAYS);
    const [totalScans, uniqueVisitors, uniqueScannedPlants, scannedPlantIdsRows] =
      await Promise.all([
        this.prisma.plantScan.count({ where: { scannedAt: { gte: from } } }),
        this.prisma.plantScan
          .findMany({
            where: { scannedAt: { gte: from }, visitorHash: { not: '' } },
            distinct: ['visitorHash'],
            select: { visitorHash: true },
          })
          .then((r) => r.length),
        this.prisma.plantScan
          .findMany({
            where: { scannedAt: { gte: from } },
            distinct: ['plantId'],
            select: { plantId: true },
          })
          .then((r) => r.length),
        this.prisma.plantScan.findMany({
          where: { scannedAt: { gte: from } },
          distinct: ['plantId'],
          select: { plantId: true },
        }),
      ]);
    const scannedPlantIds = scannedPlantIdsRows.map((r) => r.plantId);
    const adoptionsAfterScan = scannedPlantIds.length === 0
      ? 0
      : await this.prisma.adoption.count({
          where: {
            createdAt: { gte: from },
            plantId: { in: scannedPlantIds },
          },
        });
    const conversionRate = totalScans > 0 ? adoptionsAfterScan / totalScans : 0;
    return {
      windowStart: from.toISOString(),
      totalScans,
      uniqueVisitors,
      uniqueScannedPlants,
      adoptionsAfterScan,
      conversionRate,
    };
  }
}
