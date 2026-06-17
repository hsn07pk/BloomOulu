/**
 * GDPR Art. 17 — Erasure ("right to be forgotten").
 *
 * Pseudonymise / scrub the user's PII while RETAINING financial records
 * (Finnish Accounting Act, 6-year retention). The actual scrub logic lives
 * in the shared eraseUserData (gdpr/gdpr.data.ts) so it stays in lock-step
 * with the export collector and is unit-testable in isolation. It covers:
 *
 *   - User email/name/image/address/homeRegion/preferences → pseudonymised
 *   - Adoption nickname/dedication/publicName/coAdopters/memorial/gift → cleared
 *   - Plaque.engravedText → "(erased)"
 *   - AdoptionBenefit.shippingAddress / trackingNumber → cleared
 *   - AskMessage.text → "(erased)" (timestamps kept for retention stats)
 *   - QuizAttempt.userId → null
 *   - Account + Session rows → deleted (they hold OAuth secrets / live creds)
 *   - AuditLog.ip / userAgent for the subject → nulled (action/resource kept)
 *   - Payment / Receipt / TaxCertificate → preserved (6-year retention)
 *
 * Records the action in AuditLog (the audit row itself is exempt from
 * erasure; this is a legal-basis trade-off documented in the privacy policy).
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { eraseUserData } from '../../gdpr/gdpr.data.js';

export interface GdprEraseJob {
  requestId: string;
}

export async function processGdprErase(job: Job<GdprEraseJob>) {
  const req = await prisma.dataErasureRequest.findUnique({
    where: { id: job.data.requestId },
  });
  if (!req) throw new Error(`Erasure request ${job.data.requestId} not found`);

  await eraseUserData(prisma, req.userId, req.approach);

  await prisma.dataErasureRequest.update({
    where: { id: req.id },
    data: { status: 'completed', completedAt: new Date() },
  });
}
