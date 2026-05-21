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

const S3_ENDPOINT = (process.env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/+$/, '');
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
export async function hostPlantImage(
  sourceUrl: string,
  plantImageId: string,
): Promise<string | null> {
  const fetchUrl = toFetchableUrl(sourceUrl);
  let body: Buffer | null = null;
  let contentType = '';
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(fetchUrl, {
        headers: { 'user-agent': ENRICH_UA },
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow',
      });
      if (res.status === 404 || res.status === 410) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 3) {
          await sleep(retryAfterMs(res) ?? 1500 * (attempt + 1));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!ct.startsWith('image/')) return null; // an HTML error page, etc.
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;
      body = buf;
      contentType = ct;
      break;
    } catch {
      if (attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  if (!body) return null;

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
  return `${S3_ENDPOINT}/${PUBLIC_BUCKET}/${key}`;
}
