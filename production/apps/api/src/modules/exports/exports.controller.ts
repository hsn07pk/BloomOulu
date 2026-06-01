/**
 * Data lifecycle endpoints — ingest / create / export.
 *
 *   GET    /v1/exports/me/data            → GDPR donor data export (JSON)
 *   GET    /v1/exports/plants.csv         → Full plant catalogue as CSV
 *   GET    /v1/exports/plants.json        → Full plant catalogue as JSON
 *   POST   /v1/imports/plants             → Curator bulk plant import
 *                                            (CSV body OR JSON array)
 *
 * Donor data export is auth-protected (JWT bearer). The plant catalogue
 * is public (it's already shown on the homepage). The plant import is
 * protected by the OIDC shared-secret + checks the caller's role is
 * curator or admin via JWT bearer.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { RedListStatusEnum } from '@bloomoulu/constants';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { collectUserExport } from '../gdpr/gdpr.data.js';

const PlantImportRow = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  taxonLatinName: z.string().min(2),
  taxonFamily: z.string().min(2),
  nameEn: z.string(),
  nameFi: z.string(),
  nameSv: z.string(),
  redListStatus: RedListStatusEnum,
  bloomSeason: z.enum(['spring', 'summer', 'autumn', 'winter', 'all']),
  bloomWindow: z.string().optional(),
  origin: z.string(),
  habitat: z.string(),
  biome: z.string(),
  microLat: z.number().optional(),
  microLng: z.number().optional(),
  gardenZone: z.string().optional(),
  storyEn: z.string(),
  storyFi: z.string(),
  storySv: z.string(),
});
type PlantImportRowT = z.infer<typeof PlantImportRow>;

@Controller()
export class ExportsController {
  private readonly logger = new Logger(ExportsController.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GDPR donor data export. Returns every row tied to the authenticated
   * user across all tables. Format is intentionally machine-readable.
   *
   * Uses the shared collectUserExport so this synchronous path returns the
   * exact same complete set as the async export processor — passwordHash and
   * OAuth tokens are always stripped (see gdpr/gdpr.data.ts).
   */
  @Get('exports/me/data')
  @Roles('donor', 'curator', 'finance', 'admin')
  async exportMe(@CurrentUser() session: AuthenticatedUser) {
    const bundle = await collectUserExport(this.prisma, session.sub);
    if (!bundle) throw new UnauthorizedException();
    await this.prisma.dataExportRequest.create({
      data: { userId: session.sub, status: 'completed', completedAt: new Date() },
    });
    return bundle;
  }

  @Get('exports/plants.csv')
  async exportPlantsCsv(@Res() res: FastifyReply) {
    const rows = await this.prisma.plant.findMany({
      where: { status: 'active' },
      include: { taxon: true },
      orderBy: { nameEn: 'asc' },
    });
    const headers = [
      'slug',
      'taxon.latinName',
      'taxon.family',
      'nameEn',
      'nameFi',
      'nameSv',
      'redListStatus',
      'bloomSeason',
      'bloomWindow',
      'origin',
      'habitat',
      'biome',
      'microLat',
      'microLng',
      'gardenZone',
      'adopterCount',
    ];
    const lines = [headers.join(',')];
    for (const p of rows) {
      lines.push(
        [
          p.slug,
          p.taxon?.latinName ?? '',
          p.taxon?.family ?? '',
          p.nameEn,
          p.nameFi,
          p.nameSv,
          p.redListStatus,
          p.bloomSeason,
          p.bloomWindow ?? '',
          p.origin,
          p.habitat,
          p.biome,
          p.microLat?.toString() ?? '',
          p.microLng?.toString() ?? '',
          p.gardenZone ?? '',
          String(p.adopterCount),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    res.raw.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="bloomoulu-plants-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.raw.end(lines.join('\n'));
  }

  @Get('exports/plants.json')
  async exportPlantsJson() {
    const rows = await this.prisma.plant.findMany({
      where: { status: 'active' },
      include: {
        taxon: true,
        primaryImage: true,
        narrations: { select: { locale: true, durationMs: true } },
      },
      orderBy: { nameEn: 'asc' },
    });
    return {
      exportedAt: new Date().toISOString(),
      count: rows.length,
      plants: rows,
    };
  }

  /**
   * Curator bulk plant import. Accepts either:
   *   - JSON body: `{ rows: PlantImportRow[] }`
   *   - CSV body with `content-type: text/csv`
   *
   * Idempotent: upserts by slug. Returns per-row outcome.
   */
  @Post('imports/plants')
  @Roles('curator', 'admin')
  async importPlants(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: { rows?: unknown } | string,
  ) {
    let rows: PlantImportRowT[] = [];
    const contentType = (Array.isArray(headers['content-type']) ? headers['content-type'][0] : headers['content-type']) ?? '';
    if (contentType.includes('text/csv') && typeof body === 'string') {
      rows = parseCsv(body).map((r, i) => {
        const parsed = PlantImportRow.safeParse(r);
        if (!parsed.success) throw new BadRequestException(`row ${i + 1}: ${parsed.error.message}`);
        return parsed.data;
      });
    } else if (typeof body === 'object' && body !== null && Array.isArray((body as { rows?: unknown }).rows)) {
      rows = (body as { rows: unknown[] }).rows.map((r, i) => {
        const parsed = PlantImportRow.safeParse(r);
        if (!parsed.success) throw new BadRequestException(`row ${i + 1}: ${parsed.error.message}`);
        return parsed.data;
      });
    } else {
      throw new BadRequestException('body must be CSV or { rows: [...] }');
    }

    const results: Array<{ slug: string; created: boolean }> = [];
    for (const row of rows) {
      const taxon = await this.prisma.taxon.upsert({
        where: { latinName: row.taxonLatinName },
        create: { latinName: row.taxonLatinName, family: row.taxonFamily },
        update: { family: row.taxonFamily },
      });
      const before = await this.prisma.plant.findUnique({ where: { slug: row.slug }, select: { id: true } });
      await this.prisma.plant.upsert({
        where: { slug: row.slug },
        create: {
          slug: row.slug,
          taxonId: taxon.id,
          nameEn: row.nameEn,
          nameFi: row.nameFi,
          nameSv: row.nameSv,
          redListStatus: row.redListStatus,
          bloomSeason: row.bloomSeason,
          bloomWindow: row.bloomWindow ?? null,
          origin: row.origin,
          habitat: row.habitat,
          biome: row.biome,
          microLat: row.microLat ?? null,
          microLng: row.microLng ?? null,
          gardenZone: row.gardenZone ?? null,
          story: { en: row.storyEn, fi: row.storyFi, sv: row.storySv },
          quickFacts: [
            ['origin', row.origin],
            ['bloom', row.bloomWindow ?? row.bloomSeason],
            ['redList', row.redListStatus],
            ['habitat', row.habitat],
          ],
          status: 'hidden',
        },
        update: {
          nameEn: row.nameEn,
          nameFi: row.nameFi,
          nameSv: row.nameSv,
          redListStatus: row.redListStatus,
          bloomSeason: row.bloomSeason,
          bloomWindow: row.bloomWindow ?? null,
          origin: row.origin,
          habitat: row.habitat,
          biome: row.biome,
          microLat: row.microLat ?? null,
          microLng: row.microLng ?? null,
          gardenZone: row.gardenZone ?? null,
          story: { en: row.storyEn, fi: row.storyFi, sv: row.storySv },
        },
      });
      results.push({ slug: row.slug, created: !before });
    }
    return { ok: true, imported: results.length, results };
  }
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function parseCsv(input: string): Array<Record<string, unknown>> {
  const lines = input.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!);
  const out: Array<Record<string, unknown>> = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    const row: Record<string, unknown> = {};
    for (let h = 0; h < headers.length; h++) {
      const key = headers[h]!;
      const raw = fields[h] ?? '';
      // Coerce numeric coords
      if (key === 'microLat' || key === 'microLng') {
        row[key] = raw ? Number(raw) : undefined;
      } else {
        row[key] = raw;
      }
    }
    out.push(row);
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"') {
        inQ = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}
