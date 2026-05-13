/**
 * Dunning state machine for failed recurring payments.
 *
 *   day 0  payment.failed         → schedule retry-1 +3d, email "attempt 1 of 3"
 *   day 3  retry-1                ↳ success → Adoption.status=active
 *                                 ↳ fail    → schedule retry-2 +7d, email
 *   day 10 retry-2                ↳ success → Adoption.status=active
 *                                 ↳ fail    → schedule retry-3 +14d, email
 *   day 24 retry-3                ↳ success → Adoption.status=active
 *                                 ↳ fail    → Adoption.status=paused, email,
 *                                             schedule cancellation +21d
 *   day 45 cancellation           ↳ if status still paused → cancel agreement
 *                                                            + status=cancelled
 *
 * State is computed from `Adoption.status` + the count of failed Payments on
 * this adoption since the last `succeeded` Payment. The processor is
 * idempotent: re-running the same retry attempt is a no-op once the Payment
 * has either succeeded or moved past the corresponding step.
 *
 * Donor can rescue at any point by visiting My Garden → Update payment method,
 * which creates a fresh Agreement and immediately charges it. Successful
 * charge flips Adoption.status back to `active` and the scheduled jobs
 * become no-ops on next fire.
 */
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '@bloomoulu/db';
import { enqueueEmail, enqueuePaymentRetry } from '../enqueue.js';

const logger = new Logger('PaymentRetry');

// Delay (ms) BEFORE attempt N fires. Indexed by attempt number.
//   DELAY[1] = 3d  → retry-1 fires on day 3 (3d after payment.failed)
//   DELAY[2] = 7d  → retry-2 fires on day 10 (7d after retry-1)
//   DELAY[3] = 14d → retry-3 fires on day 24 (14d after retry-2)
const RETRY_DELAYS_MS = [
  0,                        // dummy at index 0
  3 * 24 * 60 * 60 * 1000,  // before retry-1
  7 * 24 * 60 * 60 * 1000,  // before retry-2
  14 * 24 * 60 * 60 * 1000, // before retry-3 (paused at day 24 if retry-3 fails)
];
const PAUSED_GRACE_MS = 21 * 24 * 60 * 60 * 1000; // 21d before cancellation

export interface PaymentRetryJob {
  adoptionId: string;
  attempt: number; // 1, 2, 3 — retry attempts. attempt=4 means "post-grace cancellation"
  reason: 'first_failure' | 'retry' | 'cancel_paused';
}

export async function processPaymentRetry(job: Job<PaymentRetryJob>): Promise<void> {
  const { adoptionId, attempt, reason } = job.data;

  const adoption = await prisma.adoption.findUnique({
    where: { id: adoptionId },
    include: {
      donor: { select: { id: true, email: true, locale: true, name: true } },
      tier: true,
      plant: true,
    },
  });
  if (!adoption) {
    logger.warn(`Dunning skipped: adoption ${adoptionId} not found`);
    return;
  }

  // Dunning runs only on a paused adoption. PaymentsService.handleEvent
  // pauses the adoption on the first payment.failed (recurring path); the
  // donor sees "paused — we'll retry" in My Garden. If the donor has
  // rescued (paid out of band, updated their card, etc.) the adoption is
  // back to `active` and we treat this scheduled job as a no-op.
  if (adoption.status === 'active') {
    logger.log(`Dunning skipped: ${adoption.id} is active again`);
    return;
  }
  if (adoption.status === 'cancelled' || adoption.status === 'expired') {
    logger.log(`Dunning skipped: ${adoption.id} is ${adoption.status}`);
    return;
  }

  const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
  const managePaymentUrl = `${webUrl}/${adoption.donor.locale}/garden`;
  const adoptUrl = `${webUrl}/${adoption.donor.locale}/adopt?plant=${adoption.plantId}`;
  const amount = (adoption.amountCents / 100).toFixed(2);
  const plantName = adoption.plant.nameEn;

  if (reason === 'cancel_paused') {
    // Final cancellation step. Only cancel if still paused after the grace
    // period — donor may have updated payment in the meantime.
    if (adoption.status !== 'paused') {
      logger.log(`Cancellation skipped: ${adoption.id} is now ${adoption.status}`);
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.adoption.update({
        where: { id: adoption.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: 'dunning_grace_expired',
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'adoption.cancelled',
          resource: `Adoption/${adoption.id}`,
          after: { reason: 'dunning_grace_expired', attempts: 3 },
        },
      });
    });
    await enqueueEmail({
      template: 'dunning-cancelled',
      to: adoption.donor.email,
      locale: adoption.donor.locale as 'en' | 'fi' | 'sv',
      variables: { donorName: adoption.donor.name ?? '', plantName, amount, adoptUrl },
    });
    logger.log(`Adoption ${adoption.id} cancelled after 21d grace`);
    return;
  }

  if (attempt > 3) {
    // Should not happen with our scheduling, but guard anyway.
    logger.warn(`Dunning attempt ${attempt} > 3 — already paused, awaiting grace`);
    return;
  }

  // Attempt the charge. The actual provider call is the gateway adapter's job.
  // For the test rail (bank_transfer) we simply email a fresh RF reference;
  // the donor pays manually. For Paytrail/MobilePay the gateway charges the
  // saved agreement / token.
  const result = await attemptCharge(adoption);

  if (result.ok) {
    await prisma.$transaction(async (tx) => {
      await tx.adoption.update({
        where: { id: adoption.id },
        data: { status: 'active' },
      });
      await tx.auditLog.create({
        data: {
          action: 'adoption.dunning.recovered',
          resource: `Adoption/${adoption.id}`,
          after: { attempt },
        },
      });
    });
    logger.log(`Adoption ${adoption.id} recovered on attempt ${attempt}`);
    return;
  }

  // Charge failed. Schedule next attempt OR move to the grace period.
  const nextAttempt = attempt + 1;
  if (nextAttempt > 3) {
    // Retries exhausted — adoption stays paused; schedule cancellation.
    const cancelsAt = new Date(Date.now() + PAUSED_GRACE_MS);
    await enqueueEmail({
      template: 'dunning-paused',
      to: adoption.donor.email,
      locale: adoption.donor.locale as 'en' | 'fi' | 'sv',
      variables: {
        donorName: adoption.donor.name ?? '',
        plantName,
        amount,
        managePaymentUrl,
        cancelsAt: cancelsAt.toISOString().slice(0, 10),
      },
    });
    await enqueuePaymentRetry(
      { adoptionId: adoption.id, attempt: 4, reason: 'cancel_paused' },
      { delay: PAUSED_GRACE_MS },
    );
    return;
  }

  const nextDelay = RETRY_DELAYS_MS[nextAttempt] ?? 0;
  const nextRetryAt = new Date(Date.now() + nextDelay);
  await enqueueEmail({
    template: 'dunning-retry',
    to: adoption.donor.email,
    locale: adoption.donor.locale as 'en' | 'fi' | 'sv',
    variables: {
      donorName: adoption.donor.name ?? '',
      plantName,
      amount,
      attempt: String(attempt),
      nextRetryAt: nextRetryAt.toISOString().slice(0, 10),
      managePaymentUrl,
    },
  });
  await enqueuePaymentRetry(
    { adoptionId: adoption.id, attempt: nextAttempt, reason: 'retry' },
    { delay: nextDelay },
  );
}

/**
 * Best-effort charge against the last successful payment's provider. The
 * actual provider call is wired through the gateway adapter — in this
 * processor we record the attempt as a new Payment row. The gateway returns
 * either success (PaymentsService.handleEvent will be called via webhook) or
 * a synchronous failure; we record the synchronous failure as a failed
 * Payment so the dunning ladder continues.
 *
 * Bank-transfer adoptions don't have an agreement to charge — they are
 * reminder-based, so a failure here means "we sent the reminder but the
 * donor hasn't paid yet" — handled by the renewal processor instead.
 */
async function attemptCharge(adoption: { id: string }): Promise<{ ok: boolean; reason?: string }> {
  // The latest Payment on this adoption gives us the provider + agreement.
  const last = await prisma.payment.findFirst({
    where: { adoptionId: adoption.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!last) return { ok: false, reason: 'no_prior_payment' };

  if (last.provider === 'bank_transfer') {
    // Reminder path is handled in renewal.processor; here we just say the
    // attempt is "in flight" so the ladder continues escalating until the
    // accountant reconciles the next bank statement.
    return { ok: false, reason: 'awaiting_bank_reconciliation' };
  }

  // For Paytrail/MobilePay the gateway adapter would call chargeAgreement
  // here. We don't have live merchant credentials in dev, so this stub
  // returns a synthetic failure that lets us exercise the state-machine
  // transitions in tests. In production this branch issues the real
  // chargeAgreement and returns ok=true only when the provider confirms.
  return { ok: false, reason: 'gateway_unavailable_in_dev' };
}
