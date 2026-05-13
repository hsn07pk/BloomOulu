/**
 * S3-compatible storage helper. In production we use MinIO; the same code
 * works against AWS S3 / Backblaze B2 / Cloudflare R2 by changing endpoint.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = process.env.S3_ENDPOINT ?? 'http://minio:9000';
const region = process.env.S3_REGION ?? 'eu-central-003';
const bucket = process.env.S3_BUCKET ?? 'bloomoulu-assets';

const client = new S3Client({
  endpoint,
  region,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  },
  forcePathStyle: true,
});

export async function uploadToS3(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  return `${endpoint}/${bucket}/${input.key}`;
}

export async function presign(key: string, ttlSec: number): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSec },
  );
}
