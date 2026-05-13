/**
 * GDPR Art. 15 — Subject Access Request fulfilment.
 *
 * Collect every row referencing the user, write JSON to MinIO, email a
 * pre-signed link (24h TTL).
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { uploadToS3, presign } from '../../../infra/storage.js';
import { enqueueEmail } from '../enqueue.js';

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
  const exportBundle = {
    exportedAt: new Date().toISOString(),
    subjectRights: 'GDPR Article 15',
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      locale: u.locale,
      homeRegion: u.homeRegion,
      postalAddress: u.postalAddress,
      createdAt: u.createdAt,
    },
    adoptions: await prisma.adoption.findMany({
      where: { donorId: u.id },
      include: { plant: { select: { nameEn: true, slug: true } }, tier: true },
    }),
    payments: await prisma.payment.findMany({ where: { donorId: u.id } }),
    receipts: await prisma.receipt.findMany({ where: { donorId: u.id } }),
    taxCertificates: await prisma.taxCertificate.findMany({ where: { donorId: u.id } }),
    askMessages: await prisma.askMessage.findMany({ where: { userId: u.id } }),
    auditLog: await prisma.auditLog.findMany({ where: { actorUserId: u.id } }),
  };

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
