#!/usr/bin/env tsx
/**
 * Auto-populate plant photos from open data — batched for the whole
 * collection.
 *
 *   pnpm tsx scripts/enrich-images.ts [--limit N] [--slug <slug>] [--dry-run] [--force]
 *
 * For every plant with no primary image, this finds a properly-licensed
 * photo, stores it as a PlantImage row, and sets it as the plant's
 * primaryImage — which is what the plant page renders.
 *
 * Image sources:
 *   1. Wikimedia Commons — the species' designated image on Wikidata (P18),
 *      resolved through the Commons API for the real licence + author. Both
 *      lookups are BATCHED: one SPARQL query resolves up to 200 species'
 *      images, and the Commons API takes 50 files per request — ~120
 *      requests for the whole collection instead of two per plant.
 *      Wikidata's query service still throttles sustained load, so the run
 *      honours its Retry-After header and paces the batches well apart.
 *   2. iNaturalist — the taxon's default photo, looked up per-plant for the
 *      plants Commons has no usable image for (iNaturalist has no
 *      batch-by-name API, so this is the slower tail of the run).
 * Only openly-licensed photos are kept (CC0 / CC-BY / CC-BY-SA / public
 * domain); non-commercial and no-derivatives photos are skipped, since this
 * is a donation-funded site. The real licence + photographer credit is
 * stored per image.
 *
 * Robustness: every request has a timeout and is retried; a failure on one
 * batch or one plant is logged and skipped — the run does not crash.
 * Idempotent and resumable: re-running skips plants that already have an
 * image.
 *
 * Behaviour:
 *   * Default  — only fills plants WITHOUT a primary image.
 *   * --force  — refresh every matched plant (replaces existing images).
 *   * --slug   — process a single plant by slug (for testing).
 *   * --limit  — stop after N plants.
 *   * --dry-run— fetch + print, write nothing.
 */

import { PrismaClient } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';
// Reuse the API's image-hosting helper so this script can't accidentally
// drift from how the live enrichment flow hosts images. Every PlantImage
// row that this script creates ends up with a self-hosted URL — we never
// leave a row pointing at an external host.
import { hostPlantImage } from '../apps/api/src/modules/enrichment/image-store.js';

const prisma = new PrismaClient();

const UA =
  'BloomOulu-ImageEnrich/1.0 (University of Oulu Botanical Garden adoption platform)';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const INAT_API = 'https://api.inaturalist.org/v1';
const REQUEST_TIMEOUT_MS = 20_000;
const SPARQL_TIMEOUT_MS = 45_000; // a batched SPARQL query takes longer
const IMAGE_WIDTH = 1280; // px — the scaled width we store for the hero image
const WIKIDATA_BATCH = 200; // species names per SPARQL query
const COMMONS_BATCH = 50; // file titles per Commons API request (the API maximum)

interface CliArgs {
  limit: number;
  slug?: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): CliArgs {
  const out: CliArgs = { limit: Infinity, dryRun: false, force: false };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i]!;
    if (v === '--limit') out.limit = parseInt(process.argv[++i]!, 10);
    else if (v === '--slug') out.slug = process.argv[++i]!;
    else if (v === '--dry-run') out.dryRun = true;
    else if (v === '--force') out.force = true;
  }
  if (Number.isNaN(out.limit)) out.limit = Infinity;
  return out;
}

/** Split an array into fixed-size chunks. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Strip HTML tags + decode the entities that turn up in Commons credit fields. */
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** True only for licences we may reuse on a public, donation-funded site. */
function licenseOk(license: string | null | undefined): boolean {
  const l = (license ?? '').toLowerCase();
  if (!l) return false;
  if (l.includes('-nc') || l.includes('-nd') || l.includes('noncommercial') || l.includes('noderiv'))
    return false;
  return (
    l.includes('cc0') ||
    l.includes('zero') ||
    l.includes('publicdomain') ||
    l.includes('public domain') ||
    l.includes('cc-by') ||
    l.includes('/by/') ||
    l.includes('by-sa') ||
    l.includes('attribution')
  );
}

/** Normalise a licence code/name to a short SPDX-ish identifier. */
function normalizeLicense(raw: string): string {
  const l = raw.toLowerCase().trim();
  if (!l) return 'unknown';
  if (l.includes('cc0') || l.includes('zero')) return 'CC0-1.0';
  if (l.includes('public') && l.includes('domain')) return 'Public-Domain';
  const m = l.match(/by(-sa)?(-\d(\.\d)?)?/);
  if (m) return `CC-BY${m[1] ? '-SA' : ''}${m[2] ?? '-4.0'}`;
  return raw.toUpperCase();
}

interface FetchOpts {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Parse a 429/503 `Retry-After` header — delay-seconds or an HTTP date —
 * into milliseconds, capped at 2 min. Null when absent or unparseable.
 */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 120_000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 120_000);
  return null;
}

/** Fetch JSON with a timeout + generous retry. Returns null on 404 / give-up; never throws. */
async function fetchJson(url: string, opts: FetchOpts = {}): Promise<any | null> {
  const { method = 'GET', body, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, retries = 4 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'user-agent': UA, accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          // Honour the server's Retry-After when it sends one (WDQS does).
          await sleep(retryAfterMs(res) ?? 2000 * (attempt + 1));
          continue;
        }
        console.warn(`    request failed (HTTP ${res.status}): ${url.slice(0, 80)}`);
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      const reason =
        (err as Error)?.name === 'TimeoutError'
          ? 'timed out'
          : ((err as Error)?.message ?? 'network error');
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
      } else {
        console.warn(`    request failed (${reason}): ${url.slice(0, 80)}`);
      }
    }
  }
  return null;
}

interface FoundImage {
  url: string;
  licenseSpdx: string;
  attribution: string;
  width?: number;
  height?: number;
}

// ── Source 1: Wikimedia Commons (via the Wikidata P18 image), batched ───────

/**
 * Resolve the Wikidata P18 image for a batch of scientific names in one
 * SPARQL query. Returns a lower-cased-name -> Commons filename map.
 */
async function wikidataImagesBatch(names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (names.length === 0) return out;
  const values = names
    .map((n) => `"${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(' ');
  const query =
    `SELECT ?name ?image WHERE { VALUES ?name { ${values} } ` +
    `?taxon wdt:P225 ?name ; wdt:P18 ?image . }`;
  const json = await fetchJson(WIKIDATA_SPARQL, {
    method: 'POST',
    body: new URLSearchParams({ query, format: 'json' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeoutMs: SPARQL_TIMEOUT_MS,
  });
  const bindings: any[] = json?.results?.bindings ?? [];
  for (const b of bindings) {
    const name = String(b?.name?.value ?? '').toLowerCase();
    const fileUrl = String(b?.image?.value ?? '');
    if (!name || !fileUrl) continue;
    let filename = '';
    try {
      filename = decodeURIComponent(fileUrl.split('Special:FilePath/')[1] ?? '');
    } catch {
      filename = ''; // malformed percent-encoding — skip this one
    }
    if (filename && !out.has(name)) out.set(name, filename);
  }
  return out;
}

/** Canonicalise a Commons filename for matching (case + underscores ↔ spaces). */
function normalizeFileKey(name: string): string {
  const s = name.replace(/_/g, ' ').trim().replace(/\s+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Fetch imageinfo (URL, size, licence, author) for a batch of Commons files
 * in one API request. Returns a normalised-filename -> FoundImage map,
 * including only photos with a clearly open licence.
 */
async function commonsImageInfoBatch(filenames: string[]): Promise<Map<string, FoundImage>> {
  const out = new Map<string, FoundImage>();
  if (filenames.length === 0) return out;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: filenames.map((f) => `File:${f}`).join('|'),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(IMAGE_WIDTH),
    iiextmetadatafilter: 'License|LicenseShortName|Artist|Credit',
  });
  const json = await fetchJson(`${COMMONS_API}?${params.toString()}`);
  const pages: any[] = json?.query?.pages ?? [];
  for (const page of pages) {
    const ii = page?.imageinfo?.[0];
    const title = String(page?.title ?? '').replace(/^File:/i, '');
    if (!ii || !title) continue;
    const ext = ii.extmetadata ?? {};
    const licenseCode = String(ext.License?.value ?? '');
    const shortName = String(ext.LicenseShortName?.value ?? licenseCode);
    // A photo is usable only if its licence is clearly open (commercial OK).
    if (!licenseOk(licenseCode) && !licenseOk(shortName)) continue;
    const artist =
      stripHtml(String(ext.Artist?.value ?? '')).slice(0, 160) || 'Unknown photographer';
    out.set(normalizeFileKey(title), {
      url: ii.thumburl ?? ii.url,
      width: ii.thumbwidth ?? ii.width,
      height: ii.thumbheight ?? ii.height,
      licenseSpdx: normalizeLicense(licenseCode || shortName),
      attribution: `${artist} / Wikimedia Commons (${shortName || 'CC'})`,
    });
  }
  return out;
}

/**
 * Batch-resolve Wikimedia Commons photos for many plants. Two batched
 * passes — Wikidata for the P18 image, then Commons for licence + URL —
 * keep the whole thing to ~120 requests for a collection of thousands.
 */
async function resolveWikimedia(
  plants: { id: string; latin: string }[],
): Promise<Map<string, FoundImage>> {
  // Pass 1 — Wikidata P18, batched by name.
  const uniqueNames = [...new Set(plants.map((p) => p.latin))];
  const nameToFile = new Map<string, string>(); // lower-name -> filename
  const nameBatches = chunk(uniqueNames, WIKIDATA_BATCH);
  for (let i = 0; i < nameBatches.length; i++) {
    const got = await wikidataImagesBatch(nameBatches[i]!);
    for (const [k, v] of got) nameToFile.set(k, v);
    console.log(
      `  Wikidata batch ${i + 1}/${nameBatches.length}: +${got.size} images (total ${nameToFile.size})`,
    );
    if (i < nameBatches.length - 1) await sleep(3000); // WDQS throttles sustained load
  }

  // Pass 2 — Commons imageinfo, batched by file.
  const uniqueFiles = [...new Set(nameToFile.values())];
  const fileToImage = new Map<string, FoundImage>(); // normalised filename -> image
  const fileBatches = chunk(uniqueFiles, COMMONS_BATCH);
  for (let i = 0; i < fileBatches.length; i++) {
    const got = await commonsImageInfoBatch(fileBatches[i]!);
    for (const [k, v] of got) fileToImage.set(k, v);
    if ((i + 1) % 10 === 0 || i === fileBatches.length - 1) {
      console.log(
        `  Commons batch ${i + 1}/${fileBatches.length}: ${fileToImage.size} openly-licensed photos`,
      );
    }
    if (i < fileBatches.length - 1) await sleep(1000); // gentle on Commons
  }

  // Join — plant -> image.
  const resolved = new Map<string, FoundImage>();
  for (const p of plants) {
    const file = nameToFile.get(p.latin.toLowerCase());
    if (!file) continue;
    const img = fileToImage.get(normalizeFileKey(file));
    if (img) resolved.set(p.id, img);
  }
  return resolved;
}

// ── Source 2: iNaturalist (the taxon's default photo), per-plant ────────────

async function inaturalistImage(latin: string): Promise<FoundImage | null> {
  const data = await fetchJson(
    `${INAT_API}/taxa?q=${encodeURIComponent(latin)}&rank=species&per_page=5`,
  );
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  // Only an exact name match — never attach a different species' photo.
  const taxon = results.find((t) => String(t?.name ?? '').toLowerCase() === latin.toLowerCase());
  const photo = taxon?.default_photo;
  if (!photo) return null;
  const code = String(photo.license_code ?? '');
  if (!licenseOk(code)) return null;
  const medium = String(photo.medium_url ?? photo.url ?? '');
  if (!medium) return null;
  const url = medium.replace('/medium.', '/large.').replace('/square.', '/large.');
  return {
    url,
    width: photo.original_dimensions?.width,
    height: photo.original_dimensions?.height,
    licenseSpdx: normalizeLicense(code),
    attribution: `${stripHtml(String(photo.attribution ?? '')).slice(0, 160) || 'iNaturalist contributor'} / iNaturalist`,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.log(
    `Image enrichment — ${args.dryRun ? 'DRY RUN (no writes)' : 'writing'}` +
      `${args.force ? ', --force (replace existing)' : ''}` +
      `${args.slug ? `, slug=${args.slug}` : ''}` +
      `${args.limit !== Infinity ? `, limit=${args.limit}` : ''}`,
  );

  const plants = await prisma.plant.findMany({
    where: args.slug ? { slug: args.slug } : undefined,
    select: {
      id: true,
      slug: true,
      primaryImageId: true,
      nameEn: true,
      nameFi: true,
      nameSv: true,
      taxon: { select: { latinName: true } },
    },
    orderBy: { slug: 'asc' },
  });

  const work = args.force ? plants : plants.filter((p) => !p.primaryImageId);
  const target = work.slice(0, args.limit);
  console.log(
    `${plants.length} loaded · ${plants.length - work.length} already have an image · ` +
      `processing ${target.length}.\n`,
  );
  if (target.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // ── Phase 1 — Wikimedia Commons, batched ──────────────────────────────
  console.log('Phase 1 — Wikimedia Commons (batched) …');
  const wikimedia = await resolveWikimedia(
    target.map((p) => ({ id: p.id, latin: p.taxon.latinName })),
  );
  console.log(`Wikimedia resolved ${wikimedia.size}/${target.length} plants.\n`);

  // ── Phase 2 — per-plant: iNaturalist fallback, then write ─────────────
  console.log('Phase 2 — iNaturalist fallback + write …');
  let updated = 0;
  let noData = 0;
  let errors = 0;
  const byProvider: Record<string, number> = {};

  for (let i = 0; i < target.length; i++) {
    const plant = target[i]!;
    const n = i + 1;
    const latin = plant.taxon.latinName;
    try {
      let img = wikimedia.get(plant.id) ?? null;
      let provider = 'Wikimedia Commons';
      if (!img) {
        img = await inaturalistImage(latin);
        await sleep(700); // gentle on iNaturalist
        provider = 'iNaturalist';
      }

      if (!img) {
        noData++;
        console.log(`[${n}/${target.length}] · ${latin} — no openly-licensed photo found`);
        continue;
      }

      byProvider[provider] = (byProvider[provider] ?? 0) + 1;

      if (args.dryRun) {
        console.log(
          `[${n}/${target.length}] DRY ${latin} — via ${provider} — ${img.licenseSpdx}\n` +
            `        ${img.url}`,
        );
      } else {
        // Create the row first so we have a stable id to key the S3
        // object by. If hosting fails, roll back the row so we don't
        // leave a PlantImage pointing at an unfetchable upstream URL —
        // exactly the failure mode that produced the 225 dead seed
        // images cleaned up in 2026-05-24.
        if (plant.primaryImageId) {
          await prisma.plant.update({
            where: { id: plant.id },
            data: { primaryImageId: null },
          });
          await prisma.plantImage.deleteMany({ where: { plantId: plant.id } });
        }
        const draftImage = await prisma.plantImage.create({
          data: {
            plantId: plant.id,
            url: img.url,
            altEn: plant.nameEn,
            altFi: plant.nameFi,
            altSv: plant.nameSv,
            attribution: img.attribution,
            licenseSpdx: img.licenseSpdx,
            width: img.width ?? null,
            height: img.height ?? null,
          },
        });
        const hosted = await hostPlantImage(img.url, draftImage.id);
        if (!hosted) {
          await prisma.plantImage.delete({ where: { id: draftImage.id } });
          errors++;
          console.error(
            `[${n}/${target.length}] ! ${latin} — image host failed; row rolled back`,
          );
          continue;
        }
        await prisma.plantImage.update({
          where: { id: draftImage.id },
          data: { url: hosted },
        });
        await prisma.plant.update({
          where: { id: plant.id },
          data: { primaryImageId: draftImage.id },
        });
        updated++;
        console.log(`[${n}/${target.length}] + ${latin} — via ${provider} (${img.licenseSpdx})`);
      }
    } catch (err) {
      // One plant failing must never stop the run.
      errors++;
      console.error(`[${n}/${target.length}] ! ${latin} — ${(err as Error)?.message ?? String(err)}`);
    }
  }

  const provLine = Object.entries(byProvider)
    .map(([p, c]) => `${p}=${c}`)
    .join(' ');
  console.log(
    `\nDone. processed=${target.length} updated=${updated} no-photo=${noData} errors=${errors}` +
      (provLine ? `  (${provLine})` : ''),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
