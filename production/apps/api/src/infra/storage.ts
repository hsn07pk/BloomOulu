/**
 * Local-disk storage adapter — replaces the S3/MinIO backend.
 *
 * Why local: BloomOulu's intent is to self-host without any cloud
 * provider dependency. Receipt PDFs, audio narrations, plant images and
 * GDPR exports now live on a single mounted volume under
 * `STORAGE_DIR` (defaults to `./var/storage` relative to the API working
 * dir, configurable to e.g. `/var/lib/bloomoulu/storage` in production).
 *
 * URL contract — unchanged from the old S3 path so call sites don't care:
 *   • `uploadToS3({key, body, contentType})` writes to disk, returns
 *     `local://<key>` (was `s3://bucket/<key>`). Old `s3://…` references
 *     remain readable: presign() strips either prefix.
 *   • `presign(refOrUrl, ttlSec)` returns a public URL the browser can
 *     fetch, served by the API at /v1/files/<key>. ttlSec is ignored —
 *     files are accessible via direct URL, same effective trust model
 *     as the previous "presigned for 1h" links.
 *
 * Path hygiene: keys are normalised + traversal-blocked so a malicious
 * key like `../../etc/passwd` can never escape STORAGE_DIR.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getBrowserApiUrl } from '@bloomoulu/constants';

const STORAGE_DIR = path.resolve(
  process.env.STORAGE_DIR ?? path.join(process.cwd(), 'var', 'storage'),
);
const LEGACY_BUCKET = process.env.S3_BUCKET ?? 'bloomoulu-assets';

/** Normalise a key into a safe relative path. Throws on traversal. */
function safeKey(key: string): string {
  const cleaned = key.replace(/^\/+/, '').replace(/\\/g, '/');
  if (cleaned.includes('..')) {
    throw new Error(`storage: refusing key with traversal: ${key}`);
  }
  return cleaned;
}

function fullPath(key: string): string {
  return path.join(STORAGE_DIR, safeKey(key));
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

/**
 * Upload a buffer to local storage. Returns a `local://<key>` URI so the
 * caller can later resolve it via presign() to a browser-facing URL.
 */
export async function uploadToS3(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  const target = fullPath(input.key);
  await ensureDir(target);
  await fs.writeFile(target, input.body);
  // Sidecar metadata for content type — small JSON next to the blob.
  await fs.writeFile(
    `${target}.meta.json`,
    JSON.stringify({ contentType: input.contentType, size: input.body.length }),
  );
  return `local://${safeKey(input.key)}`;
}

/**
 * Resolve any storage URL (legacy `s3://bucket/key`, the new
 * `local://key`, or a raw key) into a browser-fetchable URL served by
 * the API at /v1/files/<key>. ttlSec is accepted for compatibility but
 * ignored — local files are served from a public route.
 */
export async function presign(refOrUrl: string, _ttlSec: number): Promise<string> {
  let key = refOrUrl;
  if (key.startsWith('s3://')) {
    key = key.replace(/^s3:\/\/[^/]+\//, '');
  } else if (key.startsWith('local://')) {
    key = key.slice('local://'.length);
  }
  // If it's already an http(s) URL (already presigned in cache somewhere),
  // hand it back untouched.
  if (/^https?:\/\//.test(key)) return key;
  const base = getBrowserApiUrl().replace(/\/$/, '');
  return `${base}/v1/files/${encodeURI(safeKey(key))}`;
}

/**
 * Read a file from local storage. Used by the /v1/files/* serving route.
 * Returns null if the key doesn't exist. Also accepts legacy s3:// refs.
 */
export async function readFile(
  refOrKey: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  let key = refOrKey;
  if (key.startsWith('s3://')) {
    key = key.replace(/^s3:\/\/[^/]+\//, '');
  } else if (key.startsWith('local://')) {
    key = key.slice('local://'.length);
  }
  const target = fullPath(key);
  try {
    const body = await fs.readFile(target);
    let contentType = 'application/octet-stream';
    try {
      const meta = JSON.parse(await fs.readFile(`${target}.meta.json`, 'utf-8')) as {
        contentType?: string;
      };
      if (meta.contentType) contentType = meta.contentType;
    } catch {
      contentType = guessContentType(key);
    }
    return { body, contentType };
  } catch {
    return null;
  }
}

function guessContentType(key: string): string {
  const ext = path.extname(key).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.json':
      return 'application/json';
    case '.mp3':
      return 'audio/mpeg';
    case '.mp4':
    case '.m4a':
      return 'audio/mp4';
    case '.wav':
      return 'audio/wav';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/** Exposed for tests + admin tooling — never call from request handlers. */
export const __storageRoot = STORAGE_DIR;
export const __legacyBucket = LEGACY_BUCKET;
