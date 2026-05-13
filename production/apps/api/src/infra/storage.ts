/**
 * S3-compatible storage helper. In production we use MinIO; the same code
 * works against AWS S3 / Backblaze B2 / Cloudflare R2 by changing endpoint.
 *
 * On first use we lazily create the bucket if it doesn't exist (idempotent).
 * Production deployments should pre-create the bucket via Terraform/IaC and
 * the lazy create becomes a no-op.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const region = process.env.S3_REGION ?? 'eu-north-1';
const bucket = process.env.S3_BUCKET ?? 'bloomoulu-assets';
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';

const client = new S3Client({
  endpoint,
  region,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  },
  forcePathStyle,
});

let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: any) {
        // Race against another worker creating the bucket — ignore conflict.
        if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') {
          throw err;
        }
      }
    }
  })();
  return bucketReady;
}

export async function uploadToS3(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  await ensureBucket();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  // Return a key reference (not a raw URL) — callers use `presign(key)` to
  // get a short-lived URL for the donor.
  return `s3://${bucket}/${input.key}`;
}

export async function presign(keyOrUrl: string, ttlSec: number): Promise<string> {
  const key = keyOrUrl.startsWith('s3://')
    ? keyOrUrl.slice(`s3://${bucket}/`.length)
    : keyOrUrl;
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSec },
  );
}
