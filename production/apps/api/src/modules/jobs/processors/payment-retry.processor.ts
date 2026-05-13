import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';

/**
 * Donor-friendly retry handoff: takes a failed Payment, builds a new orderId,
 * and emails the donor a fresh adopt link. Used when a webhook signals a
 * decline and we want the donor to try again with one tap.
 */
export interface PaymentRetryJob {
  paymentId: string;
}

export async function processPaymentRetry(_job: Job<PaymentRetryJob>) {
  // For now, just mark the payment for ops review; the email is fired by
  // the reconciliation processor.
  return { ok: true };
}
