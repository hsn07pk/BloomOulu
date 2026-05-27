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
import { getWebUrl } from '@bloomoulu/constants';
import { Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { prisma, cancelAdoption, recoverAdoption } from '@bloomoulu/db';
import { PaymentStatus } from '@prisma/client';
import type { PaymentGateway, ProviderId } from '@bloomoulu/payments';
import { rfCreditorReference } from '@bloomoulu/payments';
import { enqueueEmail, enqueuePaymentRetry, enqueueReceipt } from '../enqueue.js';

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

export interface PaymentRetryDeps {
  /** Resolve a stateless `PaymentGateway` adapter for a provider id.
   *  Injected so the worker process can wire it from env without Nest DI. */
  gatewayFor: (provider: ProviderId) => PaymentGateway;
}

/** Backwards-compatible default deps: throws if the worker hasn't wired
 *  a real gateway factory. Used by tests/legacy callers. */
const NO_GATEWAY: PaymentRetryDeps = {
  gatewayFor: (provider) => {
    throw new Error(`No gateway wired for provider ${provider} — pass deps to makeProcessPaymentRetry`);
  },
};

export const processPaymentRetry = (job: Job<PaymentRetryJob>) =>
  makeProcessPaymentRetry(NO_GATEWAY)(job);

export function makeProcessPaymentRetry(deps: PaymentRetryDeps) {
  return async function processPaymentRetryWithDeps(job: Job<PaymentRetryJob>): Promise<void> {
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

  const webUrl = getWebUrl();
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
    await prisma.$transaction((tx) =>
      cancelAdoption(tx, adoption.id, {
        reason: 'dunning_grace_expired',
        cancelledAt: new Date(),
      }),
    );
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

  // Attempt the charge. For Paytrail/MobilePay the gateway adapter
  // charges the saved agreement / token MIT-style; for bank_transfer
  // we email a fresh RF reference (donor pays manually). The
  // attemptCharge helper handles all three and records a new Payment
  // row capturing the attempt outcome.
  const result = await attemptCharge(deps, adoption);

  if (result.ok) {
    await prisma.$transaction((tx) => recoverAdoption(tx, adoption.id));
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
  };
}

/**
 * Best-effort charge against the last successful payment's stored
 * agreement / token. Creates a fresh Payment row capturing the attempt
 * — succeeded if the provider confirms synchronously, failed
 * otherwise. The dunning ladder reads that row on the next escalation.
 *
 * Per-rail behaviour:
 *   - paytrail   → POST /payments/token/mit-charge against the stored token
 *   - mobilepay  → POST /recurring/v3/agreements/{id}/charges
 *   - bank_transfer → email donor a fresh RF reference; mark attempt
 *                     `pending` so the ladder keeps escalating until
 *                     the accountant uploads the next CSV
 */
async function attemptCharge(
  deps: PaymentRetryDeps,
  adoption: {
    id: string;
    donorId: string;
    amountCents: number;
    plant: { nameEn: string };
    donor: { email: string; locale: string; name: string | null };
  },
): Promise<{ ok: boolean; reason?: string }> {
  const last = await prisma.payment.findFirst({
    where: { adoptionId: adoption.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!last) return { ok: false, reason: 'no_prior_payment' };

  const newOrderId = uuidv7();
  const description = `Recurring adoption: ${adoption.plant.nameEn}`;

  if (last.provider === 'bank_transfer') {
    // Reminder path — the donor must initiate the SCT themselves. We
    // create a pending Payment row keyed to a fresh RF reference and
    // mail the donor. The accountant's daily reconciliation matches
    // the inbound payment via PaymentsService.handleEvent, which
    // flips this row to succeeded and triggers recoverAdoption.
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: newOrderId,
          adoptionId: adoption.id,
          donorId: adoption.donorId,
          provider: 'bank_transfer' as const,
          amountCents: adoption.amountCents,
          currency: 'EUR',
          netCents: adoption.amountCents,
          vatRateBp: 0,
          vatCents: 0,
          status: PaymentStatus.pending,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adoption.donorId,
          action: 'payment.dunning.reminder',
          resource: `Adoption/${adoption.id}`,
          after: { orderId: newOrderId, amountCents: adoption.amountCents, channel: 'bank_transfer' },
        },
      });
    });
    await enqueueEmail({
      template: 'bank-transfer-reminder',
      to: adoption.donor.email,
      locale: adoption.donor.locale as 'en' | 'fi' | 'sv',
      variables: {
        donorName: adoption.donor.name ?? '',
        plantName: adoption.plant.nameEn,
        amount: (adoption.amountCents / 100).toFixed(2),
        reference: rfCreditorReference(newOrderId),
      },
    });
    return { ok: false, reason: 'awaiting_bank_reconciliation' };
  }

  // Card / MobilePay: charge the stored credential MIT-style.
  if (!last.providerCustomerId) {
    // We don't have a usable agreement / token. Either the donor
    // never opted into recurring or the token expired. Mark the
    // attempt failed so the ladder escalates.
    await recordFailedAttempt(adoption, last, newOrderId, 'no_agreement_credential');
    return { ok: false, reason: 'no_agreement_credential' };
  }

  let gateway: PaymentGateway;
  try {
    gateway = deps.gatewayFor(last.provider as ProviderId);
  } catch (err) {
    logger.error(`No gateway for ${last.provider}: ${(err as Error).message}`);
    await recordFailedAttempt(adoption, last, newOrderId, 'gateway_unavailable');
    return { ok: false, reason: 'gateway_unavailable' };
  }

  const result = await gateway.chargeAgreement({
    orderId: newOrderId,
    agreementId: last.providerCustomerId,
    amountCents: adoption.amountCents,
    currency: 'EUR',
    description,
  });

  if (!result.ok) {
    await recordFailedAttempt(adoption, last, newOrderId, result.code, result.message);
    return { ok: false, reason: result.code };
  }

  // Provider confirmed the charge synchronously. Write a succeeded
  // Payment row, run the same downstream effects as a webhook (audit
  // log, receipt enqueue) — but skip lifecycle.activate; the dunning
  // caller does `recoverAdoption` for us when we return ok=true.
  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: newOrderId,
        adoptionId: adoption.id,
        donorId: adoption.donorId,
        provider: last.provider,
        providerCustomerId: last.providerCustomerId,
        providerPaymentRef: result.chargeId,
        amountCents: adoption.amountCents,
        currency: 'EUR',
        netCents: adoption.amountCents,
        vatRateBp: 0,
        vatCents: 0,
        status: result.status === 'succeeded' ? PaymentStatus.succeeded : PaymentStatus.pending,
        receivedAt: result.status === 'succeeded' ? new Date() : null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: adoption.donorId,
        action: 'payment.dunning.charged',
        resource: `Adoption/${adoption.id}`,
        after: {
          orderId: newOrderId,
          provider: last.provider,
          chargeId: result.chargeId,
          status: result.status,
          amountCents: adoption.amountCents,
        },
      },
    });
  });
  if (result.status === 'succeeded') {
    const created = await prisma.payment.findUniqueOrThrow({
      where: { orderId: newOrderId },
      select: { id: true },
    });
    await enqueueReceipt({ paymentId: created.id });
  }
  return { ok: result.status === 'succeeded' };
}

async function recordFailedAttempt(
  adoption: { id: string; donorId: string; amountCents: number },
  last: { provider: 'paytrail' | 'mobilepay' | 'bank_transfer'; providerCustomerId: string | null },
  newOrderId: string,
  code: string,
  message?: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: newOrderId,
        adoptionId: adoption.id,
        donorId: adoption.donorId,
        provider: last.provider,
        providerCustomerId: last.providerCustomerId,
        amountCents: adoption.amountCents,
        currency: 'EUR',
        netCents: adoption.amountCents,
        vatRateBp: 0,
        vatCents: 0,
        status: PaymentStatus.failed,
        failureCode: code,
        failureMessage: message ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: adoption.donorId,
        action: 'payment.dunning.attempt_failed',
        resource: `Adoption/${adoption.id}`,
        after: { orderId: newOrderId, provider: last.provider, code, message: message ?? null },
      },
    });
  });
}
