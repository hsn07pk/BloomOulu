/**
 * Native-range enrichment from GBIF. Composes a "Native to …" string from
 * GBIF's curated botanical-region distribution, excluding introduced /
 * naturalised ranges. Ported from scripts/enrich-origin.ts.
 */
import { fetchJson } from '../http.js';
import type { SourceRef } from '../types.js';

const GBIF = 'https://api.gbif.org/v1';
const MAX_REGIONS = 8;

// Coarse WGSRPD rollups we skip in favour of granular botanical regions.
const COARSE = new Set([
  'global', 'world', 'north america', 'south america', 'northern america',
  'europe', 'asia', 'africa', 'australasia', 'antarctica', 'oceania',
  'asia-temperate', 'asia-tropical',
]);

function isCoarse(locality: string): boolean {
  const l = locality.toLowerCase();
  return COARSE.has(l) || l.includes('excluding');
}

/** Keep only clean, granular region names — drop blobs and bare ISO codes. */
function isUsableRegion(loc: string): boolean {
  if (!loc || loc.length > 48) return false;
  if (/[;[\]()]/.test(loc)) return false;
  if (/^[A-Za-z]{2,3}$/.test(loc)) return false;
  return !isCoarse(loc);
}

/** Compose a native-range string for a species from GBIF distribution data. */
export async function fetchOrigin(
  latin: string,
): Promise<{ origin: string; source: SourceRef } | null> {
  const match = await fetchJson(`${GBIF}/species/match?name=${encodeURIComponent(latin)}`);
  const key = match?.usageKey;
  if (!key) return null;

  const data = await fetchJson(`${GBIF}/species/${key}/distributions?limit=300`);
  const results: any[] = Array.isArray(data?.results) ? data.results : [];

  const regions: string[] = [];
  for (const r of results) {
    const estab = String(r?.establishmentMeans ?? '').toUpperCase();
    if (estab.includes('INTRODUC') || estab.includes('NATURAL') || estab.includes('INVASIV')) {
      continue; // introduced / naturalised — not part of the native range
    }
    const loc = String(r?.locality ?? '').trim();
    if (!isUsableRegion(loc)) continue;
    regions.push(loc);
  }
  const unique = [...new Set(regions)].sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) return null;

  const shown = unique.slice(0, MAX_REGIONS);
  let origin = `Native to ${shown.join(', ')}`;
  if (unique.length > MAX_REGIONS) {
    origin += ` and ${unique.length - MAX_REGIONS} other regions`;
  }
  return { origin, source: { provider: 'GBIF', url: `https://www.gbif.org/species/${key}` } };
}
