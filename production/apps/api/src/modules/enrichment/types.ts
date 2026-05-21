/**
 * Shared types for the per-plant enrichment module.
 *
 * `enrichPlant()` (see enrich-plant.ts) fetches open-data content for one
 * plant — story, native range, conservation status, photo — and writes it
 * to the database. These types describe its inputs, the per-source
 * payloads, and the run summary surfaced to the curator via a JobRun row.
 */

/** A field the enricher can populate. */
export type EnrichField = 'story' | 'origin' | 'status' | 'image';

export const ALL_FIELDS: readonly EnrichField[] = ['story', 'origin', 'status', 'image'];

/** Finnish Red List 2019 category — mirrors the Prisma RedListStatus enum. */
export type RedListCode = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EX' | 'DD' | 'NA';

export interface EnrichOptions {
  /** Which fields to enrich. Defaults to all four. */
  fields?: EnrichField[];
  /**
   * Overwrite fields that already hold real (curator or prior-run) content.
   * Default false — fill-empty, so curator edits are never clobbered.
   */
  overwrite?: boolean;
}

/** Provenance recorded for an enriched field (provider, licence, link). */
export interface SourceRef {
  provider: string;
  license?: string;
  url?: string;
}

/** The localised story payload written to Plant.story. */
export interface StoryPayload {
  en: string;
  fi: string;
  sv: string;
  source: SourceRef & {
    fetchedAt: string;
    urls?: Partial<Record<'en' | 'fi' | 'sv', string>>;
  };
}

/** A resolved, licence-checked source image — not yet hosted by us. */
export interface ResolvedImage {
  /** Direct URL of the source image on Wikimedia Commons / iNaturalist. */
  url: string;
  licenseSpdx: string;
  attribution: string;
  width?: number;
  height?: number;
  source: SourceRef;
}

/** Outcome of an enrichment run for one plant — stored in the JobRun payload. */
export interface EnrichResult {
  plantId: string;
  latinName: string;
  /** Fields successfully fetched and written. */
  filled: EnrichField[];
  /** Fields left untouched (already had content, or not requested). */
  skipped: { field: EnrichField; reason: string }[];
  /** Fields requested but no usable open data was found. */
  failed: { field: EnrichField; reason: string }[];
  /** Provenance for each filled field. */
  sources: Partial<Record<EnrichField, SourceRef>>;
}
