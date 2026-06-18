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
/// Monthly disbursement draft creation — fires on the 1st of each month
/// and bundles every settled Payment from the prior month into a fresh
/// draft Disbursement for the Garden's finance team to review.
export const QUEUE_DISBURSEMENT_MONTHLY = 'disbursement-monthly';
export const QUEUE_TAX_CERT_ANNUAL = 'tax-cert-annual';
export const QUEUE_RAG_EVAL = 'rag-eval';
export const QUEUE_AUDIT_GAP = 'audit-gap';
export const QUEUE_PLANT_ENRICH = 'plant-enrich';
/// 24/7 enrichment scheduler — cron tick scans EnrichmentSchedule for
/// `nextDueAt <= now()` and seeds the plant-enrich queue with a small batch.
export const QUEUE_ENRICHMENT_SWEEP = 'enrichment-sweep';
/// Daily GDPR retention sweep — prunes/pseudonymises data past its
/// retention window (AskMessage, AuditLog, Session, VerificationToken,
/// PlantScan, KioskEvent, ObservabilityEvent) and pseudonymises long-
/// inactive donor Users. Windows are admin/env-configurable; see
/// retention.processor.ts.
export const QUEUE_RETENTION = 'retention';
export const QUEUE_INSTAGRAM = 'instagram-sync';

export const defaultJobOpts: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: { age: 30 * 86_400 },
};
