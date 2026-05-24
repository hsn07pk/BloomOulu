/**
 * Hosts an enriched plant photo in our own public object store, so the
 * site serves images itself instead of hotlinking Wikimedia / iNaturalist.
 *
 * Mirrors scripts/rehost-images.ts: Wikimedia original-file URLs are
 * routed through the 1280px standard thumbnail (Wikimedia rejects
 * original-file and non-standard-size requests), and the dedicated
 * public-read bucket is created with its policy on first use.
 */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { setTimeout as sleep } from 'node:timers/promises';
import { ENRICH_UA, retryAfterMs } from './http.js';

// Internal endpoint — used to PUT objects from inside the API container.
// In compose dev this is `http://minio:9000` (the docker-network hostname).
const S3_ENDPOINT = (process.env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/+$/, '');
// Public endpoint — what browsers can reach. In compose dev this is
// `http://localhost:9000` (MinIO's host-mapped port); in prod it's the
// CDN/storage subdomain. Falls back to S3_ENDPOINT for backward compat
// when only one URL is set (e.g. local-host scripts).
const S3_PUBLIC_ENDPOINT = (
  process.env.S3_PUBLIC_ENDPOINT
  ?? process.env.NEXT_PUBLIC_S3_ENDPOINT
  ?? process.env.S3_ENDPOINT
  ?? 'http://localhost:9000'
).replace(/\/+$/, '');
const S3_REGION = process.env.S3_REGION ?? 'eu-north-1';
const S3_FORCE_PATH_STYLE = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
const PUBLIC_BUCKET = process.env.S3_PUBLIC_BUCKET ?? 'bloomoulu-public';
const KEY_PREFIX = 'plant-images';
const MIN_BYTES = 1024; // smaller is almost certainly an error page
const MAX_BYTES = 25 * 1024 * 1024;

let s3: S3Client | null = null;
function client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
      },
      forcePathStyle: S3_FORCE_PATH_STYLE,
    });
  }
  return s3;
}

// Bucket creation + public-read policy are idempotent and only needed once
// per process — memoise the promise.
let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const c = client();
    try {
      await c.send(new HeadBucketCommand({ Bucket: PUBLIC_BUCKET }));
    } catch {
      try {
        await c.send(new CreateBucketCommand({ Bucket: PUBLIC_BUCKET }));
      } catch (err: any) {
        if (err?.name !== 'BucketAlreadyOwnedByYou' && err?.name !== 'BucketAlreadyExists') {
          throw err;
        }
      }
    }
    await c.send(
      new PutBucketPolicyCommand({
        Bucket: PUBLIC_BUCKET,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${PUBLIC_BUCKET}/*`],
            },
          ],
        }),
      }),
    );
  })();
  return bucketReady;
}

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
 * Download `sourceUrl` and store it in the public bucket under
 * plant-images/<plantImageId>.<ext>. Returns the public URL of the hosted
 * copy, or null if the image could not be fetched.
 */
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
      | 's3-error',
    public detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'ImageHostError';
  }
}

export async function hostPlantImage(
  sourceUrl: string,
  plantImageId: string,
): Promise<string | null> {
  const fetchUrl = toFetchableUrl(sourceUrl);
  let body: Buffer | null = null;
  let contentType = '';
  // 6 attempts × exponential back-off (1.5s, 3s, 6s, 12s, 24s) ≈ 45s
  // total retry budget. Earlier code only tried 4 times which was too
  // aggressive when Wikimedia was rate-limiting a bulk-approve burst.
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
          // Honour Retry-After if the server gave one, otherwise an
          // exponential back-off with jitter so a burst of 100 parallel
          // approvals doesn't all retry at the same instant.
          const baseDelay = retryAfterMs(res) ?? 1500 * 2 ** attempt;
          const jitter = Math.floor(Math.random() * 500);
          await sleep(baseDelay + jitter);
          continue;
        }
        return null;
      }
      if (!res.ok) {
        lastErr = new ImageHostError(
          'upstream-5xx',
          `HTTP ${res.status} from ${fetchUrl}`,
        );
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
    // Last-chance log so the operator can see the real cause in the
    // server stdout / observability stream rather than a flat "null".
    // eslint-disable-next-line no-console
    console.warn(
      `[hostPlantImage] giving up on ${sourceUrl}: ${lastErr?.reason ?? 'unknown'}: ${lastErr?.detail ?? ''}`,
    );
    return null;
  }

  await ensureBucket();
  const key = `${KEY_PREFIX}/${plantImageId}.${extensionFor(contentType, sourceUrl)}`;
  await client().send(
    new PutObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Objects are keyed by PlantImage id and never mutated in place.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  // Browser-facing URL, NOT the internal docker hostname. Without this
  // split, the row in PlantImage points at `http://minio:9000/…` which
  // resolves only inside the docker network and the public site falls
  // back to the 🌿 placeholder.
  return `${S3_PUBLIC_ENDPOINT}/${PUBLIC_BUCKET}/${key}`;
}
