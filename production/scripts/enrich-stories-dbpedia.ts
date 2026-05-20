#!/usr/bin/env tsx
/**
 * Bulk-load plant stories from DBpedia's short-abstract dumps.
 *
 *   pnpm tsx scripts/enrich-stories-dbpedia.ts [--dry-run] [--limit N] [--slug <slug>] [--force] [--refresh]
 *
 * A fast bulk pre-pass for story enrichment. `enrich-stories.ts` queries
 * Wikipedia / GBIF / EOL once per plant — slow (~4 requests each) and, at
 * this collection's scale, throttled to a crawl by Wikipedia's rate limit.
 * This instead downloads DBpedia's whole English + Swedish short-abstract
 * dumps ONCE (~720 MB, cached on disk) and matches every plant locally,
 * with no per-plant network traffic at all.
 *
 * Recommended order: run this first to fill the easy majority, then run
 * `enrich-stories.ts` to mop up the remainder (synonyms, articles titled
 * with a vernacular name) plant-by-plant.
 *
 * Matching: a plant is matched when its scientific name is also its
 * Wikipedia article title — the WP:FLORA convention, which holds for most
 * species. Names that don't match simply fall through to enrich-stories.ts.
 *
 * Languages: the DBpedia 2022.12.01 generic release ships English and
 * Swedish abstracts but no Finnish, so Plant.story.fi is gap-filled with
 * the English text.
 *
 * Compatibility: the story is written with the same { en, fi, sv, source }
 * shape and a populated `source.provider`, so enrich-stories.ts treats
 * these rows as already-enriched and skips them — a partially-completed
 * enrich-stories.ts run is preserved, not overwritten. Idempotent and
 * resumable: just re-run it.
 *
 * Behaviour:
 *   * Default   — only fills plants WITHOUT a real story; curator-written
 *                 and already-enriched stories are left untouched.
 *   * --force   — overwrite every matched plant's story.
 *   * --slug    — process a single plant by slug (for testing).
 *   * --limit   — write at most N plants (the dumps are still fully parsed).
 *   * --dry-run — download + parse + report, write nothing.
 *   * --refresh — re-download the dumps even if a cached copy exists.
 *   * --cache-dir <path> — where to cache the dumps (default: a temp dir).
 *
 * Source: DBpedia 2022.12.01 short-abstracts — extracted from Wikipedia,
 * CC-BY-SA 3.0.
 */

import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { mkdir, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const prisma = new PrismaClient();

const DUMP_VERSION = '2022.12.01';
const DBPEDIA_BASE = `https://downloads.dbpedia.org/repo/dbpedia/text/short-abstracts/${DUMP_VERSION}`;

// DBpedia 2022.12.01 ships English + Swedish short abstracts but no Finnish,
// so Finnish stories are gap-filled with English (see buildStory below).
const DUMP_LANGS = ['en', 'sv'] as const;
type DumpLang = (typeof DUMP_LANGS)[number];

// Discard abstracts shorter than this — usually parser noise, not prose.
const MIN_ABSTRACT = 40;

// Lower-cased substrings that mark a story as a placeholder, not real
// content. Kept identical to enrich-stories.ts so both scripts agree on
// which plants still need a story.
const PLACEHOLDER_MARKERS = ['curator to write', 'imported from the garden', 'pending'];

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
    cacheDir: path.join(os.tmpdir(), 'bloomoulu-dbpedia'),
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

/** True if the plant has no usable story (empty or a known placeholder). */
function needsStory(story: unknown): boolean {
  if (!story || typeof story !== 'object') return true;
  const en = (story as Record<string, unknown>).en;
  const text = typeof en === 'string' ? en.trim() : '';
  if (!text) return true;
  const low = text.toLowerCase();
  return PLACEHOLDER_MARKERS.some((m) => low.includes(m));
}

/** True if a previous enrichment run (this script or enrich-stories.ts)
 *  already wrote a story for this plant. */
function alreadyEnriched(story: unknown): boolean {
  return (
    !!story &&
    typeof story === 'object' &&
    typeof (story as Record<string, any>).source?.provider === 'string'
  );
}

/**
 * Wikipedia article-title candidates for a scientific name, best first.
 * DBpedia resources are keyed by article title with spaces as underscores;
 * we try the full name, then the bare genus + species binomial (so a
 * trinomial or a name carrying authorship still resolves to the species
 * page). Non-ASCII / hybrid names that need percent-encoding are left for
 * enrich-stories.ts to resolve.
 */
function titleCandidates(latin: string): string[] {
  const clean = latin.trim().replace(/\s+/g, ' ');
  const tokens = clean.split(' ');
  const cands = new Set<string>();
  cands.add(clean.replace(/ /g, '_'));
  if (tokens.length > 2) cands.add(tokens.slice(0, 2).join('_'));
  return [...cands];
}

/** Decode N-Triples string escapes and collapse all whitespace to one line. */
function cleanAbstract(raw: string): string {
  const unescaped = raw.replace(
    /\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g,
    (_, esc: string) => {
      if (esc[0] === 'u' || esc[0] === 'U') {
        return String.fromCodePoint(parseInt(esc.slice(1), 16));
      }
      switch (esc) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        default:
          return esc; // covers \" \\ \' and any other escaped char
      }
    },
  );
  return unescaped.replace(/\s+/g, ' ').trim();
}

/**
 * True for Wikipedia disambiguation-page abstracts ("X may refer to: …"),
 * which are not real descriptions. enrich-stories.ts filters these via the
 * REST API's `type` field; a bulk dump carries no such flag, so match on
 * the unmistakable wording (English + Swedish).
 */
function looksLikeDisambiguation(text: string): boolean {
  return /\bdisambiguation\b|\bmay refer to\b|\bkan syfta på\b|\bförgreningssida\b/i.test(text);
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

/** Ensure the language dump is cached locally; download it (resumably) if not. */
async function ensureDump(lang: DumpLang, args: CliArgs): Promise<string> {
  const file = path.join(args.cacheDir, `short-abstracts_lang=${lang}.ttl.bz2`);
  if (!args.refresh) {
    try {
      const s = await stat(file);
      if (s.size > 1_000_000) {
        console.log(`  ${lang}: using cached dump (${(s.size / 1e6).toFixed(0)} MB)`);
        return file;
      }
    } catch {
      // not cached — fall through to download
    }
  }
  const url = `${DBPEDIA_BASE}/short-abstracts_lang=${lang}.ttl.bz2`;
  const part = `${file}.part`;
  console.log(`  ${lang}: downloading ${url}`);
  // -C - resumes a partial .part file; the dump is immutable so this is safe.
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
    url,
  ]);
  await rename(part, file); // a file at the final path is therefore always complete
  const s = await stat(file);
  console.log(`  ${lang}: downloaded (${(s.size / 1e6).toFixed(0)} MB)`);
  return file;
}

interface AbstractHit {
  text: string;
  title: string; // the real (original-case) Wikipedia article title
  rank: number; // candidate rank — lower is a better / more specific match
}

/**
 * Stream a bzip2-compressed DBpedia dump and collect the abstracts of the
 * wanted plants. Only matching lines are retained, so memory stays O(plants)
 * however large the dump is. Each line is N-Triples:
 *   <resource> <rdfs:comment> "abstract"@lang .
 */
async function parseDump(
  file: string,
  lang: DumpLang,
  wanted: Map<string, { id: string; rank: number }[]>,
  into: Map<string, AbstractHit>,
): Promise<void> {
  const tail = `@${lang} .`; // every line in a lang dump ends with this
  const bz = spawn('bzip2', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  let spawnErr: Error | null = null;
  bz.on('error', (e) => {
    spawnErr = e;
  });

  const rl = createInterface({ input: bz.stdout!, crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    if (++lines % 2_000_000 === 0) {
      console.log(`    ${lang}: ${(lines / 1e6).toFixed(0)}M lines scanned, ${into.size} matched`);
    }
    if (line.charCodeAt(0) !== 0x3c /* '<' */) continue;
    // Subject local-name: the segment after the last '/' before "> <".
    const subjEnd = line.indexOf('> <');
    if (subjEnd < 0) continue;
    const slash = line.lastIndexOf('/', subjEnd);
    if (slash < 0) continue;
    const localName = line.slice(slash + 1, subjEnd);
    const targets = wanted.get(localName.toLowerCase());
    if (!targets) continue;
    // Object literal: "..."@lang . — extract the text between the quotes.
    if (!line.endsWith(tail)) continue;
    const open = line.indexOf('"', subjEnd);
    const close = line.length - tail.length - 1; // index of the closing quote
    if (open < 0 || close <= open) continue;
    const text = cleanAbstract(line.slice(open + 1, close));
    if (text.length < MIN_ABSTRACT || looksLikeDisambiguation(text)) continue;
    for (const t of targets) {
      const cur = into.get(t.id);
      if (!cur || t.rank < cur.rank) {
        into.set(t.id, { text, title: localName, rank: t.rank });
      }
    }
  }
  if (spawnErr) throw spawnErr;
  if (lines === 0) {
    throw new Error(`bzip2 produced no output for ${file} — is bzip2 installed and the dump intact?`);
  }
}

/** Compose the { en, fi, sv, source } story from the matched abstracts. */
function buildStory(en: AbstractHit | undefined, sv: AbstractHit | undefined) {
  // Primary text prefers English; Swedish is used only when English is absent.
  const enText = en?.text ?? sv!.text;
  const svText = sv?.text ?? en!.text;
  const urls: Record<string, string> = {};
  if (en) urls.en = `https://en.wikipedia.org/wiki/${en.title}`;
  if (sv) urls.sv = `https://sv.wikipedia.org/wiki/${sv.title}`;
  return {
    en: enText,
    fi: enText, // DBpedia 2022.12.01 has no Finnish dump — gap-fill with English
    sv: svText,
    source: {
      provider: 'DBpedia',
      license: 'CC-BY-SA-3.0',
      version: DUMP_VERSION,
      urls,
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function main() {
  const args = parseArgs();
  console.log(
    `DBpedia story bulk-load — ${args.dryRun ? 'DRY RUN (no writes)' : 'writing'}` +
      `${args.force ? ', --force (overwrite all)' : ''}` +
      `${args.slug ? `, slug=${args.slug}` : ''}` +
      `${args.limit !== Infinity ? `, limit=${args.limit}` : ''}`,
  );

  // ── Plants that still need a story ──────────────────────────────────────
  const plants = await prisma.plant.findMany({
    where: args.slug ? { slug: args.slug } : undefined,
    select: { id: true, slug: true, story: true, taxon: { select: { latinName: true } } },
    orderBy: { slug: 'asc' },
  });
  const needy = args.force
    ? plants
    : plants.filter((p) => !alreadyEnriched(p.story) && needsStory(p.story));
  console.log(
    `${plants.length} plants · ${plants.length - needy.length} already done/curated · ` +
      `${needy.length} need a story.`,
  );
  if (needy.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // ── Wanted-title index: lower-cased candidate title -> plants wanting it ─
  const wanted = new Map<string, { id: string; rank: number }[]>();
  for (const plant of needy) {
    titleCandidates(plant.taxon.latinName).forEach((cand, rank) => {
      const key = cand.toLowerCase();
      const arr = wanted.get(key);
      if (arr) arr.push({ id: plant.id, rank });
      else wanted.set(key, [{ id: plant.id, rank }]);
    });
  }

  // ── Download + parse the DBpedia dumps ──────────────────────────────────
  await mkdir(args.cacheDir, { recursive: true });
  console.log(`\nDumps cached in ${args.cacheDir} (~720 MB — delete to reclaim space).`);
  const hits: Record<DumpLang, Map<string, AbstractHit>> = { en: new Map(), sv: new Map() };
  for (const lang of DUMP_LANGS) {
    const file = await ensureDump(lang, args);
    console.log(`  ${lang}: parsing …`);
    await parseDump(file, lang, wanted, hits[lang]);
    console.log(`  ${lang}: matched ${hits[lang].size}/${needy.length} plants.`);
  }

  // ── Match statistics (over every needy plant, ignoring --limit) ─────────
  let mEn = 0;
  let mSv = 0;
  let mBoth = 0;
  for (const p of needy) {
    const e = hits.en.has(p.id);
    const s = hits.sv.has(p.id);
    if (e) mEn++;
    if (s) mSv++;
    if (e && s) mBoth++;
  }
  const matchedTotal = mEn + mSv - mBoth;
  console.log(
    `\nMatched ${matchedTotal}/${needy.length} plants in the dumps ` +
      `(en=${mEn} sv=${mSv} both=${mBoth}).`,
  );
  if (matchedTotal === 0) {
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
    const en = hits.en.get(plant.id);
    const sv = hits.sv.get(plant.id);
    if (!en && !sv) {
      noMatch++;
      continue;
    }
    const story = buildStory(en, sv);
    if (args.dryRun) {
      const langs = [en && 'en', sv && 'sv'].filter(Boolean).join('+');
      console.log(
        `[${i + 1}/${target}] DRY ${latin} (${langs})\n        "${story.en.slice(0, 140)}…"`,
      );
      continue;
    }
    try {
      await prisma.plant.update({ where: { id: plant.id }, data: { story: story as any } });
      updated++;
      console.log(`[${i + 1}/${target}] + ${latin}`);
    } catch (err) {
      console.error(`[${i + 1}/${target}] ! ${latin} — ${(err as Error)?.message ?? String(err)}`);
    }
  }

  console.log(
    `\nDone. plants=${plants.length} needed=${needy.length} ` +
      `matched=${matchedTotal} ${args.dryRun ? '' : `updated=${updated} `}` +
      `no-match-in-dumps=${noMatch}`,
  );
  if (noMatch > 0 && !args.dryRun) {
    console.log('Unmatched plants can be filled by: pnpm tsx scripts/enrich-stories.ts');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
