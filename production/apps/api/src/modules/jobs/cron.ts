/**
 * Cron schedule for repeating jobs. The Worker process registers these on
 * boot using BullMQ's JobScheduler. All times are UTC.
 *
 *   reconciliation       → daily 03:00
 *   renewal sweep        → daily 04:00
 *   kiosk-watchdog       → every 5 min
 *   rag-ingest (full)    → weekly Sunday 02:00
 *   backup (Postgres)    → daily 02:30 (kicked off by host cron, not BullMQ)
 */
import { Queue } from 'bullmq';
import {
  QUEUE_RECONCILIATION,
  QUEUE_RENEWAL,
  QUEUE_KIOSK_WATCHDOG,
  QUEUE_RAG_INGEST,
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
}
