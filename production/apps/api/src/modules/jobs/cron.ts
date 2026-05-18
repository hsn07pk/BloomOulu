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

  // ADR-0008 daily audit-gap detector — compares yesterday's AuditLog row
  // count to the 30-day median; alerts P0 if < 30 %.
  const auditGap = new Queue(QUEUE_AUDIT_GAP, { connection });
  await auditGap.upsertJobScheduler('daily-0330', { pattern: '30 3 * * *' }, {
    name: 'daily',
    data: {},
    opts: defaultJobOpts,
  });
}
