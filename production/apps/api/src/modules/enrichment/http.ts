/**
 * HTTP helper for the enrichment sources — a JSON GET with a timeout,
 * bounded retry, and Retry-After honouring. Every upstream (Wikipedia,
 * Wikidata, GBIF, EOL, laji.fi) is flaky and/or rate-limited enough to
 * need this; a single plant's enrichment makes only ~6-15 calls, so the
 * gentle defaults here are plenty.
 */
import { setTimeout as sleep } from 'node:timers/promises';

// Wikimedia's User-Agent / robot policy (https://w.wiki/4wJS) throttles or
// blocks bulk access from a UA with no way to contact the operator. Include
// a project URL + email so upload.wikimedia.org grants standard rate limits
// instead of the strict anonymous-bot budget that 429s a backfill run.
export const ENRICH_UA =
  'BloomOulu-Enrich/1.0 (+https://github.com/hsn07pk/BloomOulu; mailto:hassan.sohail3750@gmail.com) University of Oulu Botanical Garden adoption platform';

const DEFAULT_TIMEOUT_MS = 20_000;

/** Honour a 429/503 Retry-After header (delay-seconds or HTTP-date), capped at 2 min. */
export function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 120_000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 120_000);
  return null;
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

/**
 * GET JSON with a timeout + retry. Returns null on 404 / give-up; never
 * throws — a failed source must never crash an enrichment run.
 */
export async function fetchJson(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<any | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 3, headers = {} } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': ENRICH_UA, accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(retryAfterMs(res) ?? 1000 * (attempt + 1));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

/** Strip HTML tags + decode the few entities that appear in source text. */
export function stripHtml(input: string): string {
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
