/**
 * Public Instagram feed — tiered providers, tried in priority order, with the
 * unauthenticated scraper as the guaranteed fallback:
 *
 *   1. Graph API  — official Instagram Graph API (IG_GRAPH_ACCESS_TOKEN
 *                   [+ IG_GRAPH_USER_ID]). ToS-compliant + robust; the
 *                   recommended primary. Inactive until a token is configured.
 *   2. Login      — authenticated session from IG_USERNAME / IG_PASSWORD
 *                   (see instagram.login.ts). Uses the account credentials via
 *                   Instagram's private web endpoints (unofficial).
 *   3. Scraper    — unauthenticated web_profile_info via curl. No creds, public.
 *
 * Instagram TLS-fingerprints + 429s Node's fetch (undici) on the public
 * endpoints, so every call goes through curl (execFile with an argv array —
 * never a shell string — plus a validated handle, leaving no command-injection
 * surface). Best-effort: the processor tolerates throws (keeps last-good rows).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ParsedPost {
  shortcode: string;
  caption: string | null;
  takenAt: string; // ISO 8601
  mediaType: 'image' | 'carousel' | 'video';
  displayUrl: string;
  permalink: string;
}

export const IG_APP_ID = '936619743392459'; // public Instagram web app id
export const IG_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_MAX = 12;
// Instagram handle charset (defensive — the handle comes from SystemSetting).
const HANDLE_RE = /^[A-Za-z0-9._]{1,40}$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mediaTypeFor(node: any): ParsedPost['mediaType'] {
  if (node?.is_video || node?.__typename === 'GraphVideo') return 'video';
  if (node?.__typename === 'GraphSidecar') return 'carousel';
  return 'image';
}

/** Parse the web_profile_info JSON into ParsedPost[]. Pure + defensive. */
export function parseProfileJson(json: unknown, max: number = DEFAULT_MAX): ParsedPost[] {
  const edges = (json as any)?.data?.user?.edge_owner_to_timeline_media?.edges;
  if (!Array.isArray(edges)) return [];
  const out: ParsedPost[] = [];
  for (const edge of edges) {
    const node = edge?.node;
    if (!node?.shortcode || !node?.display_url) continue;
    const ts = Number(node.taken_at_timestamp);
    const captionText: string | undefined = node?.edge_media_to_caption?.edges?.[0]?.node?.text;
    out.push({
      shortcode: String(node.shortcode),
      caption: captionText && captionText.trim().length > 0 ? captionText : null,
      takenAt: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date(0).toISOString(),
      mediaType: mediaTypeFor(node),
      displayUrl: String(node.display_url),
      permalink: `https://www.instagram.com/p/${node.shortcode}/`,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * GET `url` via curl. Returns { status, body }. execFile with an argv array
 * (never a shell string) leaves no command-injection surface. Exported so the
 * login provider can reuse the exact transport.
 */
export async function igCurlGet(
  url: string,
  extraHeaders: string[] = [],
): Promise<{ status: number; body: string }> {
  const MARKER = '\n__IG_HTTP_STATUS__:';
  const headers = [
    '-H', `x-ig-app-id: ${IG_APP_ID}`,
    '-H', `user-agent: ${IG_BROWSER_UA}`,
    '-H', 'accept: */*',
    '-H', 'accept-language: en-US,en;q=0.9',
    ...extraHeaders.flatMap((h) => ['-H', h]),
  ];
  const { stdout } = await execFileAsync(
    'curl',
    ['-sS', '--max-time', '20', ...headers, '-w', `${MARKER}%{http_code}`, url],
    { timeout: 25_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const i = stdout.lastIndexOf(MARKER);
  if (i < 0) return { status: 0, body: stdout };
  return { status: parseInt(stdout.slice(i + MARKER.length), 10) || 0, body: stdout.slice(0, i) };
}

function profileApiUrl(handle: string): string {
  return `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
}

// ── Provider 3: scraper (unauthenticated, public) ─────────────────────────────
async function fetchViaScraper(handle: string, max: number, retries = 3): Promise<ParsedPost[]> {
  const url = profileApiUrl(handle);
  let lastErr: Error = new Error('scraper failed');
  for (let i = 0; i < Math.max(1, retries); i++) {
    if (i > 0) await sleep(1200 * i + 800); // 0.8s, 2.0s, 3.2s …
    let r: { status: number; body: string };
    try {
      r = await igCurlGet(url);
    } catch (e) {
      lastErr = e as Error;
      continue;
    }
    if (r.status === 200) {
      try {
        return parseProfileJson(JSON.parse(r.body), max);
      } catch {
        lastErr = new Error('scraper: invalid JSON');
        continue;
      }
    }
    lastErr = new Error(`scraper web_profile_info ${r.status}`);
    if (r.status !== 429 && r.status < 500) break; // a hard 4xx won't fix on retry
  }
  throw lastErr;
}

// ── Provider 1: official Instagram Graph API (token) ──────────────────────────
function shortcodeFromPermalink(permalink: string, fallback: string): string {
  const m = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(permalink || '');
  return m?.[1] ?? fallback;
}
function graphMediaType(t: string): ParsedPost['mediaType'] {
  return t === 'VIDEO' ? 'video' : t === 'CAROUSEL_ALBUM' ? 'carousel' : 'image';
}
async function fetchViaGraphApi(handle: string, max: number): Promise<ParsedPost[]> {
  const token = process.env.IG_GRAPH_ACCESS_TOKEN!.trim();
  const userId = process.env.IG_GRAPH_USER_ID?.trim() || 'me';
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
  const url =
    `https://graph.instagram.com/${encodeURIComponent(userId)}/media` +
    `?fields=${fields}&limit=${max}&access_token=${encodeURIComponent(token)}`;
  const { status, body } = await igCurlGet(url);
  if (status !== 200) throw new Error(`graph api ${status}`);
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('graph api: invalid JSON');
  }
  if (json?.error) throw new Error(`graph api: ${json.error.message ?? 'error'}`);
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  const out: ParsedPost[] = [];
  for (const m of data) {
    const displayUrl = m.thumbnail_url || m.media_url; // video → poster frame
    if (!m.permalink || !displayUrl) continue;
    out.push({
      shortcode: shortcodeFromPermalink(String(m.permalink), String(m.id ?? '')),
      caption: typeof m.caption === 'string' && m.caption.trim() ? m.caption : null,
      takenAt: m.timestamp ? new Date(m.timestamp).toISOString() : new Date(0).toISOString(),
      mediaType: graphMediaType(String(m.media_type)),
      displayUrl: String(displayUrl),
      permalink: String(m.permalink),
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Fetch + parse a public profile through the provider chain (Graph API →
 * credential login → scraper). Returns the first provider that yields posts;
 * throws only if all configured providers fail. Pass opts.fetchImpl to inject
 * an undici-style fetch (unit tests).
 */
export async function fetchInstagramProfile(
  handle: string,
  opts: { fetchImpl?: typeof fetch; max?: number; retries?: number } = {},
): Promise<ParsedPost[]> {
  const max = opts.max ?? DEFAULT_MAX;
  if (!HANDLE_RE.test(handle)) throw new Error(`invalid instagram handle: ${handle}`);

  // Test / injection escape hatch (unit tests stub this; behaviour unchanged).
  if (opts.fetchImpl) {
    const res = await opts.fetchImpl(profileApiUrl(handle), {
      headers: { 'x-ig-app-id': IG_APP_ID, 'user-agent': IG_BROWSER_UA, accept: '*/*' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`instagram web_profile_info ${res.status}`);
    return parseProfileJson(await res.json(), max);
  }

  const errors: string[] = [];

  // 1. Official Graph API (only when a token is configured).
  if (process.env.IG_GRAPH_ACCESS_TOKEN?.trim()) {
    try {
      const posts = await fetchViaGraphApi(handle, max);
      if (posts.length) return posts;
      errors.push('graph:0-posts');
    } catch (e) {
      errors.push(`graph:${(e as Error).message}`);
    }
  }

  // 2. Credential login (only when username + password are configured). The
  //    login provider is dynamically imported so its session/login machinery
  //    only loads when actually used.
  if (process.env.IG_USERNAME?.trim() && process.env.IG_PASSWORD) {
    try {
      const { fetchViaLogin } = await import('./instagram.login.js');
      const posts = await fetchViaLogin(handle, max);
      if (posts.length) return posts;
      errors.push('login:0-posts');
    } catch (e) {
      errors.push(`login:${(e as Error).message}`);
    }
  }

  // 3. Scraper — the guaranteed public fallback.
  try {
    const posts = await fetchViaScraper(handle, max, opts.retries);
    if (posts.length) return posts;
    errors.push('scraper:0-posts');
  } catch (e) {
    errors.push(`scraper:${(e as Error).message}`);
  }

  throw new Error(`all instagram providers failed [${errors.join(' | ')}]`);
}
