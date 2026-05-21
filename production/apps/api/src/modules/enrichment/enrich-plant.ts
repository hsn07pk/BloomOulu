/**
 * enrichPlant() — the on-demand per-plant enrichment entry point.
 *
 * Fetches open-data content for one plant — story, native range,
 * conservation status, photo — and writes it to the database. Used by the
 * plant-enrich background job (triggered from the admin panel's "Enrich"
 * action) and runnable directly from a script.
 *
 * Fill-empty by default: a field a curator (or an earlier run) already
 * populated is left untouched unless `overwrite` is set. The image step
 * hosts a copy of the photo in our own object store so the site never
 * hotlinks Wikimedia / iNaturalist.
 *
 * One plant costs ~6-15 upstream requests, so — unlike the bulk scripts —
 * this is naturally rate-limit-safe.
 */
import { prisma } from '@bloomoulu/db';
import { hostPlantImage } from './image-store.js';
import { fetchImage } from './sources/image.js';
import { fetchOrigin } from './sources/origin.js';
import { fetchRedListStatus } from './sources/redlist.js';
import { fetchStory } from './sources/story.js';
import { ALL_FIELDS } from './types.js';
import type { EnrichOptions, EnrichResult, SourceRef } from './types.js';

const STORY_PLACEHOLDERS = ['curator to write', 'imported from the garden', 'pending'];
const ORIGIN_PLACEHOLDERS = ['pending', 'occurrence data'];

/** True if the plant has no usable story (empty or a known placeholder). */
function needsStory(story: unknown): boolean {
  if (!story || typeof story !== 'object') return true;
  const en = (story as Record<string, unknown>).en;
  const text = typeof en === 'string' ? en.trim() : '';
  if (!text) return true;
  return STORY_PLACEHOLDERS.some((m) => text.toLowerCase().includes(m));
}

/** True if the plant's origin is still a placeholder. */
function needsOrigin(origin: unknown): boolean {
  const text = typeof origin === 'string' ? origin.trim() : '';
  if (!text) return true;
  return ORIGIN_PLACEHOLDERS.some((m) => text.toLowerCase().includes(m));
}

interface PlantRow {
  id: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  primaryImageId: string | null;
  taxon: { latinName: string };
}

/**
 * Resolve, host, and attach a primary photo for the plant. Returns the
 * source provenance, or null when no openly-licensed photo was found.
 */
async function enrichImage(plant: PlantRow, overwrite: boolean): Promise<SourceRef | null> {
  const resolved = await fetchImage(plant.taxon.latinName);
  if (!resolved) return null;

  // Create the row first so the storage key can use its id; `url` holds the
  // source URL only briefly, then is replaced with our hosted copy.
  const image = await prisma.plantImage.create({
    data: {
      plantId: plant.id,
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

  const hostedUrl = await hostPlantImage(resolved.url, image.id);
  if (!hostedUrl) {
    await prisma.plantImage.delete({ where: { id: image.id } }).catch(() => {});
    return null;
  }
  await prisma.plantImage.update({ where: { id: image.id }, data: { url: hostedUrl } });

  const previousPrimaryId = plant.primaryImageId;
  await prisma.plant.update({ where: { id: plant.id }, data: { primaryImageId: image.id } });
  // On overwrite, drop the photo we replaced so it doesn't dangle.
  if (overwrite && previousPrimaryId) {
    await prisma.plantImage.delete({ where: { id: previousPrimaryId } }).catch(() => {});
  }
  return resolved.source;
}

/** Enrich one plant from open-data sources. See the module header. */
export async function enrichPlant(
  plantId: string,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const fields = opts.fields ?? [...ALL_FIELDS];
  const overwrite = opts.overwrite ?? false;

  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: {
      id: true,
      story: true,
      origin: true,
      primaryImageId: true,
      nameEn: true,
      nameFi: true,
      nameSv: true,
      taxon: { select: { latinName: true } },
    },
  });
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
  // Scalar fields are batched into a single Plant.update.
  const plantData: { story?: any; origin?: string; redListStatus?: any; redListYear?: number } = {};

  // ── Story ───────────────────────────────────────────────────────────
  if (fields.includes('story')) {
    if (!overwrite && !needsStory(plant.story)) {
      result.skipped.push({ field: 'story', reason: 'already has a story' });
    } else {
      try {
        const story = await fetchStory(latin);
        if (story) {
          plantData.story = story;
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
          plantData.origin = o.origin;
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
  // redListStatus is a required enum — there is no "empty" state — so a
  // fill-empty run never touches it; refreshing it needs `overwrite`.
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
          plantData.redListStatus = s.status;
          plantData.redListYear = 2019;
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

  // One write for all scalar fields.
  if (Object.keys(plantData).length > 0) {
    await prisma.plant.update({ where: { id: plantId }, data: plantData as any });
  }

  // ── Image ───────────────────────────────────────────────────────────
  if (fields.includes('image')) {
    if (!overwrite && plant.primaryImageId) {
      result.skipped.push({ field: 'image', reason: 'already has a primary image' });
    } else {
      try {
        const src = await enrichImage(plant, overwrite);
        if (src) {
          result.filled.push('image');
          result.sources.image = src;
        } else {
          result.failed.push({ field: 'image', reason: 'no openly-licensed photo found' });
        }
      } catch (err) {
        result.failed.push({
          field: 'image',
          reason: (err as Error)?.message ?? 'image enrichment failed',
        });
      }
    }
  }

  return result;
}
