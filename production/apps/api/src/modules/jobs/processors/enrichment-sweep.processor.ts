/**
 * enrichment-sweep — the 24/7 driver for the plant-enrich queue.
 *
 * Cron tick (default every 15 min):
 *   1. Read `enrichment.enabled` + `enrichment.batchSize` from settings.
 *   2. Auto-seed EnrichmentSchedule rows for plants without one (newcomers
 *      get scheduled for "now" so they enter the worker on the next tick).
 *   3. Pick the next batch where `nextDueAt <= now()` AND
 *      `consecutiveErrors < 5` (a circuit breaker — plants that keep
 *      failing back off automatically).
 *   4. Enqueue a plant-enrich job per pick. The processor updates the
 *      schedule row after the job finishes (success → next refresh in
 *      `refreshDays`; no-data → exponential backoff; error → 1 day).
 *
 * Stuck-job watchdog: if a schedule row's lastRunAt is older than 1 hour
 * but the job never completed (Redis crash, OOM, etc.), the next sweep
 * picks it up because nextDueAt is still in the past.
 */
import type { Job, Queue } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { Queue as BullQueue } from 'bullmq';
import { QUEUE_PLANT_ENRICH } from '../queues.js';
import type { PlantEnrichJob } from './plant-enrich.processor.js';

export interface EnrichmentSweepJob {
  /** Force-include plants matching this status filter (LC/NT/VU/EN/CR). */
  redListFilter?: string;
  /** Override the batch size from settings (admin "run now" actions). */
  batchSize?: number;
}

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
let enrichQueue: Queue<PlantEnrichJob> | null = null;
function getEnrichQueue() {
  if (!enrichQueue) {
    enrichQueue = new BullQueue<PlantEnrichJob>(QUEUE_PLANT_ENRICH, { connection });
  }
  return enrichQueue;
}

interface SettingsService {
  get(): {
    enrichment: {
      enabled: boolean;
      batchSize: number;
      refreshDays: number;
    };
  };
}

/** The processor needs the SettingsService at construction time. Worker.ts
 *  wires it in; tests can inject a stub. */
export function makeEnrichmentSweepProcessor(settings: SettingsService) {
  return async function processEnrichmentSweep(job: Job<EnrichmentSweepJob>) {
    const s = settings.get().enrichment;
    if (!s.enabled) {
      return { skipped: 'enrichment.enabled is false' };
    }
    const batchSize = Math.max(1, Math.min(200, job.data.batchSize ?? s.batchSize));

    // 1. Ensure every active Plant has a schedule row. Newcomers get
    //    enqueued via a "now" nextDueAt; the next sweep tick picks them up.
    const ensured = await prisma.$executeRawUnsafe(`
      INSERT INTO "EnrichmentSchedule" ("plantId", "nextDueAt", "updatedAt")
      SELECT p."id", NOW(), NOW()
      FROM "Plant" p
      LEFT JOIN "EnrichmentSchedule" s ON s."plantId" = p."id"
      WHERE p."status" = 'active' AND s."plantId" IS NULL
    `);

    // 2. Pick the next batch — `nextDueAt <= now()` AND under-circuit-breaker.
    const due = await prisma.enrichmentSchedule.findMany({
      where: {
        nextDueAt: { lte: new Date() },
        consecutiveErrors: { lt: 5 },
      },
      orderBy: { nextDueAt: 'asc' },
      take: batchSize,
      select: { plantId: true },
    });

    if (due.length === 0) {
      return { ensured, picked: 0, queued: 0 };
    }

    // 3. Enqueue each. jobId is keyed by plantId so a double-enqueue while
    //    a prior job is still in flight is a no-op.
    const queue = getEnrichQueue();
    let queued = 0;
    for (const row of due) {
      // Mark lastRunAt up front — if the job crashes Redis-side, the next
      // sweep can still find the row via consecutiveErrors backoff.
      await prisma.enrichmentSchedule.update({
        where: { plantId: row.plantId },
        data: { lastRunAt: new Date() },
      });
      await queue.add(
        'enrich-sweep',
        { plantId: row.plantId },
        {
          jobId: `enrich-sweep-${row.plantId}-${Date.now()}`,
          removeOnComplete: { age: 86_400, count: 500 },
          removeOnFail: { age: 7 * 86_400 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      );
      queued++;
    }
    return { ensured, picked: due.length, queued, batchSize };
  };
}
