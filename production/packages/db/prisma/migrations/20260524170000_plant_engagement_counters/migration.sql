-- Per-plant engagement counters — denormalized from event/relation tables
-- for cheap rendering on the plant detail page. Source of truth stays in
-- SavedPlant + AskAnswer; counters are bumped transactionally on insert
-- and backfilled here so existing data is correct on first run.
--
-- See docs/handover-files/stats-roadmap.md (Pattern B — denormalized
-- counters) for the rationale. `lastAdoptedAt` is intentionally NOT
-- denormalized — the plant detail controller computes it on-demand
-- via a cheap indexed max() over Adoption.

ALTER TABLE "Plant"
  ADD COLUMN "saveCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "askCount"  INTEGER NOT NULL DEFAULT 0;

-- ── saveCount backfill ──────────────────────────────────────────────
-- Count SavedPlant rows per plantId. Empty result set for plants with
-- zero saves naturally falls back to the DEFAULT 0.

UPDATE "Plant" p
SET "saveCount" = sub.cnt
FROM (
  SELECT "plantId", COUNT(*)::int AS cnt
  FROM "SavedPlant"
  GROUP BY "plantId"
) sub
WHERE p.id = sub."plantId";

-- ── askCount backfill ───────────────────────────────────────────────
-- For each historical AskAnswer, unnest retrievedChunkIds, join to
-- RagChunk to get plantId, then count distinct (answer, plant) pairs
-- per plant. A single AskAnswer that pulled 3 chunks from the same
-- plant counts as ONE ask for that plant — we're measuring "how many
-- times has this plant come up in answers", not "how many chunks".

UPDATE "Plant" p
SET "askCount" = sub.cnt
FROM (
  SELECT rc."plantId", COUNT(DISTINCT aa.id)::int AS cnt
  FROM "AskAnswer" aa
  JOIN LATERAL unnest(aa."retrievedChunkIds") AS chunk_id ON true
  JOIN "RagChunk" rc ON rc.id = chunk_id::uuid
  WHERE rc."plantId" IS NOT NULL
  GROUP BY rc."plantId"
) sub
WHERE p.id = sub."plantId";
