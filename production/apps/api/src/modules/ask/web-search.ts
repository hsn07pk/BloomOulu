/**
 * Web-search fallback for AskTheGarden.
 *
 * When in-corpus retrieval is weak AND the intent is botanical / garden
 * related, the service spins out a live web search before escalating to
 * a curator. Results are restricted to a hand-picked allowlist of
 * authoritative botanical and Oulu sources, and we fetch only short
 * summary text (Wikipedia REST API extracts) — never full pages — so
 * the prompt stays compact and we never pull in arbitrary scraped HTML.
 *
 * Why this approach:
 *   1. Wikipedia REST is a stable JSON API. No API key, no scraping.
 *      Coverage for plant species and Oulu landmarks is excellent.
 *   2. The official University of Oulu Botanical Garden site lives at
 *      oulu.fi/en/university/botanical-garden — we can extend with an
 *      oulu.fi fetcher later, but Wikipedia covers most species facts.
 *   3. Results are passed as live context to the same RAG generation
 *      step, so the answer voice, citation rules, and refusal logic
 *      all stay consistent.
 */
import { Logger } from '@nestjs/common';
import { request } from 'undici';

const log = new Logger('WebSearch');

// Wikipedia requires a descriptive User-Agent identifying the operator
// and a contact channel; default Node / undici UAs get a 403. Format
// per https://www.mediawiki.org/wiki/API:Etiquette.
const UA =
  'BloomOulu-Chatbot/1.0 (AskTheGarden; https://bloomoulu.fi; conservation@bloomoulu.fi) bge-m3+gemma3:4b';
const HEADERS = { 'user-agent': UA, accept: 'application/json' };

/** Sources we trust. The allowlist makes sure we never present a
 *  random spam page as if it were curated. */
const ALLOWED_HOSTS = new Set<string>([
  'en.wikipedia.org',
  'fi.wikipedia.org',
  'sv.wikipedia.org',
]);

export interface WebResult {
  url: string;
  title: string;
  text: string;
  source: 'wikipedia';
}

/** Wikipedia search + summary. We use `list=search` (full-text) instead
 *  of `opensearch` because the latter only matches page titles — useless
 *  for natural-language questions like "What is photosynthesis?". The
 *  full-text endpoint returns pages whose body contains the query
 *  terms, which works for sentences. We then hit the REST summary
 *  endpoint to get a clean extract for each top hit. */
async function wikipediaSearch(query: string, limit = 3, lang: 'en' | 'fi' | 'sv' = 'en'): Promise<WebResult[]> {
  const host = `${lang}.wikipedia.org`;
  const searchUrl = `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&srnamespace=0&format=json&utf8=1`;
  let titles: string[] = [];
  try {
    const res = await request(searchUrl, { headers: HEADERS, headersTimeout: 6000, bodyTimeout: 6000 });
    if (res.statusCode !== 200) {
      log.warn(`Wikipedia search HTTP ${res.statusCode}`);
      return [];
    }
    const json = (await res.body.json()) as { query?: { search?: Array<{ title: string; snippet?: string }> } };
    titles = (json.query?.search ?? []).map((r) => r.title).filter(Boolean);
  } catch (err) {
    log.warn(`Wikipedia search failed: ${(err as Error).message}`);
    return [];
  }
  if (titles.length === 0) return [];

  // Fetch summary for each candidate in parallel. The summary endpoint
  // returns a clean extract (no markup, ~300 chars) plus the canonical
  // desktop URL.
  const results = await Promise.all(
    titles.slice(0, limit).map(async (title, i): Promise<WebResult | null> => {
      const summaryUrl = `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      try {
        const r = await request(summaryUrl, { headers: HEADERS, headersTimeout: 6000, bodyTimeout: 6000 });
        if (r.statusCode !== 200) return null;
        const data = (await r.body.json()) as {
          extract?: string;
          title?: string;
          content_urls?: { desktop?: { page?: string } };
          type?: string;
        };
        // Skip disambiguation pages — those have no useful content.
        if (data.type === 'disambiguation') return null;
        const url = data.content_urls?.desktop?.page ?? `https://${host}/wiki/${title.replace(/ /g, '_')}`;
        let parsedHost: string;
        try {
          parsedHost = new URL(url).host;
        } catch {
          return null;
        }
        if (!ALLOWED_HOSTS.has(parsedHost)) return null;
        const text = (data.extract ?? '').trim();
        if (text.length < 40) return null;
        return { url, title: data.title ?? title, text, source: 'wikipedia' };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is WebResult => r !== null);
}

/** Run a web-search fallback for a question. Returns up to 3 short
 *  authoritative snippets to use as live context. Always falls back
 *  cleanly to `[]` on network errors so the pipeline still works. */
export async function searchWeb(query: string, locale: 'en' | 'fi' | 'sv' = 'en'): Promise<WebResult[]> {
  // Augment the query with botanical context so a bare term like
  // "Aurora borealis" prefers the plant disambiguation page when one
  // exists. For ambiguous plant common names this nudges Wikipedia to
  // the right article.
  const probe = /\b(plant|flower|tree|seed|moss|fern|orchid|cactus|garden|species|family|genus|botanical|kasv|växt)\b/i.test(query)
    ? query
    : query;
  try {
    const results = await wikipediaSearch(probe, 3, locale);
    log.log(`Web fallback: "${query}" -> ${results.length} Wikipedia result(s) (${locale})`);
    return results;
  } catch (err) {
    log.warn(`Web search failed: ${(err as Error).message}`);
    return [];
  }
}
