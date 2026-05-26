/**
 * BloomOulu background worker.
 *
 *   docker compose run --rm api-worker
 *
 * Hosts every BullMQ queue's Worker process. Same image as the API; we just
 * boot a different entry point. Queues are documented in queues.ts.
 *
 * Failure handling:
 *   - Every worker has `attempts: 5` + exponential backoff.
 *   - On final failure, the job moves to the dead-letter queue.
 *   - DLQ is visible in the admin panel; admins can replay.
 */
import './telemetry.js';
import { Worker, type Job, type ConnectionOptions, QueueEvents } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { Logger } from '@nestjs/common';
import {
  QUEUE_RECEIPT,
  QUEUE_EMAIL,
  QUEUE_RECONCILIATION,
  QUEUE_RAG_INGEST,
  QUEUE_GDPR_EXPORT,
  QUEUE_GDPR_ERASE,
  QUEUE_KIOSK_WATCHDOG,
  QUEUE_PAYMENT_RETRY,
  QUEUE_RENEWAL,
  QUEUE_AGREEMENT_FIRST_CHARGE,
  QUEUE_DISBURSEMENT_MONTHLY,
  QUEUE_TAX_CERT_ANNUAL,
  QUEUE_RAG_EVAL,
  QUEUE_AUDIT_GAP,
  QUEUE_PLANT_ENRICH,
  QUEUE_ENRICHMENT_SWEEP,
} from './modules/jobs/queues.js';
import { registerCronJobs } from './modules/jobs/cron.js';
import { processReceipt } from './modules/jobs/processors/receipt.processor.js';
import { processEmail } from './modules/jobs/processors/email.processor.js';
import { processReconciliation } from './modules/jobs/processors/reconciliation.processor.js';
import { processRagIngest } from './modules/jobs/processors/rag-ingest.processor.js';
import { processGdprExport } from './modules/jobs/processors/gdpr-export.processor.js';
import { processGdprErase } from './modules/jobs/processors/gdpr-erase.processor.js';
import { processKioskWatchdog } from './modules/jobs/processors/kiosk-watchdog.processor.js';
import { makeProcessPaymentRetry } from './modules/jobs/processors/payment-retry.processor.js';
import { makeProcessRenewal } from './modules/jobs/processors/renewal.processor.js';
import { processDisbursementMonthly } from './modules/jobs/processors/disbursement-monthly.processor.js';
import {
  BankTransferGateway,
  MobilePayGateway,
  PaytrailGateway,
  type PaymentGateway,
  type ProviderId,
} from '@bloomoulu/payments';
import { getWebUrl } from '@bloomoulu/constants';
import { processTaxCertAnnual } from './modules/jobs/processors/tax-cert-annual.processor.js';
import { processRagEval } from './modules/jobs/processors/rag-eval.processor.js';
import { processAuditGap } from './modules/jobs/processors/audit-gap.processor.js';
import { makePlantEnrichProcessor } from './modules/jobs/processors/plant-enrich.processor.js';
import { makeEnrichmentSweepProcessor } from './modules/jobs/processors/enrichment-sweep.processor.js';
import { buildSettingsDefaults } from './modules/settings/settings.service.js';

const logger = new Logger('Worker');
const connection: ConnectionOptions = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

interface QueueDef {
  name: string;
  concurrency: number;
  handler: (job: Job) => Promise<unknown>;
}

// Stateless gateway resolver shared by the dunning + renewal processors.
// Mirrors PaymentGatewayFactory.for in the api process; instantiating
// adapters per call is cheap (they're stateless) and keeps env changes
// reflected on the next job without a process restart.
const gatewayFor = (provider: ProviderId): PaymentGateway => {
  switch (provider) {
    case 'bank_transfer': {
      const s = buildSettingsDefaults();
      return new BankTransferGateway({
        ...s.bankTransfer,
        webhookSecret: process.env.BANK_TRANSFER_WEBHOOK_SECRET,
      });
    }
    case 'paytrail': {
      const merchantId = process.env.PAYTRAIL_MERCHANT_ID;
      const secret = process.env.PAYTRAIL_SECRET;
      if (!merchantId || !secret) {
        throw new Error('Paytrail not configured (PAYTRAIL_MERCHANT_ID / PAYTRAIL_SECRET unset)');
      }
      return new PaytrailGateway({
        merchantId,
        secret,
        apiBaseUrl: process.env.PAYTRAIL_API_URL,
        webhookSecret: process.env.PAYTRAIL_WEBHOOK_SECRET,
        mockMode: process.env.PAYTRAIL_MOCK === 'true',
        webBaseUrl: getWebUrl(),
        refundCallbackUrl: process.env.PAYTRAIL_CALLBACK_URL,
      });
    }
    case 'mobilepay':
      return new MobilePayGateway({
        clientId: process.env.MOBILEPAY_CLIENT_ID ?? '',
        clientSecret: process.env.MOBILEPAY_CLIENT_SECRET ?? '',
        subscriptionKey: process.env.MOBILEPAY_SUBSCRIPTION_KEY ?? '',
        merchantSerialNumber: process.env.MOBILEPAY_MERCHANT_SERIAL_NUMBER ?? '',
        webhookSecret: process.env.MOBILEPAY_WEBHOOK_SECRET ?? '',
        apiBaseUrl: process.env.MOBILEPAY_API_URL,
        returnUrl: process.env.MOBILEPAY_RETURN_URL ?? '',
        callbackPrefix: process.env.MOBILEPAY_CALLBACK_URL ?? '',
      });
    default:
      throw new Error(`Unknown provider ${provider}`);
  }
};

const QUEUES: ReadonlyArray<QueueDef> = [
  { name: QUEUE_RECEIPT,        concurrency: 4,  handler: processReceipt },
  { name: QUEUE_EMAIL,          concurrency: 8,  handler: processEmail },
  { name: QUEUE_RECONCILIATION, concurrency: 1,  handler: processReconciliation },
  { name: QUEUE_RAG_INGEST,     concurrency: 2,  handler: processRagIngest },
  { name: QUEUE_GDPR_EXPORT,    concurrency: 2,  handler: processGdprExport },
  { name: QUEUE_GDPR_ERASE,     concurrency: 1,  handler: processGdprErase },
  { name: QUEUE_KIOSK_WATCHDOG, concurrency: 1,  handler: processKioskWatchdog },
  { name: QUEUE_PAYMENT_RETRY,  concurrency: 4,  handler: makeProcessPaymentRetry({ gatewayFor }) },
  { name: QUEUE_RENEWAL,        concurrency: 2,  handler: makeProcessRenewal({ gatewayFor }) },
  // Single-adoption first-charge after a Paytrail agreement activation.
  // Reuses the renewal processor — passing {adoptionId} narrows to one row.
  { name: QUEUE_AGREEMENT_FIRST_CHARGE, concurrency: 4, handler: makeProcessRenewal({ gatewayFor }) },
  { name: QUEUE_DISBURSEMENT_MONTHLY, concurrency: 1, handler: processDisbursementMonthly },
  { name: QUEUE_TAX_CERT_ANNUAL, concurrency: 1, handler: processTaxCertAnnual },
  { name: QUEUE_RAG_EVAL,       concurrency: 1,  handler: processRagEval },
  { name: QUEUE_AUDIT_GAP,      concurrency: 1,  handler: processAuditGap },
  // Static settings snapshot is fine for the worker — admin edits roll
  // through Redis pub/sub but the worker stays alive across builds anyway;
  // the new value lands on the next process restart.
  {
    name: QUEUE_PLANT_ENRICH,
    concurrency: 2,
    handler: makePlantEnrichProcessor({ get: () => buildSettingsDefaults() }),
  },
  {
    name: QUEUE_ENRICHMENT_SWEEP,
    concurrency: 1,
    handler: makeEnrichmentSweepProcessor({ get: () => buildSettingsDefaults() }),
  },
];

const workers: Worker[] = [];
const events: QueueEvents[] = [];

for (const def of QUEUES) {
  const w = new Worker(def.name, async (job) => {
    const t0 = Date.now();
    logger.log(`[${def.name}] start ${job.name} #${job.id}`);
    try {
      const out = await def.handler(job);
      logger.log(`[${def.name}] done ${job.name} #${job.id} in ${Date.now() - t0}ms`);
      return out;
    } catch (err) {
      logger.error(`[${def.name}] fail ${job.name} #${job.id}: ${(err as Error).message}`);
      throw err;
    }
  }, { connection, concurrency: def.concurrency });

  workers.push(w);

  const ev = new QueueEvents(def.name, { connection });
  ev.on('failed', async ({ jobId, failedReason }) => {
    logger.warn(`[${def.name}] job ${jobId} failed: ${failedReason}`);
    try {
      await prisma.jobRun.create({
        data: {
          queueName: def.name,
          jobName: jobId ?? 'unknown',
          payload: {} as any,
          status: 'failed',
          errorMessage: failedReason ?? null,
        },
      });
    } catch { /* observability is best-effort */ }
  });
  events.push(ev);
}

// Graceful shutdown so SIGTERM from Docker doesn't kill mid-job work.
const shutdown = async () => {
  logger.log('Shutting down workers…');
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(events.map((e) => e.close()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

registerCronJobs()
  .then(() => logger.log('Cron schedule registered'))
  .catch((e) => logger.error('Cron register failed', e));

logger.log(`Worker up. Queues: ${QUEUES.map((q) => q.name).join(', ')}`);
