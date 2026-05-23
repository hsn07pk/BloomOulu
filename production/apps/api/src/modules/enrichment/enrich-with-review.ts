/**
 * enrichPlantWithReview() — wraps the existing per-plant enrichPlant() with
 * a human-in-the-loop review pipeline.
 *
 * For each field (story / origin / status / image):
 *   • If admin's `enrichment.autoApply.<field>` SystemSetting is true →
 *     the value is written straight to the Plant row (current behaviour);
 *     a row is still recorded in EnrichmentSuggestion with status
 *     `auto_applied` so curators can audit / revert.
 *   • If autoApply is false → the fetched value is stored in
 *     EnrichmentSuggestion with status `pending`. The Plant row is left
 *     untouched. The admin "Enrichment review" page surfaces it.
 *
 * Pending suggestions for a (plant, field) pair are marked `superseded`
 * when a fresh run lands new data — only one "active" pending row per
 * field at a time.
 *
 * The image step is special: hosting the photo into MinIO is expensive,
 * so we run the existing `enrichPlant` for images in auto-apply mode and
 * record the row as `auto_applied`. (Reviewing the photo before downloading
 * adds little safety; the admin can replace it via the Plant resource.)
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@bloomoulu/db';
import { fetchImage } from './sources/image.js';
import { fetchOrigin } from './sources/origin.js';
import { fetchRedListStatus } from './sources/redlist.js';
import { fetchStory } from './sources/story.js';
import { hostPlantImage } from './image-store.js';
import { ALL_FIELDS } from './types.js';
import type { EnrichField, EnrichResult, SourceRef } from './types.js';

const STORY_PLACEHOLDERS = ['curator to write', 'imported from the garden', 'pending'];
const ORIGIN_PLACEHOLDERS = ['pending', 'occurrence data'];

function needsStory(story: unknown): boolean {
  if (!story || typeof story !== 'object') return true;
  const en = (story as Record<string, unknown>).en;
  const text = typeof en === 'string' ? en.trim() : '';
  if (!text) return true;
  return STORY_PLACEHOLDERS.some((m) => text.toLowerCase().includes(m));
}
function needsOrigin(origin: unknown): boolean {
  const text = typeof origin === 'string' ? origin.trim() : '';
  if (!text) return true;
  return ORIGIN_PLACEHOLDERS.some((m) => text.toLowerCase().includes(m));
}

export interface AutoApplyMode {
  story: boolean;
  origin: boolean;
  status: boolean;
  image: boolean;
}

export interface ReviewEnrichOptions {
  fields?: EnrichField[];
  overwrite?: boolean;
  /** Whether each field is auto-applied or queued for review. */
  autoApply: AutoApplyMode;
  /** Optional grouping id (e.g. BullMQ job id) for audit. */
  jobRunId?: string | null;
}

interface PlantRow {
  id: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  primaryImageId: string | null;
  story: unknown;
  origin: string | null;
  redListStatus: string;
  taxon: { latinName: string };
}

/** Supersede any pending suggestions for this (plant, field) before
 *  writing a fresh row, so the review queue never piles up duplicates. */
async function supersedePending(
  prisma: PrismaClient,
  plantId: string,
  field: EnrichField,
): Promise<void> {
  await prisma.enrichmentSuggestion.updateMany({
    where: { plantId, field, status: 'pending' },
    data: { status: 'superseded' },
  });
}

async function recordSuggestion(
  prisma: PrismaClient,
  plantId: string,
  field: EnrichField,
  proposed: unknown,
  currentSnapshot: unknown,
  source: SourceRef,
  autoApplied: boolean,
  jobRunId: string | null,
): Promise<void> {
  await supersedePending(prisma, plantId, field);
  await prisma.enrichmentSuggestion.create({
    data: {
      plantId,
      field,
      source: source.provider,
      sourceUrl: source.url ?? null,
      proposed: proposed as any,
      currentSnapshot: currentSnapshot === undefined ? null : (currentSnapshot as any),
      status: autoApplied ? 'auto_applied' : 'pending',
      appliedAt: autoApplied ? new Date() : null,
      jobRunId: jobRunId ?? null,
      confidence: 0.85,
    },
  });
}

/**
 * Apply a proposed value onto the Plant row. Returns true on success.
 * Used by both the auto-apply path here and the review-approve endpoint.
 */
export async function applyEnrichmentValue(
  prisma: PrismaClient,
  plantId: string,
  field: EnrichField,
  proposed: any,
): Promise<boolean> {
  switch (field) {
    case 'story':
      await prisma.plant.update({ where: { id: plantId }, data: { story: proposed } });
      return true;
    case 'origin':
      if (typeof proposed !== 'string') return false;
      await prisma.plant.update({ where: { id: plantId }, data: { origin: proposed } });
      return true;
    case 'status':
      await prisma.plant.update({
        where: { id: plantId },
        data: { redListStatus: proposed, redListYear: 2019 },
      });
      return true;
    case 'image':
      // The proposed payload is a ResolvedImage. Host it locally + attach.
      const resolved = proposed as {
        url: string;
        licenseSpdx: string;
        attribution: string;
        width?: number;
        height?: number;
      };
      const plant = await prisma.plant.findUnique({
        where: { id: plantId },
        select: { nameEn: true, nameFi: true, nameSv: true, primaryImageId: true },
      });
      if (!plant) return false;
      const image = await prisma.plantImage.create({
        data: {
          plantId,
          url: resolved.url,
          altEn: plant.nameEn,
          altFi: plant.nameFi,
          altSv: plant.nameSv,
          attribution: resolved.attribution,
          licenseSpdx: resolved.licenseSpdx,
          width: resolved.width ?? null,
          height: resolved.height ?? null,
        },
      });
      const hosted = await hostPlantImage(resolved.url, image.id);
      if (!hosted) {
        await prisma.plantImage.delete({ where: { id: image.id } }).catch(() => {});
        return false;
      }
      await prisma.plantImage.update({ where: { id: image.id }, data: { url: hosted } });
      const prev = plant.primaryImageId;
      await prisma.plant.update({ where: { id: plantId }, data: { primaryImageId: image.id } });
      if (prev) await prisma.plantImage.delete({ where: { id: prev } }).catch(() => {});
      return true;
  }
}

/** Run all four sources for one plant and gather results in memory. Used by
 *  both the worker (which then decides per-field apply/queue) and the
 *  "search and enrich" assistant (which renders all of them for the curator). */
export async function fetchEnrichmentPreview(
  latinName: string,
): Promise<Record<EnrichField, { value: unknown; source: SourceRef } | null>> {
  const [story, origin, status, image] = await Promise.allSettled([
    fetchStory(latinName),
    fetchOrigin(latinName),
    fetchRedListStatus(latinName),
    fetchImage(latinName),
  ]);
  return {
    story:
      story.status === 'fulfilled' && story.value
        ? { value: story.value, source: story.value.source }
        : null,
    origin:
      origin.status === 'fulfilled' && origin.value
        ? { value: origin.value.origin, source: origin.value.source }
        : null,
    status:
      status.status === 'fulfilled' && status.value
        ? { value: status.value.status, source: status.value.source }
        : null,
    image:
      image.status === 'fulfilled' && image.value
        ? { value: image.value, source: image.value.source }
        : null,
  };
}

/**
 * Per-plant enrichment with optional human review. Same shape as
 * enrichPlant(), but every fetched value either lands on Plant (auto-apply)
 * OR creates an EnrichmentSuggestion row for the admin queue.
 */
export async function enrichPlantWithReview(
  plantId: string,
  opts: ReviewEnrichOptions,
  client: PrismaClient = defaultPrisma,
): Promise<EnrichResult> {
  const fields = opts.fields ?? [...ALL_FIELDS];
  const overwrite = opts.overwrite ?? false;
  const jobRunId = opts.jobRunId ?? null;

  const plant = (await client.plant.findUnique({
    where: { id: plantId },
    select: {
      id: true,
      nameEn: true,
      nameFi: true,
      nameSv: true,
      primaryImageId: true,
      story: true,
      origin: true,
      redListStatus: true,
      taxon: { select: { latinName: true } },
    },
  })) as PlantRow | null;
  if (!plant) throw new Error(`Plant ${plantId} not found`);

  const latin = plant.taxon.latinName;
  const result: EnrichResult = {
    plantId,
    latinName: latin,
    filled: [],
    skipped: [],
    failed: [],
    sources: {},
  };

  // ── Story ───────────────────────────────────────────────────────────
  if (fields.includes('story')) {
    if (!overwrite && !needsStory(plant.story)) {
      result.skipped.push({ field: 'story', reason: 'already has a story' });
    } else {
      try {
        const story = await fetchStory(latin);
        if (story) {
          if (opts.autoApply.story) {
            await applyEnrichmentValue(client, plantId, 'story', story);
            await recordSuggestion(client, plantId, 'story', story, plant.story, story.source, true, jobRunId);
          } else {
            await recordSuggestion(client, plantId, 'story', story, plant.story, story.source, false, jobRunId);
          }
          result.filled.push('story');
          result.sources.story = story.source;
        } else {
          result.failed.push({ field: 'story', reason: 'no openly-licensed text found' });
        }
      } catch (err) {
        result.failed.push({ field: 'story', reason: (err as Error)?.message ?? 'story fetch failed' });
      }
    }
  }

  // ── Origin ──────────────────────────────────────────────────────────
  if (fields.includes('origin')) {
    if (!overwrite && !needsOrigin(plant.origin)) {
      result.skipped.push({ field: 'origin', reason: 'already has an origin' });
    } else {
      try {
        const o = await fetchOrigin(latin);
        if (o) {
          if (opts.autoApply.origin) {
            await applyEnrichmentValue(client, plantId, 'origin', o.origin);
            await recordSuggestion(client, plantId, 'origin', o.origin, plant.origin, o.source, true, jobRunId);
          } else {
            await recordSuggestion(client, plantId, 'origin', o.origin, plant.origin, o.source, false, jobRunId);
          }
          result.filled.push('origin');
          result.sources.origin = o.source;
        } else {
          result.failed.push({ field: 'origin', reason: 'no native-range data found' });
        }
      } catch (err) {
        result.failed.push({ field: 'origin', reason: (err as Error)?.message ?? 'origin fetch failed' });
      }
    }
  }

  // ── Conservation status ─────────────────────────────────────────────
  if (fields.includes('status')) {
    if (!overwrite) {
      result.skipped.push({
        field: 'status',
        reason: 'conservation status is always set — enable overwrite to refresh it',
      });
    } else {
      try {
        const s = await fetchRedListStatus(latin);
        if (s) {
          if (opts.autoApply.status) {
            await applyEnrichmentValue(client, plantId, 'status', s.status);
            await recordSuggestion(client, plantId, 'status', s.status, plant.redListStatus, s.source, true, jobRunId);
          } else {
            await recordSuggestion(client, plantId, 'status', s.status, plant.redListStatus, s.source, false, jobRunId);
          }
          result.filled.push('status');
          result.sources.status = s.source;
        } else {
          result.failed.push({ field: 'status', reason: 'not found on the Finnish Red List' });
        }
      } catch (err) {
        result.failed.push({ field: 'status', reason: (err as Error)?.message ?? 'status fetch failed' });
      }
    }
  }

  // ── Image ───────────────────────────────────────────────────────────
  if (fields.includes('image')) {
    if (!overwrite && plant.primaryImageId) {
      result.skipped.push({ field: 'image', reason: 'already has a primary image' });
    } else {
      try {
        const resolved = await fetchImage(latin);
        if (resolved) {
          if (opts.autoApply.image) {
            const ok = await applyEnrichmentValue(client, plantId, 'image', resolved);
            if (ok) {
              await recordSuggestion(client, plantId, 'image', resolved, null, resolved.source, true, jobRunId);
              result.filled.push('image');
              result.sources.image = resolved.source;
            } else {
              result.failed.push({ field: 'image', reason: 'image host failed (rate-limited?)' });
            }
          } else {
            // Image suggestion stays unhosted until the curator approves —
            // hosting happens at approval time so we don't pay for photos
            // we'll never use.
            await recordSuggestion(client, plantId, 'image', resolved, null, resolved.source, false, jobRunId);
            result.filled.push('image');
            result.sources.image = resolved.source;
          }
        } else {
          result.failed.push({ field: 'image', reason: 'no openly-licensed photo found' });
        }
      } catch (err) {
        result.failed.push({ field: 'image', reason: (err as Error)?.message ?? 'image fetch failed' });
      }
    }
  }

  return result;
}
