/**
 * Public Instagram profile fetch + parse. Uses the unauthenticated
 * web_profile_info endpoint with the public web app id header. Unofficial and
 * best-effort: callers must tolerate throws (see instagram-sync.processor).
 * No credentials, server-to-server only, reads public data.
 */

export interface ParsedPost {
  shortcode: string;
  caption: string | null;
  takenAt: string; // ISO 8601
  mediaType: 'image' | 'carousel' | 'video';
  displayUrl: string;
  permalink: string;
}

const IG_APP_ID = '936619743392459'; // public Instagram web app id
const DEFAULT_MAX = 12;

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

/** Fetch + parse a public profile. Throws on non-200 / network error. */
export async function fetchInstagramProfile(
  handle: string,
  opts: { fetchImpl?: typeof fetch; max?: number } = {},
): Promise<ParsedPost[]> {
  const f = opts.fetchImpl ?? fetch;
  const ua = `BloomOulu/1.0 (+${process.env.WEBAPP_USER_AGENT_EMAIL ?? 'conservation@bloomoulu.fi'})`;
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  const res = await f(url, {
    headers: { 'x-ig-app-id': IG_APP_ID, 'user-agent': ua, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`instagram web_profile_info ${res.status}`);
  const json = await res.json();
  return parseProfileJson(json, opts.max);
}
