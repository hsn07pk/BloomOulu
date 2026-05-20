#!/usr/bin/env tsx
/**
 * Auto-generate plant stories from Wikipedia.
 *
 *   pnpm tsx scripts/enrich-stories.ts [--limit N] [--slug <slug>] [--dry-run] [--force]
 *
 * For every plant that still lacks a real story (empty, or a "Curator to
 * write…" / "Imported from the legacy database…" placeholder), this looks
 * the species up on Wikidata, finds its English / Finnish / Swedish
 * Wikipedia articles, and stores each article's summary into Plant.story.
 *
 * The Plant.story JSON keeps a `source` block recording the Wikipedia
 * provenance + licence (CC-BY-SA-4.0). The plant page can use it to show a
 * credit, and re-runs use it to skip already-enriched rows.
 *
 * Behaviour:
 *   * Default  — only fills plants WITHOUT a real story. Curator-written and
 *                already-enriched stories are left untouched.
 *   * --force  — overwrite every matched plant's story.
 *   * --slug   — process a single plant by slug (for testing).
 *   * --limit  — stop after N plants.
 *   * --dry-run— fetch + print, write nothing.
 *
 * Idempotent and resumable: just re-run it.
 *
 * Sources: Wikidata (CC0) for the taxon → article mapping; the Wikipedia
 * REST summary API (article text is CC-BY-SA-4.0) for the description.
 */

import { PrismaClient } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';

const prisma = new PrismaClient();

const UA =
  'BloomOulu-StoryEnrich/1.0 (University of Oulu Botanical Garden adoption platform)';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const LANGS = ['en', 'fi', 'sv'] as const;
type Lang = (typeof LANGS)[number];

// Lower-cased substrings that mark a story as a placeholder, not real content.
const PLACEHOLDER_MARKERS = [
  'curator to write',
  'imported from the garden',
  'pending',
];

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
    (story as Record<string, any>).source?.provider === 'Wikipedia'
  );
}

/** GET JSON with retry on 429 / 5xx / network errors. Returns null on 404 or give-up. */
async function fetchJson(url: string, retries = 2): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

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
  console.log(`${plants.length} plant(s) loaded.\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let noData = 0;
  let errors = 0;

  for (const plant of plants) {
    if (processed >= args.limit) break;

    // Decide whether to touch this plant.
    if (!args.force) {
      if (alreadyEnriched(plant.story)) {
        skipped++;
        continue;
      }
      if (!needsStory(plant.story)) {
        // A real, curator-written story — protect it.
        skipped++;
        continue;
      }
    }

    processed++;
    const latin = plant.taxon.latinName;
    try {
      const articles = await wikidataArticles(latin);
      await sleep(250); // gentle on Wikidata

      const story: Record<string, any> = { en: '', fi: '', sv: '' };
      const urls: Partial<Record<Lang, string>> = {};
      let got = 0;
      for (const lang of LANGS) {
        // Prefer the Wikidata-resolved article title; fall back to the latin
        // name — Wikipedia's REST API follows redirects, so synonyms and
        // names Wikidata missed still resolve.
        const title = articles[lang] ?? latin;
        const summary = await wikipediaSummary(lang, title);
        await sleep(120); // gentle on Wikipedia
        if (summary) {
          story[lang] = summary.text;
          urls[lang] = summary.url;
          got++;
        }
      }

      if (got === 0) {
        noData++;
        console.log(`· ${latin}  — no Wikipedia article found`);
        continue;
      }

      // Fill any language we couldn't find with whatever text we did get,
      // so no language ever renders an empty story.
      const primary = story.en || story.fi || story.sv;
      for (const lang of LANGS) {
        if (!story[lang]) story[lang] = primary;
      }

      story.source = {
        provider: 'Wikipedia',
        license: 'CC-BY-SA-4.0',
        urls,
        fetchedAt: new Date().toISOString(),
      };

      if (args.dryRun) {
        console.log(
          `DRY ${latin}  en=${urls.en ? 'Y' : '-'} fi=${urls.fi ? 'Y' : '-'} sv=${urls.sv ? 'Y' : '-'}`,
        );
        console.log(`     "${primary.slice(0, 160)}${primary.length > 160 ? '…' : ''}"`);
      } else {
        await prisma.plant.update({
          where: { id: plant.id },
          data: { story: story as any },
        });
        updated++;
        console.log(
          `+ ${latin}  en=${urls.en ? 'Y' : '-'} fi=${urls.fi ? 'Y' : '-'} sv=${urls.sv ? 'Y' : '-'}`,
        );
      }
    } catch (err) {
      errors++;
      console.error(`! ${latin}  — ${(err as Error).message}`);
    }
  }

  console.log(
    `\nDone. processed=${processed} updated=${updated} skipped=${skipped} ` +
      `no-data=${noData} errors=${errors}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
