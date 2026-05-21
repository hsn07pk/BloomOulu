/**
 * Story enrichment. Tries Wikipedia (resolved via Wikidata, EN/FI/SV),
 * then GBIF species descriptions, then Encyclopedia of Life — keeping only
 * openly-licensed text. Ported from scripts/enrich-stories.ts.
 */
import { fetchJson, stripHtml } from '../http.js';
import { licenseOk } from '../licenses.js';
import type { StoryPayload } from '../types.js';

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const GBIF = 'https://api.gbif.org/v1';
const EOL = 'https://eol.org/api';

const LANGS = ['en', 'fi', 'sv'] as const;
type Lang = (typeof LANGS)[number];

/** Resolve EN/FI/SV Wikipedia article titles for a species via Wikidata. */
async function wikidataArticles(latin: string): Promise<Partial<Record<Lang, string>>> {
  const safe = latin.replace(/\\/g, '').replace(/"/g, '\\"');
  const sparql = `
    SELECT ?en ?fi ?sv WHERE {
      ?item wdt:P225 "${safe}" .
      OPTIONAL { ?en schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
      OPTIONAL { ?fi schema:about ?item ; schema:isPartOf <https://fi.wikipedia.org/> . }
      OPTIONAL { ?sv schema:about ?item ; schema:isPartOf <https://sv.wikipedia.org/> . }
    } LIMIT 1`;
  const json = await fetchJson(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`);
  const binding = json?.results?.bindings?.[0];
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

/** Fetch a Wikipedia article summary. Null if missing or a disambiguation page. */
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

/** Fallback description from Encyclopedia of Life. */
async function eolDescription(
  latin: string,
): Promise<{ text: string; license: string; url: string } | null> {
  const search = await fetchJson(`${EOL}/search/1.0.json?q=${encodeURIComponent(latin)}&exact=true`);
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

/** Fetch a story (EN/FI/SV) for a species. Null if no openly-licensed text. */
export async function fetchStory(latin: string): Promise<StoryPayload | null> {
  // Source 1 — Wikipedia, per language.
  const articles = await wikidataArticles(latin);
  const story: Record<Lang, string> = { en: '', fi: '', sv: '' };
  const urls: Partial<Record<Lang, string>> = {};
  let got = 0;
  for (const lang of LANGS) {
    // Prefer the Wikidata-resolved title; fall back to the latin name
    // (Wikipedia's REST API follows redirects, so synonyms still resolve).
    const title = articles[lang] ?? latin;
    const summary = await wikipediaSummary(lang, title);
    if (summary) {
      story[lang] = summary.text;
      urls[lang] = summary.url;
      got++;
    }
  }

  if (got > 0) {
    // Fill any missed language with whatever text we did get.
    const primary = story.en || story.fi || story.sv;
    for (const lang of LANGS) if (!story[lang]) story[lang] = primary;
    return {
      en: story.en,
      fi: story.fi,
      sv: story.sv,
      source: {
        provider: 'Wikipedia',
        license: 'CC-BY-SA-4.0',
        urls,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  // Source 2/3 — GBIF, then EOL.
  let fb = await gbifDescription(latin);
  let provider = 'GBIF';
  if (!fb) {
    fb = await eolDescription(latin);
    provider = 'EOL';
  }
  if (!fb) return null;
  return {
    en: fb.text,
    fi: fb.text,
    sv: fb.text,
    source: { provider, license: fb.license, url: fb.url, fetchedAt: new Date().toISOString() },
  };
}
