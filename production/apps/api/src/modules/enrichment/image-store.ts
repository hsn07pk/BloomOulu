/**
 * Host an enriched plant photo on local disk so the site serves images
 * itself instead of hot-linking Wikimedia / iNaturalist. Writes through
 * `infra/storage` so the storage layer stays consolidated — same code
 * path used for receipts, audio narrations, GDPR exports, etc.
 *
 * The serving URL is `<api>/v1/files/plant-images/<plantImageId>.<ext>`
 * (resolved by `presign()`); PlantImage rows store the resolved URL so
 * the public site can render the image directly.
 *
 * Wikimedia caveat: original-file URLs are rejected by Wikimedia's
 * thumbnailer, so they're rewritten to the 1280px standard thumb.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { uploadToS3, presign } from '../../infra/storage.js';
import { ENRICH_UA, retryAfterMs } from './http.js';

const KEY_PREFIX = 'plant-images';
const MIN_BYTES = 1024; // smaller is almost certainly an error page
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Wikimedia only serves a fixed set of thumbnail widths and rejects
 * original-file URLs; route an original Commons URL through the 1280px
 * standard thumbnail. Non-Wikimedia and already-thumbnailed URLs pass
 * through unchanged.
 */
function toFetchableUrl(url: string): string {
  const m = url.match(
    /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/([0-9a-fA-F])\/([0-9a-fA-F]{2})\/([^/]+)$/,
  );
  if (!m) return url;
  const [, base, h1, h2, file] = m;
  return `${base}/thumb/${h1}/${h2}/${file}/1280px-${file}`;
}

/** File extension from the content-type, falling back to the URL. */
function extensionFor(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  const m = url.toLowerCase().match(/\.(jpe?g|png|webp|gif)(?:[?#]|$)/);
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]!) : 'jpg';
}

/**
 * Failure causes we surface back to the caller. Helps the operator
 * understand why a photo apply failed instead of a generic null.
 */
export class ImageHostError extends Error {
  constructor(
    public reason:
      | 'not-found'
      | 'rate-limited'
      | 'upstream-5xx'
      | 'non-image-content'
      | 'too-small'
      | 'too-large'
      | 'network-error'
      | 'storage-error',
    public detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'ImageHostError';
  }
}

/**
 * Download `sourceUrl`, persist to local storage at
 * `plant-images/<plantImageId>.<ext>`, return the browser-fetchable URL
 * (`/v1/files/plant-images/...`). Returns null on any unrecoverable
 * failure; the operator-facing reason is logged.
 */
export async function hostPlantImage(
  sourceUrl: string,
  plantImageId: string,
): Promise<string | null> {
  const fetchUrl = toFetchableUrl(sourceUrl);
  let body: Buffer | null = null;
  let contentType = '';
  // 6 attempts × exponential back-off (1.5s, 3s, 6s, 12s, 24s) ≈ 45s
  // total retry budget — Wikimedia rate-limits a bulk-approve burst.
  const MAX_ATTEMPTS = 6;
  let lastErr: ImageHostError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(fetchUrl, {
        headers: { 'user-agent': ENRICH_UA },
        // 60s — Wikimedia originals routed through /thumb can take
        // 30-50s on first request when the cache is cold.
        signal: AbortSignal.timeout(60_000),
        redirect: 'follow',
      });
      if (res.status === 404 || res.status === 410) {
        lastErr = new ImageHostError('not-found', `HTTP ${res.status} from ${fetchUrl}`);
        return null;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ImageHostError(
          res.status === 429 ? 'rate-limited' : 'upstream-5xx',
          `HTTP ${res.status} from ${fetchUrl}`,
        );
        if (attempt < MAX_ATTEMPTS - 1) {
          const baseDelay = retryAfterMs(res) ?? 1500 * 2 ** attempt;
          const jitter = Math.floor(Math.random() * 500);
          await sleep(baseDelay + jitter);
          continue;
        }
        return null;
      }
      if (!res.ok) {
        lastErr = new ImageHostError('upstream-5xx', `HTTP ${res.status} from ${fetchUrl}`);
        return null;
      }
      const ct = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!ct.startsWith('image/')) {
        lastErr = new ImageHostError('non-image-content', `content-type ${ct}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < MIN_BYTES) {
        lastErr = new ImageHostError('too-small', `${buf.length} bytes`);
        return null;
      }
      if (buf.length > MAX_BYTES) {
        lastErr = new ImageHostError('too-large', `${buf.length} bytes`);
        return null;
      }
      body = buf;
      contentType = ct;
      break;
    } catch (err) {
      lastErr = new ImageHostError('network-error', (err as Error).message);
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(1500 * 2 ** attempt + Math.floor(Math.random() * 500));
        continue;
      }
      return null;
    }
  }
  if (!body) {
    // eslint-disable-next-line no-console
    console.warn(
      `[hostPlantImage] giving up on ${sourceUrl}: ${lastErr?.reason ?? 'unknown'}: ${lastErr?.detail ?? ''}`,
    );
    return null;
  }

  const key = `${KEY_PREFIX}/${plantImageId}.${extensionFor(contentType, sourceUrl)}`;
  try {
    const ref = await uploadToS3({ key, body, contentType });
    // Resolve the ref to a public `/v1/files/...` URL the browser can
    // fetch. TTL is ignored by the local storage backend (presign() in
    // infra/storage.ts).
    return await presign(ref, 0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[hostPlantImage] storage write failed for ${plantImageId}: ${(err as Error).message}`,
    );
    return null;
  }
}
