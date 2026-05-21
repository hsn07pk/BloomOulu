#!/usr/bin/env tsx
/**
 * Re-host external plant images into our own object store.
 *
 *   pnpm tsx scripts/rehost-images.ts [--dry-run] [--limit N] [--slug <slug>] [--bucket <name>] [--concurrency N]
 *
 * enrich-images.ts stores image URLs that point straight at Wikimedia
 * Commons and iNaturalist — i.e. the site hotlinks those external hosts.
 * That is fragile: upstream files get renamed or deleted (link rot), their
 * downtime becomes our broken images, and Wikimedia discourages hotlinking
 * its upload servers at scale.
 *
 * This script downloads each externally-hosted PlantImage once, uploads it
 * to our own S3-compatible store (MinIO in dev), and rewrites
 * PlantImage.url to the self-hosted copy. The database still holds only a
 * URL — it just points at us now. Run it after enrich-images.ts.
 *
 * Images go into a DEDICATED public-read bucket (default "bloomoulu-public"),
 * kept separate from the private "bloomoulu-assets" bucket that holds
 * receipts / GDPR exports. The script creates the bucket and sets its
 * public-read policy on first run.
 *
 * Licensing: every PlantImage already carries its licence + credit
 * (licenseSpdx / attribution), shown on the plant page. CC and
 * public-domain licences all permit hosting your own copy.
 *
 * Robustness: each download has a timeout and is retried; a failure on one
 * image is logged and skipped — the run does not crash. Idempotent and
 * resumable: rows already pointing at our store are skipped, so re-running
 * only picks up what is left (and retries anything that failed).
 *
 * Behaviour:
 *   * Default       — re-host every PlantImage still on an external host.
 *   * --slug        — only images of the plant with this slug (for testing).
 *   * --limit       — stop after N images.
 *   * --bucket      — target bucket name (default: bloomoulu-public).
 *   * --concurrency — parallel downloads/uploads (default: 6).
 *   * --dry-run     — list what would be re-hosted; download/upload nothing.
 */

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';

const prisma = new PrismaClient();

const UA =
  'BloomOulu-ImageRehost/1.0 (University of Oulu Botanical Garden adoption platform)';
const REQUEST_TIMEOUT_MS = 30_000;
const KEY_PREFIX = 'plant-images';
const MIN_IMAGE_BYTES = 1024; // smaller than this is almost certainly an error page
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB — skip anything absurd
const DEFAULT_BUCKET = 'bloomoulu-public';
const DEFAULT_CONCURRENCY = 4;

// S3-compatible store — the same env vars apps/api/src/infra/storage.ts uses.
const S3_ENDPOINT = (process.env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/+$/, '');
const S3_REGION = process.env.S3_REGION ?? 'eu-north-1';
const S3_FORCE_PATH_STYLE = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';

interface CliArgs {
  dryRun: boolean;
  limit: number;
  slug?: string;
  bucket: string;
  concurrency: number;
}

function parseArgs(): CliArgs {
  const out: CliArgs = {
    dryRun: false,
    limit: Infinity,
    bucket: process.env.S3_PUBLIC_BUCKET ?? DEFAULT_BUCKET,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i]!;
    if (v === '--dry-run') out.dryRun = true;
    else if (v === '--limit') out.limit = parseInt(process.argv[++i]!, 10);
    else if (v === '--slug') out.slug = process.argv[++i]!;
    else if (v === '--bucket') out.bucket = process.argv[++i]!;
    else if (v === '--concurrency') out.concurrency = parseInt(process.argv[++i]!, 10);
  }
  if (Number.isNaN(out.limit)) out.limit = Infinity;
  if (Number.isNaN(out.concurrency) || out.concurrency < 1) out.concurrency = DEFAULT_CONCURRENCY;
  return out;
}

/** The public URL prefix our re-hosted objects are served from. */
function publicBase(bucket: string): string {
  return `${S3_ENDPOINT}/${bucket}`;
}

/** True if a PlantImage URL still points at an external host (needs re-hosting). */
function isExternal(url: string, bucket: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false; // not a fetchable URL — leave it alone
  return !url.startsWith(`${publicBase(bucket)}/`);
}

/** Pick a file extension from the content-type, falling back to the URL. */
function extensionFor(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('avif')) return 'avif';
  if (ct.includes('svg')) return 'svg';
  const m = url.toLowerCase().match(/\.(jpe?g|png|webp|gif|avif|svg)(?:[?#]|$)/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1]!;
  return 'jpg'; // last-ditch default
}

/**
 * Honour a 429/503 Retry-After header (delay-seconds or an HTTP date),
 * capped at 2 min. Null when the header is absent or unparseable.
 */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 120_000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 120_000);
  return null;
}

/**
 * Wikimedia rejects original-file and non-standard-size requests on
 * upload.wikimedia.org — only a fixed set of thumbnail widths is served
 * (…250, 330, 500, 960, 1280, 1920, 3840). Rewrite an original Commons URL
 * to the 1280px standard thumbnail; /thumb/ URLs (already 1280px, as
 * enrich-images.ts requests that width) and non-Wikimedia URLs pass
 * through unchanged.
 */
function toFetchableUrl(url: string): string {
  const m = url.match(
    /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/([0-9a-fA-F])\/([0-9a-fA-F]{2})\/([^/]+)$/,
  );
  if (!m) return url; // already a thumbnail, or not a Wikimedia original
  const [, base, h1, h2, file] = m;
  return `${base}/thumb/${h1}/${h2}/${file}/1280px-${file}`;
}

interface DownloadedImage {
  body: Buffer;
  contentType: string;
}

/** Download an image with a timeout + retry. Returns null on give-up / non-image. */
async function downloadImage(url: string, retries = 3): Promise<DownloadedImage | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (res.status === 404 || res.status === 410) return null; // gone for good
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(retryAfterMs(res) ?? 1500 * (attempt + 1));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      const contentType = (res.headers.get('content-type') ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase();
      if (!contentType.startsWith('image/')) return null; // an HTML error page, etc.
      if (Number(res.headers.get('content-length') ?? '0') > MAX_IMAGE_BYTES) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length < MIN_IMAGE_BYTES || body.length > MAX_IMAGE_BYTES) return null;
      return { body, contentType };
    } catch {
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

function makeS3Client(): S3Client {
  return new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
    },
    forcePathStyle: S3_FORCE_PATH_STYLE,
  });
}

/** Create the bucket if missing, then ensure its anonymous public-read policy. */
async function ensurePublicBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      // Race / already created — only a genuine failure should abort.
      if (err?.name !== 'BucketAlreadyOwnedByYou' && err?.name !== 'BucketAlreadyExists') {
        throw err;
      }
    }
  }
  // Anyone may GET objects — this bucket holds only public web images.
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
  await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }));
}

/** Run `fn` over `items` with at most `concurrency` promises in flight. */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      await fn(items[next++]!);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs();
  const base = publicBase(args.bucket);
  console.log(
    `Image re-host — ${args.dryRun ? 'DRY RUN (no writes)' : 'writing'}` +
      `, bucket=${args.bucket}` +
      `${args.slug ? `, slug=${args.slug}` : ''}` +
      `${args.limit !== Infinity ? `, limit=${args.limit}` : ''}` +
      `${args.dryRun ? '' : `, concurrency=${args.concurrency}`}`,
  );

  // ── PlantImages still hosted on an external site ────────────────────────
  const images = await prisma.plantImage.findMany({
    where: args.slug ? { plant: { slug: args.slug } } : undefined,
    select: { id: true, url: true, plant: { select: { slug: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const external = images.filter((img) => isExternal(img.url, args.bucket));
  const target = external.slice(0, args.limit);
  console.log(
    `${images.length} images · ${images.length - external.length} already self-hosted · ` +
      `re-hosting ${target.length}.\n`,
  );
  if (target.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // ── Dry run — just list the plan ────────────────────────────────────────
  if (args.dryRun) {
    for (let i = 0; i < target.length; i++) {
      const img = target[i]!;
      const key = `${KEY_PREFIX}/${img.id}.${extensionFor('', img.url)}`;
      console.log(
        `[${i + 1}/${target.length}] ${img.plant?.slug ?? '(no plant)'}\n` +
          `        ${img.url.slice(0, 96)}\n` +
          `     -> ${base}/${key}`,
      );
    }
    console.log(`\nDry run — ${target.length} image(s) would be re-hosted into "${args.bucket}".`);
    return;
  }

  // ── Prepare the public bucket ───────────────────────────────────────────
  const s3 = makeS3Client();
  console.log(`Preparing public bucket "${args.bucket}" …`);
  await ensurePublicBucket(s3, args.bucket);

  // ── Re-host ─────────────────────────────────────────────────────────────
  let done = 0;
  let uploaded = 0;
  let failed = 0;
  await mapPool(target, args.concurrency, async (img) => {
    const label = img.plant?.slug ?? img.id;
    try {
      const dl = await downloadImage(toFetchableUrl(img.url));
      if (!dl) {
        failed++;
        console.warn(
          `[${++done}/${target.length}] ! ${label} — could not fetch ${img.url.slice(0, 70)}`,
        );
        return;
      }
      const key = `${KEY_PREFIX}/${img.id}.${extensionFor(dl.contentType, img.url)}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: args.bucket,
          Key: key,
          Body: dl.body,
          ContentType: dl.contentType,
          // Objects are keyed by PlantImage id and never mutated in place.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      await prisma.plantImage.update({
        where: { id: img.id },
        data: { url: `${base}/${key}` },
      });
      uploaded++;
      console.log(
        `[${++done}/${target.length}] + ${label} — ${(dl.body.length / 1024).toFixed(0)} KB`,
      );
    } catch (err) {
      // One image failing must never stop the run.
      failed++;
      console.error(
        `[${++done}/${target.length}] ! ${label} — ${(err as Error)?.message ?? String(err)}`,
      );
    }
  });

  console.log(
    `\nDone. re-hosted=${uploaded} failed=${failed} — served from ${base}/${KEY_PREFIX}/`,
  );
  if (failed > 0) {
    console.log(
      'Failed images keep their original URL. Transient failures clear on a re-run; ' +
        'a persistently failing URL is dead at the source (e.g. a seed placeholder) — ' +
        're-fetch it with `enrich-images.ts --force`.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
