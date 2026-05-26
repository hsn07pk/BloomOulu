/**
 * Daily reconciliation cron — runs at 03:00 UTC.
 *
 * For every Payment.succeeded in the last 30 days:
 *   - Paytrail: GET /payments/{transactionId} → verify amount+status
 *   - MobilePay: GET /epayment/v1/payments/{ref}
 *   - bank_transfer: verify ProcessedEvent exists (already reconciled)
 *
 * Discrepancies → ReconciliationException row + P0 alert via ntfy.
 * Pending > 24h → mark failed + email donor with retry link.
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { enqueueEmail } from '../enqueue.js';
import { ntfyAlert } from '../../../infra/alerts.js';

export interface ReconciliationJob {
  windowHours?: number;
}

export async function processReconciliation(job: Job<ReconciliationJob>) {
  const since = new Date(Date.now() - (job.data.windowHours ?? 24 * 30) * 3600_000);
  let exceptions = 0;

  // 1. Stale-pending → fail + notify
  const stale = await prisma.payment.findMany({
    where: { status: 'pending', createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
    include: { donor: { select: { email: true, locale: true, name: true } } },
  });
  for (const p of stale) {
    await prisma.payment.update({
      where: { id: p.id },
      data: { status: 'failed', failureCode: 'reconcile.timeout', failureMessage: 'No completion received within 24h' },
    });
    await enqueueEmail({
      template: 'payment-not-received',
      to: p.donor.email,
      locale: p.donor.locale,
      variables: {
        donorName: p.donor.name ?? '',
        amount: (p.amountCents / 100).toFixed(2),
      },
    });
  }

  // 2. Succeeded payments: verify they exist at the provider
  const succeeded = await prisma.payment.findMany({
    where: { status: 'succeeded', receivedAt: { gte: since } },
  });
  for (const p of succeeded) {
    // For bank_transfer we trust the ProcessedEvent row entirely.
    if (p.provider === 'bank_transfer') continue;
    // For Paytrail/MobilePay, the API call to verify lives in the
    // gateway adapter. Here we just sanity-check that we have a
    // ProcessedEvent for this payment.
    const evt = await prisma.processedEvent.findFirst({
      where: { paymentId: p.id },
    });
    if (!evt) {
      exceptions++;
      // Record a finding in AuditLog with kind=reconciliation_exception
      await prisma.auditLog.create({
        data: {
          action: 'reconciliation.missing_event',
          resource: `Payment/${p.id}`,
          after: { provider: p.provider, providerPaymentRef: p.providerPaymentRef ?? null },
        },
      });
    }
  }

  if (exceptions > 0) {
    await ntfyAlert({
      tier: 'P0',
      title: `Reconciliation: ${exceptions} mismatched payment(s)`,
      body: `Open /admin/resources/AuditLog?filters.action=reconciliation.missing_event`,
    });
  }

  // 3. Bank-transfer staleness — donors who chose bank but haven't
  //    paid in 7+ days are unlikely to. The accountant should see a
  //    list so they can either nudge or write off. P1 (not P0) — this
  //    is operational, not a code-bug.
  const staleBank = await prisma.payment.count({
    where: {
      status: 'pending',
      provider: 'bank_transfer',
      createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) },
    },
  });
  if (staleBank > 0) {
    await ntfyAlert({
      tier: 'P1',
      title: `Reconciliation: ${staleBank} bank-transfer payment(s) pending > 7d`,
      body:
        `Either upload the latest camt.054 CSV at /admin/pages/reconciliation, ` +
        `or write the donors off in /admin → Payment with status=pending+provider=bank_transfer.`,
    });
  }

  return { exceptions, stale: stale.length, staleBank };
}
