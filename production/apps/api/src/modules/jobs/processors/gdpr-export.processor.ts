/**
 * GDPR Art. 15 / 20 — Subject Access Request fulfilment.
 *
 * Collect every row referencing the user (via the shared collectUserExport
 * so this stays in lock-step with the synchronous controller path), write
 * JSON to MinIO, email a pre-signed link (24h TTL).
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { uploadToS3, presign } from '../../../infra/storage.js';
import { enqueueEmail } from '../enqueue.js';
import { collectUserExport } from '../../gdpr/gdpr.data.js';

export interface GdprExportJob {
  requestId: string;
}

export async function processGdprExport(job: Job<GdprExportJob>) {
  const req = await prisma.dataExportRequest.findUnique({
    where: { id: job.data.requestId },
    include: { user: true },
  });
  if (!req) throw new Error(`Export request ${job.data.requestId} not found`);

  const u = req.user;
  const exportBundle = await collectUserExport(prisma, u.id);
  if (!exportBundle) throw new Error(`User ${u.id} not found for export ${req.id}`);

  const key = `gdpr-exports/${req.id}.json`;
  const bytes = Buffer.from(JSON.stringify(exportBundle, null, 2), 'utf-8');
  await uploadToS3({ key, body: bytes, contentType: 'application/json' });
  const url = await presign(key, 24 * 3600);

  await prisma.dataExportRequest.update({
    where: { id: req.id },
    data: { status: 'completed', exportUrl: url, completedAt: new Date() },
  });

  await enqueueEmail({
    template: 'gdpr-export-ready',
    to: u.email,
    locale: u.locale,
    variables: { donorName: u.name ?? u.email, url, expiresInHours: '24' },
  });
}
