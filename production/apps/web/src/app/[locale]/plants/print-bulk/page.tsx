/**
 * /[locale]/plants/print-bulk — bulk QR label sheet.
 *
 * Reads a list of slugs from `?slugs=a,b,c` (comma- or `+`-separated),
 * fetches each plant once on the server, and renders a printable A4 (or
 * any configured sheet size) packed with QR labels in a grid. Used by
 * garden staff to mass-print plant labels in one job — no toggling
 * between plant pages, no wasted paper.
 *
 * Every dimension is driven by query params so the admin's Bulk QR
 * page can pass any preset (Avery, DECAdry, custom) without changes
 * here. Cut-mark guides are drawn between cells so staff can slice
 * the sheet with a guillotine straight off the printer.
 */
import { notFound } from 'next/navigation';
import { getInternalApiUrl, getWebUrl } from '@bloomoulu/constants';
import { BulkQrSheet, type BulkPlant, type BulkSheetConfig } from './sheet.client';

export const dynamic = 'force-dynamic';

interface QueryParams {
  slugs?: string;
  // Sheet
  sheetW?: string;     // mm
  sheetH?: string;     // mm
  marginT?: string;    // mm (top)
  marginR?: string;
  marginB?: string;
  marginL?: string;
  // Grid
  cols?: string;
  rows?: string;
  gutterX?: string;
  gutterY?: string;
  // Per-label
  labelW?: string;
  labelH?: string;
  qrSize?: string;
  cutMarks?: string;   // "1" / "0"
  // Field toggles
  showLatin?: string;
  showCommon?: string;
  showRedList?: string;
  showZone?: string;
  showSlug?: string;
  // Tracking
  kiosk?: string;
  // Repeat each plant N times (lets staff print 2× of every label)
  repeat?: string;
  // Material hint — visual marker on the toolbar only
  material?: 'paper' | 'wood' | 'aluminum';
  // Title displayed in the toolbar
  title?: string;
}

interface PlantApiRow {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  gardenZone?: string | null;
  taxon?: { latinName?: string | null } | null;
}

async function fetchPlants(slugs: string[]): Promise<BulkPlant[]> {
  if (slugs.length === 0) return [];
  // We hit /v1/plants/:slug per slug. Could be optimized into a batch
  // endpoint later, but staff bulk prints typically max out around 100
  // plants per sheet, which the API handles fine with parallel fetches.
  const base = getInternalApiUrl().replace(/\/$/, '');
  const results = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const r = await fetch(`${base}/v1/plants/${encodeURIComponent(slug)}`, { cache: 'no-store' });
        if (!r.ok) return null;
        const d = (await r.json()) as PlantApiRow;
        return {
          slug: d.slug,
          nameEn: d.nameEn,
          nameFi: d.nameFi,
          nameSv: d.nameSv,
          redListStatus: d.redListStatus,
          gardenZone: d.gardenZone ?? null,
          latinName: d.taxon?.latinName ?? d.nameEn,
        } satisfies BulkPlant;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((p): p is BulkPlant => p !== null);
}

function parseSlugs(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .replace(/\+/g, ',')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function int(value: string | undefined, fallback: number, min = 1, max = 9999): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === '1' || value === 'true';
}

export default async function PrintBulkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<QueryParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const slugs = parseSlugs(sp.slugs);
  if (slugs.length === 0) notFound();

  const config: BulkSheetConfig = {
    sheetW: int(sp.sheetW, 210, 30, 1000),
    sheetH: int(sp.sheetH, 297, 30, 1000),
    marginT: int(sp.marginT, 8, 0, 100),
    marginR: int(sp.marginR, 5, 0, 100),
    marginB: int(sp.marginB, 8, 0, 100),
    marginL: int(sp.marginL, 5, 0, 100),
    cols: int(sp.cols, 3, 1, 20),
    rows: int(sp.rows, 7, 1, 30),
    gutterX: int(sp.gutterX, 2, 0, 30),
    gutterY: int(sp.gutterY, 2, 0, 30),
    labelW: int(sp.labelW, 63, 10, 300),
    labelH: int(sp.labelH, 38, 10, 300),
    qrSize: int(sp.qrSize, 28, 8, 250),
    cutMarks: flag(sp.cutMarks, true),
    showLatin: flag(sp.showLatin, true),
    showCommon: flag(sp.showCommon, true),
    showRedList: flag(sp.showRedList, true),
    showZone: flag(sp.showZone, false),
    showSlug: flag(sp.showSlug, false),
    kiosk: (sp.kiosk ?? '').trim(),
    repeat: int(sp.repeat, 1, 1, 20),
    material: (sp.material as 'paper' | 'wood' | 'aluminum') ?? 'paper',
    title: sp.title?.trim() ?? '',
  };

  const plants = await fetchPlants(slugs);
  // Repeat each plant N times when staff wants multiples per plant.
  const expanded: BulkPlant[] = [];
  for (const p of plants) {
    for (let i = 0; i < config.repeat; i++) expanded.push(p);
  }
  // Compose the per-label QR URL — same shape as the single-plant
  // print page so PlantScan tracking semantics are identical.
  const webBase = getWebUrl().replace(/\/$/, '');
  const buildQrUrl = (slug: string) => {
    const params = new URLSearchParams({ qr: '1' });
    if (config.kiosk) params.set('kiosk', config.kiosk);
    return `${webBase}/${locale}/plants/${slug}?${params}`;
  };
  const cells = expanded.map((p) => ({ plant: p, qrUrl: buildQrUrl(p.slug) }));

  return (
    <BulkQrSheet
      locale={locale as 'en' | 'fi' | 'sv'}
      config={config}
      cells={cells}
      missingCount={slugs.length - plants.length}
    />
  );
}
