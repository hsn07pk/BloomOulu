#!/usr/bin/env tsx
/**
 * Refresh plant origin / native range from GBIF.
 *
 *   pnpm tsx scripts/enrich-origin.ts [--limit N] [--slug <slug>] [--dry-run] [--force]
 *
 * For every plant whose origin is still a placeholder ("Origin pending",
 * "… occurrence data …", empty), this looks the species up on GBIF and
 * composes a native-range string from GBIF's distribution data — which
 * carries the WCVP botanical-region distribution, with introduced ranges
 * flagged. Introduced / naturalised regions are excluded.
 *
 * Result example: Plant.origin = "Native to Finland, Germany, Hungary, …".
 *
 * Robustness mirrors the other enrich scripts: every request has a timeout
 * and is retried; a failure on one plant is logged and skipped — the run
 * does not crash. Idempotent and resumable.
 *
 * Behaviour:
 *   * Default  — only fills plants whose origin is still a placeholder.
 *   * --force  — overwrite every matched plant's origin.
 *   * --slug   — process a single plant by slug (for testing).
 *   * --limit  — stop after N plants.
 *   * --dry-run— fetch + print, write nothing.
 */

import { PrismaClient } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';

const prisma = new PrismaClient();

const UA =
  'BloomOulu-OriginEnrich/1.0 (University of Oulu Botanical Garden adoption platform)';
const GBIF = 'https://api.gbif.org/v1';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REGIONS = 8; // cap on how many regions we list in the origin string

// Lower-cased substrings that mark an origin as a placeholder, not real data.
const ORIGIN_PLACEHOLDERS = ['pending', 'occurrence data'];

// Coarse WGSRPD rollups we skip in favour of the granular botanical regions.
const COARSE = new Set([
  'global',
  'world',
  'north america',
  'south america',
  'northern america',
  'europe',
  'asia',
  'africa',
  'australasia',
  'antarctica',
  'oceania',
  'asia-temperate',
  'asia-tropical',
]);

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

/** True if the plant's origin is still a placeholder and should be filled. */
function needsOrigin(origin: unknown): boolean {
  const text = typeof origin === 'string' ? origin.trim() : '';
  if (!text) return true;
  const low = text.toLowerCase();
  return ORIGIN_PLACEHOLDERS.some((m) => low.includes(m));
}

/** Skip coarse continent / world rollups; keep granular botanical regions. */
function isCoarse(locality: string): boolean {
  const l = locality.toLowerCase();
  return COARSE.has(l) || l.includes('excluding');
}

/**
 * GBIF distribution localities are wildly heterogeneous — some datasets give
 * a clean botanical-region name, others a 2,000-char compound blob with
 * inline [I]/[c] markers, others just a bare ISO country code. Keep only
 * clean, granular region names.
 */
function isUsableRegion(loc: string): boolean {
  if (!loc || loc.length > 48) return false; // empty, or a giant compound blob
  if (/[;[\]()]/.test(loc)) return false; // marked / compound blob
  if (/^[A-Za-z]{2,3}$/.test(loc)) return false; // bare ISO country code
  return !isCoarse(loc);
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

/** Compose a native-range string for a species from GBIF distribution data. */
async function gbifOrigin(latin: string): Promise<string | null> {
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
    // Use only the curated botanical region (locality). GBIF's `country`
    // field is occurrence-derived ("seen here"), not native range.
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
  return origin;
}

async function main() {
  const args = parseArgs();
  console.log(
    `Origin enrichment — ${args.dryRun ? 'DRY RUN (no writes)' : 'writing'}` +
      `${args.force ? ', --force (overwrite all)' : ''}` +
      `${args.slug ? `, slug=${args.slug}` : ''}` +
      `${args.limit !== Infinity ? `, limit=${args.limit}` : ''}`,
  );

  const plants = await prisma.plant.findMany({
    where: args.slug ? { slug: args.slug } : undefined,
    select: { id: true, slug: true, origin: true, taxon: { select: { latinName: true } } },
    orderBy: { slug: 'asc' },
  });

  const work = args.force ? plants : plants.filter((p) => needsOrigin(p.origin));
  const target = Math.min(work.length, args.limit);
  console.log(
    `${plants.length} loaded · ${plants.length - work.length} already have an origin · ` +
      `processing ${target}.\n`,
  );

  let updated = 0;
  let noData = 0;
  let errors = 0;

  for (let i = 0; i < target; i++) {
    const plant = work[i]!;
    const n = i + 1;
    const latin = plant.taxon.latinName;
    try {
      const origin = await gbifOrigin(latin);
      await sleep(300); // gentle on GBIF

      if (!origin) {
        noData++;
        console.log(`[${n}/${target}] · ${latin} — no distribution data`);
        continue;
      }

      if (args.dryRun) {
        console.log(`[${n}/${target}] DRY ${latin} — ${origin}`);
      } else {
        await prisma.plant.update({ where: { id: plant.id }, data: { origin } });
        updated++;
        console.log(`[${n}/${target}] + ${latin} — ${origin}`);
      }
    } catch (err) {
      // One plant failing must never stop the run.
      errors++;
      console.error(`[${n}/${target}] ! ${latin} — ${(err as Error)?.message ?? String(err)}`);
    }
  }

  console.log(`\nDone. processed=${target} updated=${updated} no-data=${noData} errors=${errors}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
