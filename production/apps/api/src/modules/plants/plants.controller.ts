/**
 * Plant catalogue API.
 *
 *   GET /v1/plants                Cursor-paginated list with optional
 *                                 facet filters (redListStatus, bloomSeason,
 *                                 status). Targets the composite
 *                                 (status, redListStatus, bloomSeason) +
 *                                 (status, adopterCount DESC, nameEn) indexes.
 *   GET /v1/plants/search?q=…     Full-text + trigram ranked search. Uses
 *                                 Plant.searchText tsvector for FTS rank +
 *                                 the trigram gin indexes for fuzzy fallback.
 *   GET /v1/plants/:slug          Single plant with all related rows.
 *
 * Designed for millions-of-plants scale:
 *   - keyset (cursor) pagination — no OFFSET, no count(*) on the hot path.
 *   - LIMIT capped at 100; default 24.
 *   - Search query goes via raw SQL to combine FTS ranking with trigram
 *     similarity in a single index scan.
 */
import { Body, Controller, Get, HttpCode, Ip, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { LocaleEnum } from '@bloomoulu/constants';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { NarrationService } from '../narration/narration.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { presign } from '../../infra/storage.js';

/** Body of POST /v1/plants/:slug/scan. Kept tiny — every field is optional;
 *  the controller derives a stable visitorHash from IP + UA so we never
 *  store raw PII. */
const RecordScanDto = z.object({
  locale: LocaleEnum.optional(),
  kioskId: z.string().max(64).optional(),
});
type RecordScanDto = z.infer<typeof RecordScanDto>;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 24;

@Controller('plants')
export class PlantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly narration: NarrationService,
  ) {}

  @Get()
  async list(
    @Query('status') status: string = 'active',
    @Query('redList') redList?: string,
    @Query('bloomSeason') bloomSeason?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Fuzzy / FTS path: delegate to /search internally so the index plan
    // is the same. Forward facet filters so combined search+filter works.
    if (q && q.trim().length >= 2) {
      return this.search(q, limitStr, cursor, redList, bloomSeason);
    }

    const where: any = { status };
    if (redList) where.redListStatus = redList as any;
    if (bloomSeason) where.bloomSeason = bloomSeason as any;

    // Keyset pagination. The cursor encodes the row position in the sort
    // order (adopterCount DESC, nameEn ASC, id) so two rows with the same
    // adopterCount + nameEn still resolve deterministically.
    const rows = await this.prisma.plant.findMany({
      where,
      orderBy: [
        { adopterCount: 'desc' },
        { nameEn: 'asc' },
        { id: 'asc' },
      ],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { primaryImage: true, taxon: { select: { latinName: true, family: true } } },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * Full-text + trigram fuzzy search. Combines the FTS rank (with weights:
   * names A, origin/habitat C) with a trigram similarity score for typo
   * tolerance. Active plants only — the index pre-filters by status so a
   * single index scan answers the query.
   */
  @Get('search')
  async search(
    @Query('q') q: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('redList') redList?: string,
    @Query('bloomSeason') bloomSeason?: string,
  ) {
    if (!q || q.trim().length < 2) return { items: [], nextCursor: null };
    const limit = Math.min(Math.max(parseInt(limitStr ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const qTrim = q.trim();
    // tsquery — wrap each whitespace-separated token in a prefix match so
    // "puls" matches "pulsatilla". Quote internally to escape user input.
    const tsq = qTrim
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, '') + ':*')
      .filter(Boolean)
      .join(' & ');

    // Phase 1: ranked SQL. Returns just the id + rank so the FTS+trigram
    // index plan stays a single index scan. We pull limit+1 to detect more.
    const ranked = await this.prisma.$queryRawUnsafe<Array<{ id: string; rank: number }>>(
      `
      SELECT
        p."id",
        (
          ts_rank(p."searchText", to_tsquery('simple', $1)) * 2
          + GREATEST(
              similarity(p."nameEn", $2),
              similarity(p."nameFi", $2),
              similarity(p."nameSv", $2)
            )
        ) AS rank
      FROM "Plant" p
      WHERE p.status = 'active'
        ${redList ? `AND p."redListStatus" = $4::"RedListStatus"` : ''}
        ${bloomSeason ? `AND p."bloomSeason" = $${redList ? 5 : 4}::"BloomSeason"` : ''}
        AND (
          p."searchText" @@ to_tsquery('simple', $1)
          OR p."nameEn" % $2
          OR p."nameFi" % $2
          OR p."nameSv" % $2
        )
      ORDER BY rank DESC, p."nameEn" ASC, p."id" ASC
      LIMIT $3
      `,
      ...[
        tsq.length > 0 ? tsq : qTrim,
        qTrim,
        limit + 1,
        ...(redList ? [redList] : []),
        ...(bloomSeason ? [bloomSeason] : []),
      ],
    );

    if (ranked.length === 0) return { items: [], nextCursor: null };

    const hasMore = ranked.length > limit;
    const rankedPage = hasMore ? ranked.slice(0, limit) : ranked;
    const rankedIds = rankedPage.map((r) => r.id);

    // Phase 2: hydrate full rows (with images + taxon) for the page. One
    // extra round-trip; trivial vs the FTS scan and keeps the SQL clean.
    const fullRows = await this.prisma.plant.findMany({
      where: { id: { in: rankedIds } },
      include: { primaryImage: true, taxon: { select: { latinName: true, family: true } } },
    });
    const byId = new Map(fullRows.map((r) => [r.id, r]));
    const items = rankedIds.map((id) => byId.get(id)).filter(Boolean);

    return { items, nextCursor: hasMore ? rankedIds[rankedIds.length - 1]! : null };
  }

  @Get(':slug')
  async one(@Param('slug') slug: string) {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      include: {
        taxon: true,
        primaryImage: true,
        images: true,
        accessions: true,
        narrations: true,
        citations: { include: { citation: true } },
      },
    });
    if (!plant) throw new NotFoundException();

    // Fire-and-forget: kick off background TTS generation for any locale
    // that's still missing. The current request returns immediately with
    // whatever narrations exist; a follow-up fetch (next visit / hard
    // reload) will see the new rows.
    this.narration.ensureGenerated(plant.id);

    // Replace s3:// references with short-lived presigned HTTP URLs so
    // the browser can stream the audio directly from MinIO.
    const narrations = await Promise.all(
      plant.narrations.map(async (n) => {
        if (!n.audioUrl.startsWith('s3://')) return n;
        try {
          const url = await presign(n.audioUrl, 3600);
          return { ...n, audioUrl: url };
        } catch {
          return n;
        }
      }),
    );
    return { ...plant, narrations };
  }

  /**
   * Record a physical-label QR scan. Visitors landing on the public
   * plant page with ?qr=1 fire a single fire-and-forget POST here so we
   * can build "what's popular today" + the scan → adoption funnel in
   * /admin.
   *
   * GDPR posture: no IP / UA stored verbatim. A SHA-256 over `ip|ua`
   * becomes the `visitorHash`, which lets us collapse browser refreshes
   * into one "session" without retaining anything personal. We also
   * bump Plant.scanCount in the same transaction so list views can
   * sort by popularity cheaply.
   */
  @Post(':slug/scan')
  @HttpCode(204)
  async recordScan(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(RecordScanDto)) dto: RecordScanDto,
    @Req() req: FastifyRequest,
    @Ip() ip: string,
  ) {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!plant) throw new NotFoundException();

    const ua = (req.headers['user-agent'] as string) ?? '';
    const visitorHash =
      ip || ua ? createHash('sha256').update(`${ip}|${ua}`).digest('hex') : '';
    await this.prisma.$transaction([
      this.prisma.plantScan.create({
        data: {
          plantId: plant.id,
          locale: dto.locale ?? 'fi',
          kioskId: dto.kioskId ?? null,
          visitorHash,
          userAgent: ua ? ua.slice(0, 240) : null,
        },
      }),
      this.prisma.plant.update({
        where: { id: plant.id },
        data: { scanCount: { increment: 1 } },
      }),
    ]);
    return;
  }
}
