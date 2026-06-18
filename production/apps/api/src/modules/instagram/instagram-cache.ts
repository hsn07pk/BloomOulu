import { uploadToS3 } from '../../infra/storage.js';

const MIN_BYTES = 512;
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Download an Instagram CDN thumbnail and rehost it locally. IG CDN URLs
 * expire + are hotlink-protected, so we must cache. Returns the same-origin
 * serving path, or null on any failure (caller keeps the previous row).
 */
export async function cacheThumbnail(displayUrl: string, shortcode: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
  let parsed: URL;
  try {
    parsed = new URL(displayUrl);
  } catch {
    return null;
  }
  // Defense-in-depth: only fetch https Instagram/Facebook CDN hosts, never
  // arbitrary/internal addresses (the URL comes from an unofficial JSON feed).
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !/(^|\.)cdninstagram\.com$|(^|\.)fbcdn\.net$/.test(host)) {
    return null;
  }
  try {
    const res = await fetch(displayUrl, {
      headers: { 'user-agent': `BloomOulu/1.0 (+${process.env.WEBAPP_USER_AGENT_EMAIL ?? 'conservation@bloomoulu.fi'})` },
      signal: AbortSignal.timeout(30_000),
      redirect: 'manual',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;
    const key = `instagram/${shortcode}.jpg`;
    await uploadToS3({ key, body: buf, contentType: res.headers.get('content-type') || 'image/jpeg' });
    return `/v1/files/${key}`;
  } catch {
    return null;
  }
}
