/**
 * plant-enrich queue processor.
 *
 * Runs per-plant enrichment by calling enrichPlantWithReview() — the
 * review-aware orchestrator. Records the outcome as a JobRun row so
 * curators see what was filled / queued for review, and updates the
 * EnrichmentSchedule row so the 24/7 sweep knows when to revisit.
 *
 *   • triggered by the admin "Enrich" action (manual, one plant) — runs
 *     with the admin-current autoApply settings.
 *   • triggered by the enrichment-sweep cron — same code path; the
 *     scheduler picks the next batch.
 *
 * On error: bumps consecutiveErrors on the schedule; after 5 failures the
 * plant exits the sweep until manually re-queued.
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import {
  enrichPlantWithReview,
  type AutoApplyMode,
  type EnrichField,
} from '../../enrichment/index.js';

export interface PlantEnrichJob {
  plantId: string;
  /** Which fields to enrich. Omit for all four (story / origin / status / image). */
  fields?: EnrichField[];
  /** Overwrite fields that already hold content. Default false (fill-empty). */
  overwrite?: boolean;
  /** Admin user id that triggered the enrichment — kept for the audit trail. */
  requestedBy?: string;
  /** Optional override for the auto-apply policy (defaults to settings). */
  autoApply?: Partial<AutoApplyMode>;
}

interface SettingsService {
  get(): {
    enrichment: {
      autoApply: AutoApplyMode;
      refreshDays: number;
    };
  };
}

/** Default policy used when the worker boots without a SettingsService
 *  injection (e.g. a bare `node dist/worker.js` smoke run). Mirrors the
 *  buildSettingsDefaults() entry so behaviour stays consistent. */
const DEFAULT_POLICY: AutoApplyMode = {
  story: false,
  origin: true,
  status: true,
  image: false,
};
const DEFAULT_REFRESH_DAYS = 30;

export function makePlantEnrichProcessor(settings?: SettingsService) {
  return async function processPlantEnrich(job: Job<PlantEnrichJob>) {
    const { plantId, fields, overwrite, requestedBy, autoApply } = job.data;
    const startedAt = new Date();
    const enrichmentSettings = settings?.get().enrichment ?? {
      autoApply: DEFAULT_POLICY,
      refreshDays: DEFAULT_REFRESH_DAYS,
    };
    const policy: AutoApplyMode = {
      ...enrichmentSettings.autoApply,
      ...(autoApply ?? {}),
    };

    try {
      const result = await enrichPlantWithReview(plantId, {
        fields,
        overwrite,
        autoApply: policy,
        jobRunId: job.id ?? null,
      });

      await prisma.jobRun.create({
        data: {
          queueName: 'plant-enrich',
          jobName: `${result.latinName} — ${
            result.filled.length
              ? 'queued/filled ' + result.filled.join(', ')
              : 'nothing new'
          }`,
          status: 'completed',
          payload: { ...result, requestedBy: requestedBy ?? null, policy } as any,
          startedAt,
          finishedAt: new Date(),
          attempts: job.attemptsMade + 1,
        },
      });

      // Update the schedule for the 24/7 sweep — push next refresh out by
      // refreshDays. If the run produced no useful data, slow down so we
      // stop hammering sources that have nothing.
      const noData = result.filled.length === 0;
      const refreshDays = enrichmentSettings.refreshDays;
      const nextDueAt = new Date(
        Date.now() + (noData ? Math.min(180, refreshDays * 2) : refreshDays) * 86_400_000,
      );
      await prisma.enrichmentSchedule.upsert({
        where: { plantId },
        create: {
          plantId,
          lastRunAt: new Date(),
          lastResult: noData ? 'no-data' : result.failed.length ? 'partial' : 'ok',
          nextDueAt,
          consecutiveNoData: noData ? 1 : 0,
          consecutiveErrors: 0,
        },
        update: {
          lastRunAt: new Date(),
          lastResult: noData ? 'no-data' : result.failed.length ? 'partial' : 'ok',
          lastError: null,
          nextDueAt,
          consecutiveNoData: noData ? { increment: 1 } : 0,
          consecutiveErrors: 0,
        },
      });

      return { filled: result.filled, failed: result.failed.length };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      await prisma.enrichmentSchedule
        .upsert({
          where: { plantId },
          create: {
            plantId,
            lastRunAt: new Date(),
            lastResult: 'error',
            lastError: message.slice(0, 1000),
            nextDueAt: new Date(Date.now() + 86_400_000),
            consecutiveErrors: 1,
          },
          update: {
            lastRunAt: new Date(),
            lastResult: 'error',
            lastError: message.slice(0, 1000),
            nextDueAt: new Date(Date.now() + 86_400_000),
            consecutiveErrors: { increment: 1 },
          },
        })
        .catch(() => {/* swallow — original error wins */});
      throw err;
    }
  };
}

// Backward-compat export: the existing worker.ts imports the bare
// processor. Keep it pointing at a factory built with no settings.
export const processPlantEnrich = makePlantEnrichProcessor();
