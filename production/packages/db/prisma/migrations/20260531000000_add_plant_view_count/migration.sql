-- Per-plant page-view counter — denormalized, lightweight, no per-event
-- table. Bumped fire-and-forget from the client on every plant page
-- mount via POST /v1/plants/:slug/view. Distinct from `scanCount`,
-- which stays QR-only (rows in PlantScan carry kioskId + visitorHash).
--
-- Backfill is unnecessary: pre-existing visits weren't tracked, and the
-- counter is for forward-looking trend data, not a historical total.

ALTER TABLE "Plant"
  ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
