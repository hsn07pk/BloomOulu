/**
 * GDPR Art. 17 — Erasure ("right to be forgotten").
 *
 * Pseudonymise the user's PII while RETAINING financial records (Finnish
 * Accounting Act, 6-year retention). Specifically:
 *
 *   - User.email   → "erased-<hash>@bloomoulu.deleted"
 *   - User.name    → null
 *   - User.postalAddress → null
 *   - AdoptionDedication, AdoptionNickname → "(redacted)"
 *   - AskMessage.text → null (keep timestamps for retention statistics)
 *   - Payment / Receipt / TaxCertificate rows are untouched
 *
 * Records the action in AuditLog (the audit row itself is exempt from
 * erasure; this is a legal-basis trade-off documented in the privacy policy).
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { createHash } from 'node:crypto';

export interface GdprEraseJob {
  requestId: string;
}

export async function processGdprErase(job: Job<GdprEraseJob>) {
  const req = await prisma.dataErasureRequest.findUnique({
    where: { id: job.data.requestId },
  });
  if (!req) throw new Error(`Erasure request ${job.data.requestId} not found`);

  const userId = req.userId;
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new Error('user disappeared');

    const pseudoEmail = `erased-${createHash('sha256').update(u.email).digest('hex').slice(0, 16)}@bloomoulu.deleted`;

    await tx.user.update({
      where: { id: userId },
      data: {
        email: pseudoEmail,
        name: null,
        image: null,
        postalAddress: undefined,
        homeRegion: null,
        preferences: {} as any,
        deletedAt: new Date(),
      },
    });

    await tx.adoption.updateMany({
      where: { donorId: userId },
      data: { nickname: null, dedication: null, publicName: null, showOnDonorWall: false },
    });

    await tx.askMessage.updateMany({
      where: { userId },
      data: { text: '(erased)' },
    });

    await tx.dataErasureRequest.update({
      where: { id: req.id },
      data: { status: 'completed', completedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        action: 'gdpr.erase',
        resource: `User/${userId}`,
        after: { approach: req.approach },
      },
    });
  });
}
