/**
 * plant-enrich queue processor.
 *
 * Runs on-demand per-plant enrichment — triggered by the admin panel's
 * "Enrich" action — by calling enrichPlant(), then records the outcome as
 * a JobRun row so curators can see what was filled in the admin panel's
 * Operations → Job Runs view.
 *
 * On failure the error propagates: BullMQ marks the job failed and the
 * worker's QueueEvents handler writes the failed JobRun (see worker.ts).
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { enrichPlant } from '../../enrichment/index.js';
import type { EnrichField } from '../../enrichment/index.js';

export interface PlantEnrichJob {
  plantId: string;
  /** Which fields to enrich. Omit for all four (story / origin / status / image). */
  fields?: EnrichField[];
  /** Overwrite fields that already hold content. Default false (fill-empty). */
  overwrite?: boolean;
  /** Admin user id that triggered the enrichment — kept for the audit trail. */
  requestedBy?: string;
}

export async function processPlantEnrich(job: Job<PlantEnrichJob>) {
  const { plantId, fields, overwrite, requestedBy } = job.data;
  const startedAt = new Date();

  const result = await enrichPlant(plantId, { fields, overwrite });

  await prisma.jobRun.create({
    data: {
      queueName: 'plant-enrich',
      jobName: `${result.latinName} — ${
        result.filled.length ? 'filled ' + result.filled.join(', ') : 'nothing new'
      }`,
      status: 'completed',
      payload: { ...result, requestedBy: requestedBy ?? null } as any,
      startedAt,
      finishedAt: new Date(),
      attempts: job.attemptsMade + 1,
    },
  });

  return { filled: result.filled, failed: result.failed.length };
}
