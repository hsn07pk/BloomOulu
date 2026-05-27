/**
 * Cron schedule for repeating jobs. The Worker process registers these on
 * boot using BullMQ's JobScheduler. All times are UTC.
 *
 *   reconciliation       → daily 03:00
 *   renewal sweep        → daily 04:00
 *   kiosk-watchdog       → every 5 min
 *   rag-ingest (full)    → weekly Sunday 02:00
 *   tax-cert-annual      → annually Jan 5 04:00 (sweeps prior tax year)
 *   rag-eval             → monthly 1st of month 04:30 (ADR-0005 — curator labels bottom-50)
 *   audit-gap            → daily 03:30 (ADR-0008 — detects audit log gaps day-over-day)
 *   backup (Postgres)    → daily 02:30 (kicked off by host cron, not BullMQ)
 */
import { Queue } from 'bullmq';
import {
  QUEUE_RECONCILIATION,
  QUEUE_RENEWAL,
  QUEUE_KIOSK_WATCHDOG,
  QUEUE_RAG_INGEST,
  QUEUE_TAX_CERT_ANNUAL,
  QUEUE_RAG_EVAL,
  QUEUE_AUDIT_GAP,
  QUEUE_ENRICHMENT_SWEEP,
  QUEUE_DISBURSEMENT_MONTHLY,
  QUEUE_RECURRING_BENEFITS,
  QUEUE_CSR_QUARTERLY,
  defaultJobOpts,
} from './queues.js';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

export async function registerCronJobs() {
  const recon = new Queue(QUEUE_RECONCILIATION, { connection });
  await recon.upsertJobScheduler('daily-3am', { pattern: '0 3 * * *' }, {
    name: 'daily',
    data: { windowHours: 24 * 30 },
    opts: defaultJobOpts,
  });

  const renew = new Queue(QUEUE_RENEWAL, { connection });
  await renew.upsertJobScheduler('daily-4am', { pattern: '0 4 * * *' }, {
    name: 'daily',
    data: {},
    opts: defaultJobOpts,
  });

  const kiosk = new Queue(QUEUE_KIOSK_WATCHDOG, { connection });
  await kiosk.upsertJobScheduler('every-5m', { pattern: '*/5 * * * *' }, {
    name: 'tick',
    data: {},
    opts: defaultJobOpts,
  });

  const rag = new Queue(QUEUE_RAG_INGEST, { connection });
  await rag.upsertJobScheduler('weekly-sun-2am', { pattern: '0 2 * * 0' }, {
    name: 'full',
    data: {},
    opts: defaultJobOpts,
  });

  // Jan 5 04:00 UTC — fires once per calendar year. Sweeps the prior tax
  // year. Idempotent (TaxCertificate has UNIQUE (donorId, taxYear)).
  const taxCert = new Queue(QUEUE_TAX_CERT_ANNUAL, { connection });
  await taxCert.upsertJobScheduler('annual-jan-5', { pattern: '0 4 5 1 *' }, {
    name: 'sweep',
    data: {},
    opts: defaultJobOpts,
  });

  // ADR-0005 monthly RAG evaluation — picks the prior month's bottom-50
  // answers by helpfulness score for curator labelling. Output lands in a
  // JobRun row so the admin panel surfaces it.
  const ragEval = new Queue(QUEUE_RAG_EVAL, { connection });
  await ragEval.upsertJobScheduler('monthly-1st-0430', { pattern: '30 4 1 * *' }, {
    name: 'monthly',
    data: { sampleSize: 50 },
    opts: defaultJobOpts,
  });

  // 24/7 plant enrichment sweep — every 15 min checks EnrichmentSchedule
  // for plants due for refresh, enqueues a small batch to plant-enrich.
  // Cadence + batch size are admin-configurable via SystemSetting.
  // enrichment.cronPattern / enrichment.batchSize.
  const enrichSweep = new Queue(QUEUE_ENRICHMENT_SWEEP, { connection });
  await enrichSweep.upsertJobScheduler('every-15m', { pattern: '*/15 * * * *' }, {
    name: 'sweep',
    data: {},
    opts: defaultJobOpts,
  });

  // ADR-0008 daily audit-gap detector — compares yesterday's AuditLog row
  // count to the 30-day median; alerts P0 if < 30 %.
  const auditGap = new Queue(QUEUE_AUDIT_GAP, { connection });
  await auditGap.upsertJobScheduler('daily-0330', { pattern: '30 3 * * *' }, {
    name: 'daily',
    data: {},
    opts: defaultJobOpts,
  });

  // Disbursement draft generator — defaults to monthly 1st 05:00 UTC, but
  // the pattern is overridable via DISBURSEMENT_CRON_PATTERN (any valid
  // cron expression). Examples:
  //   '0 5 1 * *'    — monthly, 1st of the month (default)
  //   '0 5 * * 1'    — weekly, every Monday
  //   '0 5 * * *'    — daily
  //   '0 5 1,15 * *' — twice monthly, 1st + 15th
  // Setting DISBURSEMENT_CRON_DISABLED=true skips registration entirely
  // (useful when finance prefers to drive drafts only via the admin
  // "Generate" buttons). The schedulerId is kept stable so re-registering
  // with a new pattern replaces the old one cleanly.
  const disb = new Queue(QUEUE_DISBURSEMENT_MONTHLY, { connection });
  if (process.env.DISBURSEMENT_CRON_DISABLED !== 'true') {
    const pattern = (process.env.DISBURSEMENT_CRON_PATTERN ?? '0 5 1 * *').trim();
    await disb.upsertJobScheduler('disbursement-cron', { pattern }, {
      name: 'scheduled',
      data: {},
      opts: defaultJobOpts,
    });
  }

  // Daily 06:00 UTC — sweep AdoptionBenefit rows where category=recurring
  // and nextDueAt <= now. Sends the per-benefitKey email + bumps cadence.
  const recurring = new Queue(QUEUE_RECURRING_BENEFITS, { connection });
  await recurring.upsertJobScheduler('daily-0600', { pattern: '0 6 * * *' }, {
    name: 'sweep',
    data: {},
    opts: defaultJobOpts,
  });

  // 1st of each month, 07:00 UTC — fire the CSR quarterly impact report
  // sweep. Processor itself decides which Corporate adoptions are due
  // (every 3 months from startedAt).
  const csr = new Queue(QUEUE_CSR_QUARTERLY, { connection });
  await csr.upsertJobScheduler('monthly-1st-0700', { pattern: '0 7 1 * *' }, {
    name: 'sweep',
    data: {},
    opts: defaultJobOpts,
  });
}
