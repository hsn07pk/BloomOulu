#!/usr/bin/env tsx
/**
 * Auto-populate plant photos from open data.
 *
 *   pnpm tsx scripts/enrich-images.ts [--limit N] [--slug <slug>] [--dry-run] [--force]
 *
 * For every plant with no primary image, this finds a properly-licensed
 * photo, stores it as a PlantImage row, and sets it as the plant's
 * primaryImage — which is what the plant page renders.
 *
 * Image sources, tried in order:
 *   1. Wikimedia Commons — the species' designated image on Wikidata (P18),
 *      resolved through the Commons API for the real licence + author.
 *   2. iNaturalist — the taxon's default photo, used when Commons has none.
 * Only openly-licensed photos are kept (CC0 / CC-BY / CC-BY-SA / public
 * domain); non-commercial and no-derivatives photos are skipped, since this
 * is a donation-funded site. The real licence + photographer credit is
 * stored per image.
 *
 * Robustness mirrors enrich-stories.ts: every request has a timeout and is
 * retried; a failure on one plant is logged and skipped — the run does not
 * crash. Idempotent and resumable: re-running skips plants that already
 * have an image.
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

const prisma = new PrismaClient();

const UA =
  'BloomOulu-ImageEnrich/1.0 (University of Oulu Botanical Garden adoption platform)';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const INAT_API = 'https://api.inaturalist.org/v1';
const REQUEST_TIMEOUT_MS = 20_000;
const IMAGE_WIDTH = 1280; // px — the scaled width we store for the hero image

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

/** GET JSON with a timeout + generous retry. Returns null on 404 / give-up; never throws. */
async function fetchJson(url: string, retries = 4): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(2000 * (attempt + 1));
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

// ── Source 1: Wikimedia Commons (via the Wikidata P18 image) ────────────────

async function wikimediaImage(latin: string): Promise<FoundImage | null> {
  const safe = latin.replace(/\\/g, '').replace(/"/g, '\\"');
  const sparql = `SELECT ?image WHERE { ?item wdt:P225 "${safe}" . ?item wdt:P18 ?image . } LIMIT 1`;
  const wd = await fetchJson(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`);
  const fileUrl = wd?.results?.bindings?.[0]?.image?.value as string | undefined;
  if (!fileUrl) return null;
  const filename = decodeURIComponent(fileUrl.split('Special:FilePath/')[1] ?? '');
  if (!filename) return null;

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: `File:${filename}`,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(IMAGE_WIDTH),
    iiextmetadatafilter: 'License|LicenseShortName|Artist|Credit',
  });
  const info = await fetchJson(`${COMMONS_API}?${params.toString()}`);
  const ii = info?.query?.pages?.[0]?.imageinfo?.[0];
  if (!ii) return null;

  const ext = ii.extmetadata ?? {};
  const licenseCode = String(ext.License?.value ?? '');
  const shortName = String(ext.LicenseShortName?.value ?? licenseCode);
  // A photo is usable only if its licence is clearly open (commercial OK).
  if (!licenseOk(licenseCode) && !licenseOk(shortName)) return null;

  const artist =
    stripHtml(String(ext.Artist?.value ?? '')).slice(0, 160) || 'Unknown photographer';
  return {
    url: ii.thumburl ?? ii.url,
    width: ii.thumbwidth ?? ii.width,
    height: ii.thumbheight ?? ii.height,
    licenseSpdx: normalizeLicense(licenseCode || shortName),
    attribution: `${artist} / Wikimedia Commons (${shortName || 'CC'})`,
  };
}

// ── Source 2: iNaturalist (the taxon's default photo) ───────────────────────

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
  const target = Math.min(work.length, args.limit);
  console.log(
    `${plants.length} loaded · ${plants.length - work.length} already have an image · ` +
      `processing ${target}.\n`,
  );

  let updated = 0;
  let noData = 0;
  let errors = 0;
  const byProvider: Record<string, number> = {};

  for (let i = 0; i < target; i++) {
    const plant = work[i]!;
    const n = i + 1;
    const latin = plant.taxon.latinName;
    try {
      let img = await wikimediaImage(latin);
      await sleep(250); // gentle on Wikidata / Commons
      let provider = 'Wikimedia Commons';
      if (!img) {
        img = await inaturalistImage(latin);
        await sleep(150); // gentle on iNaturalist
        provider = 'iNaturalist';
      }

      if (!img) {
        noData++;
        console.log(`[${n}/${target}] · ${latin} — no openly-licensed photo found`);
        continue;
      }

      byProvider[provider] = (byProvider[provider] ?? 0) + 1;

      if (args.dryRun) {
        console.log(
          `[${n}/${target}] DRY ${latin} — via ${provider} — ${img.licenseSpdx}\n` +
            `        ${img.url}`,
        );
      } else {
        await prisma.$transaction(async (tx) => {
          // --force may re-process a plant that already has images — clear them first.
          if (plant.primaryImageId) {
            await tx.plant.update({
              where: { id: plant.id },
              data: { primaryImageId: null },
            });
            await tx.plantImage.deleteMany({ where: { plantId: plant.id } });
          }
          const image = await tx.plantImage.create({
            data: {
              plantId: plant.id,
              url: img!.url,
              altEn: plant.nameEn,
              altFi: plant.nameFi,
              altSv: plant.nameSv,
              attribution: img!.attribution,
              licenseSpdx: img!.licenseSpdx,
              width: img!.width ?? null,
              height: img!.height ?? null,
            },
          });
          await tx.plant.update({
            where: { id: plant.id },
            data: { primaryImageId: image.id },
          });
        });
        updated++;
        console.log(`[${n}/${target}] + ${latin} — via ${provider} (${img.licenseSpdx})`);
      }
    } catch (err) {
      // One plant failing must never stop the run.
      errors++;
      console.error(`[${n}/${target}] ! ${latin} — ${(err as Error)?.message ?? String(err)}`);
    }
  }

  const provLine = Object.entries(byProvider)
    .map(([p, c]) => `${p}=${c}`)
    .join(' ');
  console.log(
    `\nDone. processed=${target} updated=${updated} no-photo=${noData} errors=${errors}` +
      (provLine ? `  (${provLine})` : ''),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
