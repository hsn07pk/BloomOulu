/**
 * Single source of truth for queue names + default job opts.
 *
 * All queues use exponential backoff, 5 attempts before DLQ. Removing
 * completed jobs after 1 day keeps Redis tidy; failed jobs stay 30 days so
 * admins can review + replay from the admin panel.
 */
import type { JobsOptions } from 'bullmq';

export const QUEUE_RECEIPT = 'receipt';
export const QUEUE_EMAIL = 'email';
export const QUEUE_RECONCILIATION = 'reconciliation';
export const QUEUE_RAG_INGEST = 'rag-ingest';
export const QUEUE_GDPR_EXPORT = 'gdpr-export';
export const QUEUE_GDPR_ERASE = 'gdpr-erase';
export const QUEUE_KIOSK_WATCHDOG = 'kiosk-watchdog';
export const QUEUE_PAYMENT_RETRY = 'payment-retry';
export const QUEUE_RENEWAL = 'renewal';

export const defaultJobOpts: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: { age: 30 * 86_400 },
};
