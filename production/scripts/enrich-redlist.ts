#!/usr/bin/env tsx
/**
 * Refresh plant conservation status from the Finnish Red List 2019.
 *
 *   pnpm tsx scripts/enrich-redlist.ts [--dry-run] [--limit N]
 *
 * Pulls the 2019 Red List category for plants from laji.fi's public web
 * feed (token-free — ~47 paginated requests, no throttling, about a minute
 * total) and updates Plant.redListStatus.
 *
 * laji.fi's list also covers non-native taxa recorded in Finland; those
 * carry "NA" (not applicable) — the correct value for cultivated / exotic
 * showcase plants. To protect curator-set data, a plant that already has a
 * meaningful status is never downgraded to "NA" (pass --force to override).
 *
 * Source: laji.fi / FinBIF — Red List of Finnish Species 2019 (CC-BY 4.0).
 */

import { PrismaClient } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';

const prisma = new PrismaClient();

const UA =
  'BloomOulu-RedListEnrich/1.0 (University of Oulu Botanical Garden adoption platform)';
const LAJI = 'https://laji.fi/api';
const VASCULAR_PLANTS = 'MX.37600'; // FinBIF informal group: vascular plants
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 100; // safety cap (the Finnish vascular flora is ~47 pages)

// laji.fi Red List code -> the project's RedListStatus enum (LC/NT/VU/EN/CR/EX/DD/NA).
const STATUS_MAP: Record<string, string> = {
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

interface CliArgs {
  dryRun: boolean;
  limit: number;
  force: boolean;
}

function parseArgs(): CliArgs {
  const out: CliArgs = { dryRun: false, limit: Infinity, force: false };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i]!;
    if (v === '--dry-run') out.dryRun = true;
    else if (v === '--limit') out.limit = parseInt(process.argv[++i]!, 10);
    else if (v === '--force') out.force = true;
  }
  if (Number.isNaN(out.limit)) out.limit = Infinity;
  return out;
}

/** Normalise a scientific name to "genus species" (lower-case, no authorship). */
function normName(name: string): string {
  return name.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ');
}

/** GET JSON with a timeout + retry. Returns null on give-up; never throws. */
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
        console.warn(`    request failed (HTTP ${res.status}): ${url.slice(0, 90)}`);
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
        console.warn(`    request failed (${reason}): ${url.slice(0, 90)}`);
      }
    }
  }
  return null;
}

/** Pull the whole Finnish vascular-plant Red List into a name -> status map. */
async function loadRedList(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let unmapped = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${LAJI}/taxa/${VASCULAR_PLANTS}/species?onlyFinnish=true&pageSize=1000` +
      `&page=${page}&lang=en&selectedFields=scientificName,latestRedListStatusFinland`;
    const data = await fetchJson(url);
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    for (const r of results) {
      const name = String(r?.scientificName ?? '').trim();
      const code = r?.latestRedListStatusFinland?.status as string | undefined;
      if (!name || !code) continue;
      const status = STATUS_MAP[code];
      if (status) map.set(normName(name), status);
      else unmapped++;
    }
    console.log(`  page ${page}: ${results.length} taxa  (red-list map: ${map.size})`);
    if (!data || results.length === 0) break;
    if (typeof data.lastPage === 'number' && page >= data.lastPage) break;
    await sleep(200); // courtesy pause
  }
  if (unmapped > 0) console.warn(`  note: ${unmapped} taxa had an unrecognised status code`);
  return map;
}

async function main() {
  const args = parseArgs();
  console.log(`Red List enrichment — ${args.dryRun ? 'DRY RUN (no writes)' : 'writing'}`);

  console.log('Fetching the Finnish Red List 2019 from laji.fi …');
  const redList = await loadRedList();
  console.log(`Red List loaded: ${redList.size} Finnish vascular-plant taxa.\n`);
  if (redList.size === 0) {
    console.error('No Red List data fetched — aborting (check the laji.fi feed).');
    process.exit(1);
  }

  const plants = await prisma.plant.findMany({
    select: { id: true, slug: true, redListStatus: true, taxon: { select: { latinName: true } } },
    orderBy: { slug: 'asc' },
  });

  let matched = 0;
  let changed = 0;
  let updated = 0;
  let unchanged = 0;
  let protectedCount = 0;
  let notInList = 0;
  const toStatus: Record<string, number> = {};

  for (const plant of plants) {
    const status = redList.get(normName(plant.taxon.latinName));
    if (!status) {
      notInList++;
      continue;
    }
    matched++;
    if (status === plant.redListStatus) {
      unchanged++;
      continue;
    }
    // Never downgrade an already-meaningful (curator-set) status to "NA" —
    // e.g. a globally-threatened showcase exotic the Finnish list marks
    // "not applicable". Every other change is a safe correction.
    if (plant.redListStatus !== 'LC' && status === 'NA' && !args.force) {
      protectedCount++;
      continue;
    }
    changed++;
    toStatus[status] = (toStatus[status] ?? 0) + 1;
    if (changed > args.limit) continue; // counted, but past --limit we don't act/print
    try {
      if (args.dryRun) {
        console.log(`DRY ${plant.taxon.latinName}  ${plant.redListStatus} -> ${status}`);
      } else {
        await prisma.plant.update({
          where: { id: plant.id },
          data: { redListStatus: status as any },
        });
        updated++;
        console.log(`+ ${plant.taxon.latinName}  ${plant.redListStatus} -> ${status}`);
      }
    } catch (err) {
      console.error(`! ${plant.taxon.latinName} — ${(err as Error)?.message ?? String(err)}`);
    }
  }

  const breakdown = Object.entries(toStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${s}:${c}`)
    .join(' ');
  console.log(
    `\nDone. plants=${plants.length} matched-to-redlist=${matched} would-change=${changed} ` +
      `${args.dryRun ? '' : `updated=${updated} `}already-correct=${unchanged} ` +
      `protected=${protectedCount} not-in-finnish-list=${notInList}`,
  );
  if (breakdown) console.log(`Change breakdown (-> new status): ${breakdown}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
