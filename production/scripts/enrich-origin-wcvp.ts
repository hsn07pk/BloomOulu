#!/usr/bin/env tsx
/**
 * Bulk-load plant native ranges from Kew's World Checklist of Vascular
 * Plants (WCVP).
 *
 *   pnpm tsx scripts/enrich-origin-wcvp.ts [--dry-run] [--limit N] [--slug <slug>] [--force] [--refresh]
 *
 * A fast bulk pre-pass for origin enrichment. `enrich-origin.ts` queries
 * GBIF once per plant and stitches a range string from GBIF's heterogeneous
 * distribution records — slow, and noisy at this collection's scale. This
 * instead downloads Kew's WCVP checklist ONCE (~85 MB, cached on disk) and
 * reads each species' `geographic_area` — Kew's own curated, concise
 * native-range summary, e.g. "Europe to Iran" — with no per-plant network
 * traffic at all.
 *
 * Recommended order: run this first to fill the easy majority from Kew's
 * authoritative data, then run `enrich-origin.ts` to mop up the remainder
 * from GBIF.
 *
 * Matching: a plant is matched on its scientific name. WCVP records a
 * `geographic_area` only on Accepted taxa, so a name that resolves to a
 * synonym is followed to its accepted name via `accepted_plant_name_id`.
 *
 * The origin is written as "Native to <geographic_area>" — the same shape
 * enrich-origin.ts produces, so enrich-origin.ts then sees a real (non-
 * placeholder) origin and skips the row. Idempotent and resumable.
 *
 * Behaviour:
 *   * Default   — only fills plants whose origin is still a placeholder.
 *   * --force   — overwrite every matched plant's origin.
 *   * --slug    — process a single plant by slug (for testing).
 *   * --limit   — write at most N plants (the checklist is still fully parsed).
 *   * --dry-run — download + parse + report, write nothing.
 *   * --refresh — re-download the checklist even if a cached copy exists.
 *   * --cache-dir <path> — where to cache wcvp.zip (default: a temp dir).
 *
 * Source: World Checklist of Vascular Plants, Royal Botanic Gardens, Kew
 * (CC-BY 4.0).
 */

import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { mkdir, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const prisma = new PrismaClient();

const WCVP_URL = 'https://sftp.kew.org/pub/data-repositories/WCVP/wcvp.zip';
const WCVP_NAMES_CSV = 'wcvp_names.csv'; // the entry inside wcvp.zip we parse

// wcvp_names.csv is pipe-delimited; these are the 0-based columns we read.
// The header is validated at parse time so a Kew schema change fails loudly
// rather than silently writing garbage.
const COL = {
  plantNameId: 0,
  taxonStatus: 3,
  geographicArea: 18,
  taxonName: 21,
  acceptedPlantNameId: 23,
} as const;
const COL_NAMES: Record<number, string> = {
  [COL.plantNameId]: 'plant_name_id',
  [COL.taxonStatus]: 'taxon_status',
  [COL.geographicArea]: 'geographic_area',
  [COL.taxonName]: 'taxon_name',
  [COL.acceptedPlantNameId]: 'accepted_plant_name_id',
};

// Lower-cased substrings that mark an origin as a placeholder, not real
// data. Kept identical to enrich-origin.ts.
const ORIGIN_PLACEHOLDERS = ['pending', 'occurrence data'];

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  refresh: boolean;
  limit: number;
  slug?: string;
  cacheDir: string;
}

function parseArgs(): CliArgs {
  const out: CliArgs = {
    dryRun: false,
    force: false,
    refresh: false,
    limit: Infinity,
    cacheDir: path.join(os.tmpdir(), 'bloomoulu-wcvp'),
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i]!;
    if (v === '--dry-run') out.dryRun = true;
    else if (v === '--force') out.force = true;
    else if (v === '--refresh') out.refresh = true;
    else if (v === '--limit') out.limit = parseInt(process.argv[++i]!, 10);
    else if (v === '--slug') out.slug = process.argv[++i]!;
    else if (v === '--cache-dir') out.cacheDir = process.argv[++i]!;
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

/**
 * Scientific-name candidates to match against WCVP, best first: the full
 * name, then the bare genus + species binomial (so a name carrying
 * authorship, or a trinomial whose subspecies WCVP lacks, still resolves
 * to the species). Lower-cased for case-insensitive matching.
 */
function nameCandidates(latin: string): string[] {
  const clean = latin.trim().replace(/\s+/g, ' ');
  const tokens = clean.split(' ');
  const cands = new Set<string>();
  cands.add(clean.toLowerCase());
  if (tokens.length > 2) cands.add(tokens.slice(0, 2).join(' ').toLowerCase());
  return [...cands];
}

/** Run a child process, inheriting stderr; resolve on exit code 0. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

/** Ensure wcvp.zip is cached locally; download it (resumably) if not. */
async function ensureWcvp(args: CliArgs): Promise<string> {
  const file = path.join(args.cacheDir, 'wcvp.zip');
  if (!args.refresh) {
    try {
      const s = await stat(file);
      if (s.size > 1_000_000) {
        console.log(`  using cached checklist (${(s.size / 1e6).toFixed(0)} MB)`);
        return file;
      }
    } catch {
      // not cached — fall through to download
    }
  }
  const part = `${file}.part`;
  console.log(`  downloading ${WCVP_URL}`);
  // -C - resumes a partial .part file; rename-on-success means a file at the
  // final path is always complete.
  await run('curl', [
    '-L',
    '--fail',
    '--retry',
    '3',
    '--retry-delay',
    '2',
    '--progress-bar',
    '-C',
    '-',
    '-o',
    part,
    WCVP_URL,
  ]);
  await rename(part, file);
  const s = await stat(file);
  console.log(`  downloaded (${(s.size / 1e6).toFixed(0)} MB)`);
  return file;
}

/**
 * Stream wcvp_names.csv out of the zip and, in a single pass, collect:
 *   * idToGeo      — plant_name_id -> geographic_area, for every taxon that
 *                    has a native range (only Accepted taxa carry one).
 *   * nameResolve  — wanted scientific name -> the plant_name_id whose
 *                    geographic_area applies (its own if Accepted, else the
 *                    accepted name it is a synonym of). Accepted rows always
 *                    win over synonym rows for the same name.
 */
async function parseWcvpNames(
  zipFile: string,
  wantedNames: Set<string>,
  idToGeo: Map<string, string>,
  nameResolve: Map<string, string>,
): Promise<void> {
  const uz = spawn('unzip', ['-p', zipFile, WCVP_NAMES_CSV], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let spawnErr: Error | null = null;
  uz.on('error', (e) => {
    spawnErr = e;
  });

  const rl = createInterface({ input: uz.stdout!, crlfDelay: Infinity });
  let lines = 0;
  for await (const rawLine of rl) {
    lines++;
    // Line 1 is the header — validate the columns we depend on.
    if (lines === 1) {
      const header = rawLine.replace(/^﻿/, '').split('|');
      for (const [idx, name] of Object.entries(COL_NAMES)) {
        if (header[Number(idx)] !== name) {
          throw new Error(
            `WCVP schema mismatch: column ${idx} expected "${name}", got ` +
              `"${header[Number(idx)] ?? ''}" — wcvp_names.csv format changed.`,
          );
        }
      }
      continue;
    }
    if (lines % 400_000 === 0) {
      console.log(`    ${(lines / 1e6).toFixed(1)}M rows scanned, ${idToGeo.size} native ranges`);
    }
    const cols = rawLine.split('|');
    if (cols.length <= COL.acceptedPlantNameId) continue;
    const id = cols[COL.plantNameId]!;
    const geo = cols[COL.geographicArea]!.trim();
    if (geo) idToGeo.set(id, geo);
    const nameKey = cols[COL.taxonName]!.trim().toLowerCase();
    if (!nameKey || !wantedNames.has(nameKey)) continue;
    if (cols[COL.taxonStatus] === 'Accepted') {
      nameResolve.set(nameKey, id); // an Accepted row always wins
    } else if (!nameResolve.has(nameKey)) {
      const acceptedId = cols[COL.acceptedPlantNameId]!.trim();
      nameResolve.set(nameKey, acceptedId || id);
    }
  }
  if (spawnErr) throw spawnErr;
  if (lines === 0) {
    throw new Error(`unzip produced no output for ${zipFile} — is unzip installed and the file intact?`);
  }
}

/** Resolve a plant's WCVP native range, trying full name then binomial. */
function resolveGeo(
  latin: string,
  nameResolve: Map<string, string>,
  idToGeo: Map<string, string>,
): string | null {
  for (const cand of nameCandidates(latin)) {
    const resolveId = nameResolve.get(cand);
    if (!resolveId) continue;
    const geo = idToGeo.get(resolveId);
    if (geo) return geo;
  }
  return null;
}

async function main() {
  const args = parseArgs();
  console.log(
    `WCVP origin bulk-load — ${args.dryRun ? 'DRY RUN (no writes)' : 'writing'}` +
      `${args.force ? ', --force (overwrite all)' : ''}` +
      `${args.slug ? `, slug=${args.slug}` : ''}` +
      `${args.limit !== Infinity ? `, limit=${args.limit}` : ''}`,
  );

  // ── Plants whose origin is still a placeholder ──────────────────────────
  const plants = await prisma.plant.findMany({
    where: args.slug ? { slug: args.slug } : undefined,
    select: { id: true, slug: true, origin: true, taxon: { select: { latinName: true } } },
    orderBy: { slug: 'asc' },
  });
  const needy = args.force ? plants : plants.filter((p) => needsOrigin(p.origin));
  console.log(
    `${plants.length} plants · ${plants.length - needy.length} already have an origin · ` +
      `${needy.length} need one.`,
  );
  if (needy.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // ── Wanted scientific names ─────────────────────────────────────────────
  const wantedNames = new Set<string>();
  for (const p of needy) {
    for (const cand of nameCandidates(p.taxon.latinName)) wantedNames.add(cand);
  }

  // ── Download + parse the WCVP checklist ─────────────────────────────────
  await mkdir(args.cacheDir, { recursive: true });
  console.log(`\nChecklist cached in ${args.cacheDir} (~85 MB — delete to reclaim space).`);
  const zipFile = await ensureWcvp(args);
  console.log('  parsing wcvp_names.csv …');
  const idToGeo = new Map<string, string>();
  const nameResolve = new Map<string, string>();
  await parseWcvpNames(zipFile, wantedNames, idToGeo, nameResolve);
  console.log(
    `  parsed: ${idToGeo.size} native-range records · ` +
      `${nameResolve.size}/${wantedNames.size} wanted names found in WCVP.`,
  );

  // ── Resolve each plant to a native-range string ─────────────────────────
  const origins = new Map<string, string>(); // plant.id -> origin
  for (const p of needy) {
    const geo = resolveGeo(p.taxon.latinName, nameResolve, idToGeo);
    if (geo) origins.set(p.id, `Native to ${geo}`);
  }
  console.log(`\nMatched ${origins.size}/${needy.length} plants to a WCVP native range.`);
  if (origins.size === 0) {
    console.warn('warning: no plants matched — check that Taxon.latinName holds scientific names.');
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  const target = Math.min(needy.length, args.limit);
  let updated = 0;
  let noMatch = 0;
  console.log(`\nApplying to ${target} plant(s) …`);
  for (let i = 0; i < target; i++) {
    const plant = needy[i]!;
    const latin = plant.taxon.latinName;
    const origin = origins.get(plant.id);
    if (!origin) {
      noMatch++;
      continue;
    }
    if (args.dryRun) {
      console.log(`[${i + 1}/${target}] DRY ${latin} — ${origin}`);
      continue;
    }
    try {
      await prisma.plant.update({ where: { id: plant.id }, data: { origin } });
      updated++;
      console.log(`[${i + 1}/${target}] + ${latin} — ${origin}`);
    } catch (err) {
      console.error(`[${i + 1}/${target}] ! ${latin} — ${(err as Error)?.message ?? String(err)}`);
    }
  }

  console.log(
    `\nDone. plants=${plants.length} needed=${needy.length} ` +
      `matched=${origins.size} ${args.dryRun ? '' : `updated=${updated} `}` +
      `no-match-in-wcvp=${noMatch}`,
  );
  if (noMatch > 0 && !args.dryRun) {
    console.log('Unmatched plants can be filled by: pnpm tsx scripts/enrich-origin.ts');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
