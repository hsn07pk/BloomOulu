/**
 * Lightweight enqueue helpers used by services + other processors.
 * Returns a Promise that resolves once the job is durably written to Redis.
 */
import { Queue } from 'bullmq';
import {
  QUEUE_EMAIL,
  QUEUE_RECEIPT,
  QUEUE_RAG_INGEST,
  QUEUE_GDPR_EXPORT,
  QUEUE_GDPR_ERASE,
  defaultJobOpts,
} from './queues.js';
import type { EmailJob } from './processors/email.processor.js';
import type { ReceiptJob } from './processors/receipt.processor.js';
import type { RagIngestJob } from './processors/rag-ingest.processor.js';
import type { GdprExportJob } from './processors/gdpr-export.processor.js';
import type { GdprEraseJob } from './processors/gdpr-erase.processor.js';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
const cache = new Map<string, Queue>();

function q(name: string) {
  let queue = cache.get(name);
  if (!queue) {
    queue = new Queue(name, { connection });
    cache.set(name, queue);
  }
  return queue;
}

export const enqueueEmail = (data: EmailJob) =>
  q(QUEUE_EMAIL).add('send', data, defaultJobOpts);

export const enqueueReceipt = (data: ReceiptJob) =>
  q(QUEUE_RECEIPT).add('render', data, { ...defaultJobOpts, jobId: `receipt:${data.paymentId}` });

export const enqueueRagIngest = (data: RagIngestJob) =>
  q(QUEUE_RAG_INGEST).add('ingest', data, defaultJobOpts);

export const enqueueGdprExport = (data: GdprExportJob) =>
  q(QUEUE_GDPR_EXPORT).add('export', data, defaultJobOpts);

export const enqueueGdprErase = (data: GdprEraseJob) =>
  q(QUEUE_GDPR_ERASE).add('erase', data, defaultJobOpts);
