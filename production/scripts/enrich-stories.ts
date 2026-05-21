#!/usr/bin/env tsx
/**
 * Auto-generate plant stories from open data.
 *
 *   pnpm tsx scripts/enrich-stories.ts [--limit N] [--slug <slug>] [--dry-run] [--force]
 *
 * For every plant that still lacks a real story (empty, or a "Curator to
 * write…" / "Imported from the legacy database…" placeholder), this finds a
 * description and stores it into Plant.story (EN/FI/SV).
 *
 * Description sources, tried in order until one yields text:
 *   1. Wikipedia — via Wikidata (taxon → article), falling back to a direct
 *      title lookup so synonyms still resolve. Per language (EN/FI/SV).
 *   2. GBIF species descriptions — used when Wikipedia has nothing.
 *   3. Encyclopedia of Life (EOL) — used when GBIF also has nothing.
 * Only openly-licensed text is kept (CC0 / CC-BY / CC-BY-SA); non-commercial
 * or no-derivatives content is skipped (this is a donation-funded site).
 *
 * The Plant.story JSON keeps a `source` block recording the provider + the
 * licence. The plant page can use it to show a credit; re-runs use it to
 * skip already-enriched rows.
 *
 * Robustness: every network call has a 20s timeout and is retried; a failure
 * on one plant is logged and the run moves on to the next — the process does
 * not crash. Idempotent and resumable: just re-run it.
 *
 * Behaviour:
 *   * Default  — only fills plants WITHOUT a real story. Curator-written and
 *                already-enriched stories are left untouched.
 *   * --force  — overwrite every matched plant's story.
 *   * --slug   — process a single plant by slug (for testing).
 *   * --limit  — stop after N plants.
 *   * --dry-run— fetch + print, write nothing.
 */

import { PrismaClient } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';

const prisma = new PrismaClient();

const UA =
  'BloomOulu-StoryEnrich/1.0 (University of Oulu Botanical Garden adoption platform)';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const GBIF = 'https://api.gbif.org/v1';
const EOL = 'https://eol.org/api';
const REQUEST_TIMEOUT_MS = 20_000;

const LANGS = ['en', 'fi', 'sv'] as const;
type Lang = (typeof LANGS)[number];

// Lower-cased substrings that mark a story as a placeholder, not real content.
const PLACEHOLDER_MARKERS = ['curator to write', 'imported from the garden', 'pending'];

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

/** True if the plant has no usable story (empty or a known placeholder). */
function needsStory(story: unknown): boolean {
  if (!story || typeof story !== 'object') return true;
  const en = (story as Record<string, unknown>).en;
  const text = typeof en === 'string' ? en.trim() : '';
  if (!text) return true;
  const low = text.toLowerCase();
  return PLACEHOLDER_MARKERS.some((m) => low.includes(m));
}

/** True if a previous run of this script already enriched the plant. */
function alreadyEnriched(story: unknown): boolean {
  return (
    !!story &&
    typeof story === 'object' &&
    typeof (story as Record<string, any>).source?.provider === 'string'
  );
}

/** Strip HTML tags and decode the few entities that turn up in source text. */
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
  // Reject non-commercial and no-derivatives.
  if (l.includes('-nc') || l.includes('-nd') || l.includes('noncommercial') || l.includes('noderiv'))
    return false;
  // Accept public domain and plain Attribution / ShareAlike.
  return (
    l.includes('cc0') ||
    l.includes('zero') ||
    l.includes('publicdomain') ||
    l.includes('public domain') ||
    l.includes('cc-by') ||
    l.includes('/by/') ||
    l.includes('/by-sa/') ||
    l.includes('by-sa') ||
    l.includes('attribution')
  );
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
        // Rate-limited or server error — back off (longer each time) and retry.
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

// ── Source 1: Wikipedia (via Wikidata) ──────────────────────────────────────

/** Look up the EN/FI/SV Wikipedia article titles for a species via Wikidata. */
async function wikidataArticles(latin: string): Promise<Partial<Record<Lang, string>>> {
  const safe = latin.replace(/\\/g, '').replace(/"/g, '\\"');
  const sparql = `
    SELECT ?en ?fi ?sv WHERE {
      ?item wdt:P225 "${safe}" .
      OPTIONAL { ?en schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
      OPTIONAL { ?fi schema:about ?item ; schema:isPartOf <https://fi.wikipedia.org/> . }
      OPTIONAL { ?sv schema:about ?item ; schema:isPartOf <https://sv.wikipedia.org/> . }
    } LIMIT 1`;
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`;
  const j = await fetchJson(url);
  const binding = j?.results?.bindings?.[0];
  if (!binding) return {};
  const out: Partial<Record<Lang, string>> = {};
  for (const lang of LANGS) {
    const articleUrl = binding[lang]?.value as string | undefined;
    if (!articleUrl) continue;
    const title = decodeURIComponent(articleUrl.split('/wiki/')[1] ?? '');
    if (title) out[lang] = title;
  }
  return out;
}

/** Fetch a Wikipedia article's summary text. Null if missing or a disambiguation page. */
async function wikipediaSummary(
  lang: Lang,
  title: string,
): Promise<{ text: string; url: string } | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const j = await fetchJson(url);
  if (!j || j.type === 'disambiguation') return null;
  const text = typeof j.extract === 'string' ? j.extract.trim() : '';
  if (!text) return null;
  const pageUrl =
    j.content_urls?.desktop?.page ??
    `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  return { text, url: pageUrl };
}

// ── Source 2: GBIF species descriptions ─────────────────────────────────────

const GBIF_DESC_TYPES = ['description', 'general', 'summary', 'morphology', 'biology', 'diagnostic'];

/** Fallback description from GBIF's species descriptions. */
async function gbifDescription(
  latin: string,
): Promise<{ text: string; license: string; url: string } | null> {
  const match = await fetchJson(`${GBIF}/species/match?name=${encodeURIComponent(latin)}`);
  const key = match?.usageKey;
  if (!key) return null;
  const data = await fetchJson(`${GBIF}/species/${key}/descriptions?limit=60`);
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  const usable = results
    .map((d) => ({
      text: stripHtml(String(d?.description ?? '')),
      license: String(d?.license ?? ''),
      type: String(d?.type ?? '').toLowerCase(),
      language: String(d?.language ?? 'en').toLowerCase(),
      source: d?.source ? String(d.source) : '',
    }))
    .filter((d) => d.text.length >= 60 && licenseOk(d.license));
  if (usable.length === 0) return null;
  // Prefer English + a general-description type, then the longest text.
  usable.sort((a, b) => {
    const score = (d: (typeof usable)[number]) =>
      (d.language.startsWith('en') ? 2 : 0) + (GBIF_DESC_TYPES.includes(d.type) ? 1 : 0);
    return score(b) - score(a) || b.text.length - a.text.length;
  });
  const pick = usable[0]!;
  return {
    text: pick.text,
    license: pick.license,
    url: pick.source || `https://www.gbif.org/species/${key}`,
  };
}

// ── Source 3: Encyclopedia of Life ──────────────────────────────────────────

/** Fallback description from EOL. Best-effort — tolerates EOL API shape changes. */
async function eolDescription(
  latin: string,
): Promise<{ text: string; license: string; url: string } | null> {
  const search = await fetchJson(
    `${EOL}/search/1.0.json?q=${encodeURIComponent(latin)}&exact=true`,
  );
  const pageId = search?.results?.[0]?.id;
  if (!pageId) return null;
  const page = await fetchJson(
    `${EOL}/pages/1.0/${pageId}.json?details=true&texts=15&images=0&videos=0&maps=0&iucn=false&vetted=0`,
  );
  const objects: any[] = Array.isArray(page?.taxonConcept?.dataObjects)
    ? page.taxonConcept.dataObjects
    : Array.isArray(page?.dataObjects)
      ? page.dataObjects
      : [];
  const usable = objects
    .map((o) => ({
      text: stripHtml(String(o?.description ?? '')),
      license: String(o?.license ?? ''),
      language: String(o?.language ?? 'en').toLowerCase(),
    }))
    .filter((o) => o.text.length >= 60 && licenseOk(o.license));
  if (usable.length === 0) return null;
  usable.sort((a, b) => {
    const en = (d: (typeof usable)[number]) => (d.language.startsWith('en') ? 1 : 0);
    return en(b) - en(a) || b.text.length - a.text.length;
  });
  const pick = usable[0]!;
  return { text: pick.text, license: pick.license, url: `https://eol.org/pages/${pageId}` };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.log(
    `Story enrichment — ${args.dryRun ? 'DRY RUN (no writes)' : 'writing'}` +
      `${args.force ? ', --force (overwrite all)' : ''}` +
      `${args.slug ? `, slug=${args.slug}` : ''}` +
      `${args.limit !== Infinity ? `, limit=${args.limit}` : ''}`,
  );

  const plants = await prisma.plant.findMany({
    where: args.slug ? { slug: args.slug } : undefined,
    select: {
      id: true,
      slug: true,
      story: true,
      taxon: { select: { latinName: true } },
    },
    orderBy: { slug: 'asc' },
  });

  const work = args.force
    ? plants
    : plants.filter((p) => !alreadyEnriched(p.story) && needsStory(p.story));
  const target = Math.min(work.length, args.limit);
  console.log(
    `${plants.length} loaded · ${plants.length - work.length} already done/curated · ` +
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
      // Source 1 — Wikipedia, per language.
      const articles = await wikidataArticles(latin);
      await sleep(250); // gentle on Wikidata
      const story: Record<string, any> = { en: '', fi: '', sv: '' };
      const urls: Partial<Record<Lang, string>> = {};
      let got = 0;
      for (const lang of LANGS) {
        // Prefer the Wikidata-resolved title; fall back to the latin name —
        // Wikipedia's REST API follows redirects, so synonyms still resolve.
        const title = articles[lang] ?? latin;
        const summary = await wikipediaSummary(lang, title);
        await sleep(120); // gentle on Wikipedia
        if (summary) {
          story[lang] = summary.text;
          urls[lang] = summary.url;
          got++;
        }
      }

      let source: Record<string, any> | null = null;
      if (got > 0) {
        // Fill any language we missed with whatever text we did get.
        const primary = story.en || story.fi || story.sv;
        for (const lang of LANGS) if (!story[lang]) story[lang] = primary;
        source = { provider: 'Wikipedia', license: 'CC-BY-SA-4.0', urls };
      } else {
        // Nothing on Wikipedia — try the fallback sources.
        let fb = await gbifDescription(latin);
        await sleep(150);
        let provider = 'GBIF';
        if (!fb) {
          fb = await eolDescription(latin);
          await sleep(150);
          provider = 'EOL';
        }
        if (fb) {
          story.en = fb.text;
          story.fi = fb.text;
          story.sv = fb.text;
          source = { provider, license: fb.license, url: fb.url };
        }
      }

      if (!source) {
        noData++;
        console.log(`[${n}/${target}] · ${latin} — no description (Wikipedia / GBIF / EOL)`);
        continue;
      }

      source.fetchedAt = new Date().toISOString();
      story.source = source;
      byProvider[source.provider] = (byProvider[source.provider] ?? 0) + 1;

      if (args.dryRun) {
        console.log(
          `[${n}/${target}] DRY ${latin} — via ${source.provider}\n` +
            `        "${String(story.en).slice(0, 150)}…"`,
        );
      } else {
        await prisma.plant.update({
          where: { id: plant.id },
          data: { story: story as any },
        });
        updated++;
        console.log(`[${n}/${target}] + ${latin} — via ${source.provider}`);
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
    `\nDone. processed=${target} updated=${updated} no-data=${noData} errors=${errors}` +
      (provLine ? `  (${provLine})` : ''),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
