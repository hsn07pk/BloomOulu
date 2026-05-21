/**
 * Image enrichment. Resolves a species' photo, preferring sources that do
 * NOT depend on the Wikidata Query Service (WDQS rate-limits hard):
 *   1. the Wikipedia article's lead image, via the REST summary API;
 *   2. the Wikidata P18 designated image;
 *   3. iNaturalist's default photo.
 * Only openly-licensed images are returned. enrich-plant.ts then hosts a
 * copy in our own object store. Ported from scripts/enrich-images.ts.
 */
import { fetchJson, stripHtml } from '../http.js';
import { licenseOk, normalizeLicense } from '../licenses.js';
import type { ResolvedImage } from '../types.js';

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const INAT_API = 'https://api.inaturalist.org/v1';
const WIKI_LANGS = ['en', 'fi', 'sv'] as const;
const IMAGE_WIDTH = 1280; // px — the scaled width we request from Commons

/** Extract a Commons file name from an upload.wikimedia.org image URL. */
function commonsFilenameFromUrl(url: string): string | null {
  if (!url || !url.includes('upload.wikimedia.org')) return null;
  // The REST summary API appends ?utm_* tracking params — drop query + hash.
  const parts = url.split('?')[0]!.split('#')[0]!.split('/');
  const thumbIdx = parts.indexOf('thumb');
  // thumb URL: …/commons/thumb/x/xy/<File>/<W>px-<File>  → <File> is +3.
  // original:  …/commons/x/xy/<File>                     → last segment.
  const raw = thumbIdx >= 0 ? (parts[thumbIdx + 3] ?? '') : (parts[parts.length - 1] ?? '');
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return raw;
  }
}

/** Resolve a Commons file name from the Wikipedia article's lead image. */
async function wikipediaImageFile(latin: string): Promise<string | null> {
  for (const lang of WIKI_LANGS) {
    const j = await fetchJson(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(latin)}`,
    );
    if (!j || j.type === 'disambiguation') continue;
    const src = String(j.originalimage?.source ?? j.thumbnail?.source ?? '');
    const file = commonsFilenameFromUrl(src);
    if (file) return file;
  }
  return null;
}

/** Resolve the Wikidata P18 image file name for a species. */
async function wikidataImageFile(latin: string): Promise<string | null> {
  const safe = latin.replace(/\\/g, '').replace(/"/g, '\\"');
  const sparql = `SELECT ?image WHERE { ?taxon wdt:P225 "${safe}" ; wdt:P18 ?image . } LIMIT 1`;
  const json = await fetchJson(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`);
  const value = json?.results?.bindings?.[0]?.image?.value as string | undefined;
  if (!value) return null;
  try {
    return decodeURIComponent(value.split('Special:FilePath/')[1] ?? '') || null;
  } catch {
    return null; // malformed percent-encoding
  }
}

/** Look up imageinfo (URL, size, licence, author) for a Commons file. */
async function commonsImage(filename: string): Promise<ResolvedImage | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: `File:${filename}`,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(IMAGE_WIDTH),
    iiextmetadatafilter: 'License|LicenseShortName|Artist',
  });
  const json = await fetchJson(`${COMMONS_API}?${params.toString()}`);
  const ii = json?.query?.pages?.[0]?.imageinfo?.[0];
  if (!ii) return null;
  const ext = ii.extmetadata ?? {};
  const licenseCode = String(ext.License?.value ?? '');
  const shortName = String(ext.LicenseShortName?.value ?? licenseCode);
  if (!licenseOk(licenseCode) && !licenseOk(shortName)) return null;
  const artist =
    stripHtml(String(ext.Artist?.value ?? '')).slice(0, 160) || 'Unknown photographer';
  const licenseSpdx = normalizeLicense(licenseCode || shortName);
  return {
    url: ii.thumburl ?? ii.url,
    width: ii.thumbwidth ?? ii.width,
    height: ii.thumbheight ?? ii.height,
    licenseSpdx,
    attribution: `${artist} / Wikimedia Commons (${shortName || 'CC'})`,
    source: {
      provider: 'Wikimedia Commons',
      license: licenseSpdx,
      url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`,
    },
  };
}

/** Fallback: the taxon's default photo from iNaturalist (exact name match only). */
async function inaturalistImage(latin: string): Promise<ResolvedImage | null> {
  const data = await fetchJson(
    `${INAT_API}/taxa?q=${encodeURIComponent(latin)}&rank=species&per_page=5`,
  );
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  const taxon = results.find((t) => String(t?.name ?? '').toLowerCase() === latin.toLowerCase());
  const photo = taxon?.default_photo;
  if (!photo) return null;
  const code = String(photo.license_code ?? '');
  if (!licenseOk(code)) return null;
  const medium = String(photo.medium_url ?? photo.url ?? '');
  if (!medium) return null;
  const url = medium.replace('/medium.', '/large.').replace('/square.', '/large.');
  const licenseSpdx = normalizeLicense(code);
  return {
    url,
    width: photo.original_dimensions?.width,
    height: photo.original_dimensions?.height,
    licenseSpdx,
    attribution: `${stripHtml(String(photo.attribution ?? '')).slice(0, 160) || 'iNaturalist contributor'} / iNaturalist`,
    source: {
      provider: 'iNaturalist',
      license: licenseSpdx,
      url: taxon?.id ? `https://www.inaturalist.org/taxa/${taxon.id}` : undefined,
    },
  };
}

/** Resolve a properly-licensed photo for a species. */
export async function fetchImage(latin: string): Promise<ResolvedImage | null> {
  // 1. Wikipedia article lead image — does not touch the Wikidata Query
  //    Service, so it stays reliable even when WDQS is rate-limiting.
  const wpFile = await wikipediaImageFile(latin);
  if (wpFile) {
    const img = await commonsImage(wpFile);
    if (img) return img;
  }
  // 2. Wikidata P18 designated image.
  const wdFile = await wikidataImageFile(latin);
  if (wdFile) {
    const img = await commonsImage(wdFile);
    if (img) return img;
  }
  // 3. iNaturalist default photo.
  return inaturalistImage(latin);
}
