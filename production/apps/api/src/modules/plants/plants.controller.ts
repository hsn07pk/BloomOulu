/**
 * Plant catalogue API.
 *
 *   GET /v1/plants                Cursor-paginated list with optional
 *                                 facet filters (redListStatus, bloomSeason,
 *                                 status). Targets the composite
 *                                 (status, redListStatus, bloomSeason) +
 *                                 (status, donorCount DESC, nameEn) indexes.
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
import { createHmac } from 'node:crypto';
import { LocaleEnum, ENDANGERED_STATUSES } from '@bloomoulu/constants';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { NarrationService } from '../narration/narration.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';

/** Body of POST /v1/plants/:slug/scan. Kept tiny — every field is optional;
 *  the controller derives a stable visitorHash from IP + UA so we never
 *  store raw PII. */
const RecordScanDto = z.object({
  // `.nullish()` (= optional + nullable), not `.optional()`: a fire-and-forget
  // analytics ping must never 400. Web clients legitimately POST
  // `{ kioskId: null }` for the common non-kiosk arrival, and `.optional()`
  // rejects an explicit null — which silently dropped every QR scan. The
  // handler coalesces null/undefined below (`?? 'fi'` / `?? null`).
  locale: LocaleEnum.nullish(),
  kioskId: z.string().max(64).nullish(),
});
type RecordScanDto = z.infer<typeof RecordScanDto>;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 24;

/** Quoted, comma-joined IUCN "Threatened" codes (CR,EN,VU) for raw-SQL
 *  IN / NOT IN clauses. Built from a trusted constant — never user input —
 *  so inlining into SQL is safe. Powers the public ?endangered=true|false
 *  filter, which the web/kiosk surfaces use in place of per-code filters. */
const ENDANGERED_SQL = ENDANGERED_STATUSES.map((s) => `'${s}'`).join(', ');

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
    @Query('endangered') endangered?: string,
    @Query('bloomSeason') bloomSeason?: string,
    @Query('family') family?: string,
    @Query('hasAdopters') hasAdopters?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('page') pageStr?: string,
    @Query('q') q?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    // Two pagination modes coexist:
    //   - cursor (?cursor=...) — legacy keyset, infinite-scroll Load More
    //   - offset (?page=N)     — page-number UI; response includes total
    // If the client sends `page`, we run offset mode. Otherwise cursor.
    const pageMode = pageStr !== undefined;
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);

    // Fuzzy / FTS path: delegate to /search internally so the index plan
    // is the same. Forward facet filters so combined search+filter works.
    if (q && q.trim().length >= 2) {
      return this.search(q, limitStr, cursor, redList, bloomSeason, family, hasAdopters, pageMode ? page : undefined, endangered);
    }

    const where: any = { status };
    // `redList` (exact IUCN code) is kept for internal callers — similar-plants
    // and the admin tools. `endangered` is the donor-facing two-bucket filter
    // (CR/EN/VU vs the rest). Exact code wins if both are somehow supplied.
    if (redList) where.redListStatus = redList as any;
    else if (endangered === 'true') where.redListStatus = { in: [...ENDANGERED_STATUSES] };
    else if (endangered === 'false') where.redListStatus = { notIn: [...ENDANGERED_STATUSES] };
    if (bloomSeason) where.bloomSeason = bloomSeason as any;
    if (family) where.taxon = { family };
    if (hasAdopters === 'true') where.donorCount = { gt: 0 };
    else if (hasAdopters === 'false') where.donorCount = 0;

    const orderBy = [
      { donorCount: 'desc' as const },
      { nameEn: 'asc' as const },
      { id: 'asc' as const },
    ];
    const include = {
      primaryImage: true,
      taxon: { select: { latinName: true, family: true } },
    };

    // Offset mode — pulls page rows + total count in parallel.
    if (pageMode) {
      const [rows, total] = await Promise.all([
        this.prisma.plant.findMany({
          where,
          orderBy,
          take: limit,
          skip: (page - 1) * limit,
          include,
        }),
        this.prisma.plant.count({ where }),
      ]);
      return {
        items: rows,
        page,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    }

    // Cursor (keyset) mode — unchanged. The cursor encodes the row
    // position in the sort order so two rows with the same donorCount +
    // nameEn still resolve deterministically.
    const rows = await this.prisma.plant.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include,
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
  /**
   * Public count of catalogued plants — feeds the homepage hero stat tile
   * and the filter-aware "Showing X of Y" counter on the /plants page.
   *
   * Accepts the same filter params as @Get() so the client can call this
   * alongside the list fetch to get the unpaginated total. count(*) on the
   * partial `status` index is cheap; adding facet filters still keeps it
   * to a single index scan.
   *
   * Declared BEFORE @Get(':slug') so it matches as a static route.
   */
  @Get('count')
  async count(
    @Query('status') status: string = 'active',
    @Query('redList') redList?: string,
    @Query('endangered') endangered?: string,
    @Query('bloomSeason') bloomSeason?: string,
    @Query('family') family?: string,
    @Query('hasAdopters') hasAdopters?: string,
    @Query('q') q?: string,
  ) {
    // Fuzzy / FTS path mirrors search() WHERE clauses so the counter
    // stays accurate when the user has a query active.
    if (q && q.trim().length >= 2) {
      return this.searchCount(q, redList, bloomSeason, family, hasAdopters, endangered);
    }
    const where: any = { status };
    if (redList) where.redListStatus = redList as any;
    else if (endangered === 'true') where.redListStatus = { in: [...ENDANGERED_STATUSES] };
    else if (endangered === 'false') where.redListStatus = { notIn: [...ENDANGERED_STATUSES] };
    if (bloomSeason) where.bloomSeason = bloomSeason as any;
    if (family) where.taxon = { family };
    if (hasAdopters === 'true') where.donorCount = { gt: 0 };
    else if (hasAdopters === 'false') where.donorCount = 0;
    const total = await this.prisma.plant.count({ where });
    return { total };
  }

  /**
   * SQL-side counterpart to search() — same WHERE clauses but COUNT(*).
   * Kept separate from search() so the FTS+trigram fetch stays a single
   * ranked index scan; the count is a parallel scan against the same
   * predicate, executed only when the client explicitly asks for it.
   */
  private async searchCount(
    q: string,
    redList?: string,
    bloomSeason?: string,
    family?: string,
    hasAdopters?: string,
    endangered?: string,
  ): Promise<{ total: number }> {
    const qTrim = q.trim();
    const tsq = qTrim
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, '') + ':*')
      .filter(Boolean)
      .join(' & ');

    // Param positions: $1=tsq, $2=qTrim, then optional redList, bloomSeason,
    // family, hasAdopters in source order. Build clauses + params in lockstep.
    const clauses: string[] = [];
    const params: any[] = [tsq.length > 0 ? tsq : qTrim, qTrim];
    if (redList) {
      params.push(redList);
      clauses.push(`AND p."redListStatus" = $${params.length}::"RedListStatus"`);
    } else if (endangered === 'true') {
      clauses.push(`AND p."redListStatus" IN (${ENDANGERED_SQL})`);
    } else if (endangered === 'false') {
      clauses.push(`AND p."redListStatus" NOT IN (${ENDANGERED_SQL})`);
    }
    if (bloomSeason) {
      params.push(bloomSeason);
      clauses.push(`AND p."bloomSeason" = $${params.length}::"BloomSeason"`);
    }
    if (family) {
      params.push(family);
      clauses.push(`AND EXISTS (SELECT 1 FROM "Taxon" t WHERE t.id = p."taxonId" AND t.family = $${params.length})`);
    }
    if (hasAdopters === 'true') clauses.push(`AND p."donorCount" > 0`);
    else if (hasAdopters === 'false') clauses.push(`AND p."donorCount" = 0`);

    const sql = `
      SELECT COUNT(*)::int AS total
      FROM "Plant" p
      WHERE p.status = 'active'
        ${clauses.join('\n        ')}
        AND (
          p."searchText" @@ to_tsquery('simple', $1)
          OR p."nameEn" % $2
          OR p."nameFi" % $2
          OR p."nameSv" % $2
        )
    `;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ total: number }>>(sql, ...params);
    return { total: rows[0]?.total ?? 0 };
  }

  @Get('search')
  async search(
    @Query('q') q: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('redList') redList?: string,
    @Query('bloomSeason') bloomSeason?: string,
    @Query('family') family?: string,
    @Query('hasAdopters') hasAdopters?: string,
    /** When set, switches search into offset pagination — returns total + totalPages instead of nextCursor. */
    @Query('page') pageParam?: number | string,
    /** Donor-facing two-bucket filter: 'true' = CR/EN/VU, 'false' = the rest. */
    @Query('endangered') endangered?: string,
  ) {
    if (!q || q.trim().length < 2)
      return pageParam !== undefined
        ? { items: [], page: 1, pageSize: DEFAULT_LIMIT, total: 0, totalPages: 1 }
        : { items: [], nextCursor: null };

    const limit = Math.min(Math.max(parseInt(limitStr ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const pageMode = pageParam !== undefined;
    const page = Math.max(1, parseInt(String(pageParam ?? '1'), 10) || 1);
    const qTrim = q.trim();
    // tsquery — wrap each whitespace-separated token in a prefix match so
    // "puls" matches "pulsatilla". Quote internally to escape user input.
    const tsq = qTrim
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, '') + ':*')
      .filter(Boolean)
      .join(' & ');

    // Build the WHERE clause + ordered param list together so positional
    // placeholders stay correct as we add filters.
    const filterClauses: string[] = [];
    const filterParams: any[] = [];
    const filterParamStart = 4; // $1=tsq, $2=qTrim, $3=limit, $4+=filters

    if (redList) {
      filterParams.push(redList);
      filterClauses.push(`AND p."redListStatus" = $${filterParamStart + filterParams.length - 1}::"RedListStatus"`);
    } else if (endangered === 'true') {
      filterClauses.push(`AND p."redListStatus" IN (${ENDANGERED_SQL})`);
    } else if (endangered === 'false') {
      filterClauses.push(`AND p."redListStatus" NOT IN (${ENDANGERED_SQL})`);
    }
    if (bloomSeason) {
      filterParams.push(bloomSeason);
      filterClauses.push(`AND p."bloomSeason" = $${filterParamStart + filterParams.length - 1}::"BloomSeason"`);
    }
    if (family) {
      filterParams.push(family);
      filterClauses.push(`AND EXISTS (SELECT 1 FROM "Taxon" t WHERE t.id = p."taxonId" AND t.family = $${filterParamStart + filterParams.length - 1})`);
    }
    if (hasAdopters === 'true') filterClauses.push(`AND p."donorCount" > 0`);
    else if (hasAdopters === 'false') filterClauses.push(`AND p."donorCount" = 0`);

    // Offset mode: pull limit + offset, also count separately, both
    // dispatched in parallel.
    if (pageMode) {
      const rankedSql = `
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
          ${filterClauses.join('\n          ')}
          AND (
            p."searchText" @@ to_tsquery('simple', $1)
            OR p."nameEn" % $2
            OR p."nameFi" % $2
            OR p."nameSv" % $2
          )
        ORDER BY rank DESC, p."nameEn" ASC, p."id" ASC
        LIMIT $3 OFFSET $${filterParamStart + filterParams.length}
      `;
      const offset = (page - 1) * limit;
      const params = [tsq.length > 0 ? tsq : qTrim, qTrim, limit, ...filterParams, offset];
      const [ranked, countRes] = await Promise.all([
        this.prisma.$queryRawUnsafe<Array<{ id: string }>>(rankedSql, ...params),
        this.searchCount(q, redList, bloomSeason, family, hasAdopters, endangered),
      ]);
      const rankedIds = ranked.map((r) => r.id);
      const fullRows = rankedIds.length
        ? await this.prisma.plant.findMany({
            where: { id: { in: rankedIds } },
            include: { primaryImage: true, taxon: { select: { latinName: true, family: true } } },
          })
        : [];
      const byId = new Map(fullRows.map((r) => [r.id, r]));
      const items = rankedIds.map((id) => byId.get(id)).filter(Boolean);
      const total = countRes.total;
      return {
        items,
        page,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    }

    // Cursor mode (unchanged ranked-then-hydrate pattern). Returns
    // nextCursor for Load-More UIs.
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
        ${filterClauses.join('\n        ')}
        AND (
          p."searchText" @@ to_tsquery('simple', $1)
          OR p."nameEn" % $2
          OR p."nameFi" % $2
          OR p."nameSv" % $2
        )
      ORDER BY rank DESC, p."nameEn" ASC, p."id" ASC
      LIMIT $3
      `,
      ...[tsq.length > 0 ? tsq : qTrim, qTrim, limit + 1, ...filterParams],
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

  /**
   * Top plant families by count (for the family-filter dropdown). Returns
   * the N most-common family names with their plant counts so the UI can
   * surface them without scanning the whole taxon table.
   */
  @Get('families')
  async families(@Query('limit') limitStr?: string) {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '', 10) || 50, 1), 500);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ family: string; count: number }>>(
      `
      SELECT t.family, COUNT(*)::int AS count
      FROM "Plant" p
      JOIN "Taxon" t ON t.id = p."taxonId"
      WHERE p.status = 'active' AND t.family IS NOT NULL AND t.family <> ''
      GROUP BY t.family
      ORDER BY count DESC, t.family ASC
      LIMIT $1
      `,
      limit,
    );
    return { items: rows };
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

    // Latest completed donation — feeds the "Last supported N days ago"
    // engagement tile on the plant detail page. Computed on-demand instead of
    // denormalised because Donation status can flip in both directions
    // (pending → completed, completed → refunded, etc.) — chasing all those
    // edges to keep a column accurate is more error-prone than a single
    // indexed query.
    const lastDonation = await this.prisma.donation.findFirst({
      where: { plantId: plant.id, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    // Fire-and-forget: kick off background TTS generation for any locale
    // that's still missing. The current request returns immediately with
    // whatever narrations exist; a follow-up fetch (next visit / hard
    // reload) will see the new rows.
    this.narration.ensureGenerated(plant.id);

    // Resolve storage refs into a ROOT-RELATIVE /v1/files URL the browser
    // can stream. Handles both the legacy `s3://bucket/key` shape and the
    // current `local://key` shape. A relative path (not an absolute host)
    // means the <audio src> resolves against whatever origin the donor is
    // on — localhost / ngrok / production — and the web layer's same-origin
    // rewrite proxies it to the api. (A raw `local://…` is unplayable, and
    // a baked absolute host breaks on any other origin.)
    const narrations = plant.narrations.map((n) => {
      let key: string | null = null;
      if (n.audioUrl.startsWith('local://')) key = n.audioUrl.slice('local://'.length);
      else if (n.audioUrl.startsWith('s3://')) key = n.audioUrl.replace(/^s3:\/\/[^/]+\//, '');
      if (!key) return n; // already an http(s) URL or unknown shape — leave as-is
      return { ...n, audioUrl: `/v1/files/${key}` };
    });
    return {
      ...plant,
      narrations,
      lastDonatedAt: lastDonation?.createdAt ?? null,
    };
  }

  /**
   * Record a physical-label QR scan. Visitors landing on the public
   * plant page with ?qr=1 fire a single fire-and-forget POST here so we
   * can build "what's popular today" + the scan → donation funnel in
   * /admin.
   *
   * GDPR posture (data minimisation, Art. 5(1)(c)): neither the raw IP
   * nor the raw User-Agent is stored. The `visitorHash` is a keyed HMAC
   * (key = AUTH_SECRET) over `${utcDay}|${ip}|${ua}`. Because the daily
   * UTC date is mixed in, the salt rotates every 24h, so the same visitor
   * produces a DIFFERENT hash on a different day — it cannot be used as a
   * long-lived tracking key, only to collapse same-day refreshes into one
   * "session". The User-Agent is coarsened to a browser family (e.g.
   * "Chrome" / "Safari") rather than stored verbatim. We also bump
   * Plant.scanCount in the same transaction so list views can sort by
   * popularity cheaply.
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
    // Rotating daily salt: the UTC date is folded into the HMAC input so the
    // hash is unusable as a cross-day tracking key (see method docstring).
    // The HMAC key is AUTH_SECRET; fall back to a fixed dev key so localhost
    // works without env (prod always sets AUTH_SECRET — see docs/ENV.md).
    const visitorHash =
      ip || ua
        ? createHmac('sha256', process.env.AUTH_SECRET ?? 'bloomoulu-dev-scan-salt')
            .update(`${utcDayStamp()}|${ip}|${ua}`)
            .digest('hex')
        : '';
    await this.prisma.$transaction([
      this.prisma.plantScan.create({
        data: {
          plantId: plant.id,
          locale: dto.locale ?? 'fi',
          kioskId: dto.kioskId ?? null,
          visitorHash,
          // Coarsen to a browser family — never store the verbatim UA.
          userAgent: browserFamily(ua),
        },
      }),
      this.prisma.plant.update({
        where: { id: plant.id },
        data: { scanCount: { increment: 1 } },
      }),
    ]);
    return;
  }

  /**
   * Record a plain plant-detail page view (web or kiosk). Fired fire-and-
   * forget from the client on every mount. Cheap by design: just bumps
   * the denormalised Plant.viewCount counter — no per-view event table
   * (storage would dwarf the analytical value).
   *
   * For QR-specific telemetry (kioskId, visitorHash dedupe, conservation
   * funnel) use POST /:slug/scan instead.
   */
  @Post(':slug/view')
  @HttpCode(204)
  async recordView(@Param('slug') slug: string) {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!plant) throw new NotFoundException();
    await this.prisma.plant.update({
      where: { id: plant.id },
      data: { viewCount: { increment: 1 } },
    });
    return;
  }
}

/** Current UTC date as `YYYY-MM-DD` — the rotating salt for visitorHash. */
function utcDayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Coarsen a raw User-Agent string to a single browser-family token so the
 * stored value can never re-identify a visitor. Returns null when the UA is
 * empty/unknown so we don't persist a constant placeholder either.
 */
function browserFamily(ua: string): string | null {
  if (!ua) return null;
  // Order matters: Edge/Opera/Chrome all contain "Chrome"; Safari excludes
  // Chrome. Bots are bucketed so kiosk/QR analytics aren't skewed by crawlers.
  if (/\bbot\b|crawler|spider|slurp|bingpreview|headless/i.test(ua)) return 'Bot';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}
