/**
 * Per-plant open-data enrichment — public surface.
 *
 * `enrichPlant(plantId, options)` fetches story / origin / conservation
 * status / photo for one plant and writes it to the database. The
 * plant-enrich background job and the admin "Enrich" action both go
 * through this entry point. See enrich-plant.ts for behaviour.
 */
export { enrichPlant } from './enrich-plant.js';
export {
  enrichPlantWithReview,
  applyEnrichmentValue,
  fetchEnrichmentPreview,
  type AutoApplyMode,
  type ReviewEnrichOptions,
} from './enrich-with-review.js';
export { ALL_FIELDS } from './types.js';
export type { EnrichField, EnrichOptions, EnrichResult, SourceRef } from './types.js';
