/**
 * Conservation-status enrichment from the Finnish Red List 2019, via
 * laji.fi's token-free API. The bulk scripts/enrich-redlist.ts pages the
 * whole list; for one plant we resolve the taxon, then read its
 * latestRedListStatusFinland. Best-effort — returns null on any miss.
 */
import { fetchJson } from '../http.js';
import type { RedListCode, SourceRef } from '../types.js';

const LAJI = 'https://laji.fi/api';

// laji.fi IUCN code -> the project's RedListStatus enum.
const STATUS_MAP: Record<string, RedListCode> = {
  'MX.iucnLC': 'LC',
  'MX.iucnNT': 'NT',
  'MX.iucnVU': 'VU',
  'MX.iucnEN': 'EN',
  'MX.iucnCR': 'CR',
  'MX.iucnEW': 'EX', // extinct in the wild
  'MX.iucnEX': 'EX',
  'MX.iucnRE': 'EX', // regionally extinct — closest enum value
  'MX.iucnDD': 'DD',
  'MX.iucnNA': 'NA',
  'MX.iucnNE': 'NA', // not evaluated
};

/** Normalise a scientific name to "genus species", lower-case. */
function normName(name: string): string {
  return name.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ');
}

/** Resolve a plant's Finnish Red List 2019 category. Best-effort; null on miss. */
export async function fetchRedListStatus(
  latin: string,
): Promise<{ status: RedListCode; source: SourceRef } | null> {
  const search = await fetchJson(
    `${LAJI}/taxa/search?query=${encodeURIComponent(latin)}&limit=12&onlyFinnish=true`,
  );
  const results: any[] = Array.isArray(search)
    ? search
    : Array.isArray(search?.results)
      ? search.results
      : Array.isArray(search?.matches)
        ? search.matches
        : [];
  const want = normName(latin);
  const hit =
    results.find(
      (r) => normName(String(r?.scientificName ?? r?.matchingName ?? r?.name ?? '')) === want,
    ) ?? results[0];
  const id: string | undefined = hit?.id;
  if (!id) return null;

  const taxon = await fetchJson(
    `${LAJI}/taxa/${id}?selectedFields=scientificName,latestRedListStatusFinland&lang=en`,
  );
  const code = taxon?.latestRedListStatusFinland?.status as string | undefined;
  if (!code) return null;
  const status = STATUS_MAP[code];
  if (!status) return null;

  return {
    status,
    source: {
      provider: 'laji.fi — Finnish Red List 2019',
      license: 'CC-BY-4.0',
      url: `https://laji.fi/taxon/${id}`,
    },
  };
}
