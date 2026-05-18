-- Composite GIN indexes below mix scalar columns (`status`) with
-- gin-indexable trigram ops on text. That requires btree_gin — install
-- it idempotently here so the migration is portable to fresh shadow DBs
-- as well as the main DB (which also installs it via infra/postgres/init.sql).
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- DropIndex
DROP INDEX "Adoption_donorId_idx";

-- DropIndex
DROP INDEX "Adoption_plantId_idx";

-- DropIndex
DROP INDEX "Adoption_status_idx";

-- DropIndex
DROP INDEX "Payment_donorId_idx";

-- DropIndex
DROP INDEX "Payment_status_idx";

-- DropIndex
DROP INDEX "Plant_bloomSeason_idx";

-- DropIndex
DROP INDEX "Plant_redListStatus_idx";

-- DropIndex
DROP INDEX "Plant_slug_idx";

-- DropIndex
DROP INDEX "Plant_status_idx";

-- CreateIndex
CREATE INDEX "Adoption_donorId_status_createdAt_idx" ON "Adoption"("donorId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Adoption_plantId_status_idx" ON "Adoption"("plantId", "status");

-- CreateIndex
CREATE INDEX "Adoption_status_recurring_endsAt_idx" ON "Adoption"("status", "recurring", "endsAt");

-- CreateIndex
CREATE INDEX "Adoption_status_showOnDonorWall_startedAt_idx" ON "Adoption"("status", "showOnDonorWall", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Payment_donorId_status_receivedAt_idx" ON "Payment"("donorId", "status", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "Payment_status_receivedAt_idx" ON "Payment"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Plant_status_redListStatus_bloomSeason_idx" ON "Plant"("status", "redListStatus", "bloomSeason");

-- CreateIndex
CREATE INDEX "Plant_status_adopterCount_nameEn_idx" ON "Plant"("status", "adopterCount" DESC, "nameEn");

-- CreateIndex
CREATE INDEX "Plant_status_createdAt_idx" ON "Plant"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Plant_taxonId_idx" ON "Plant"("taxonId");


-- ─── Search + vector indexes Prisma can't model directly ─────────────────
-- These get added by raw SQL so the schema.prisma stays declarative.
-- See docs/architecture/scale-plan.md for the rationale.

-- 1. Trigram fuzzy-search on each localised plant name.
--    Combined with btree_gin so the index also indexes `status` and
--    queries like `WHERE status = 'active' AND name ILIKE '%pula%'` use
--    a single index scan.
CREATE INDEX IF NOT EXISTS "Plant_nameEn_trgm_idx"
  ON "Plant" USING gin ("status", "nameEn" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Plant_nameFi_trgm_idx"
  ON "Plant" USING gin ("status", "nameFi" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Plant_nameSv_trgm_idx"
  ON "Plant" USING gin ("status", "nameSv" gin_trgm_ops);

-- 2. Trigram on Latin name (via Taxon join would be heavy; denormalise
--    the latinName onto Plant in a future migration if this becomes a
--    bottleneck — for now the join is fine).
CREATE INDEX IF NOT EXISTS "Taxon_latinName_trgm_idx"
  ON "Taxon" USING gin ("latinName" gin_trgm_ops);

-- 3. Generated `searchText` tsvector for full-text rank on Plant.
--    We unaccent so "kasvi" matches "kasvï" etc. Stored as a generated
--    column so writes are O(1) at insert/update time.
ALTER TABLE "Plant"
  ADD COLUMN IF NOT EXISTS "searchText" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("nameEn", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("nameFi", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("nameSv", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("origin",  '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("habitat", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "Plant_searchText_idx"
  ON "Plant" USING gin ("searchText");

-- 4. pgvector HNSW index on RagChunk.embedding.
--    Replace the default flat index Prisma created with HNSW tuned for the
--    millions-of-chunks target. m=16 + ef_construction=64 are pgvector
--    defaults; bump m=32 if recall@5 drops on the quarterly RAG eval.
DROP INDEX IF EXISTS "RagChunk_embedding_idx";
CREATE INDEX IF NOT EXISTS "RagChunk_embedding_hnsw_idx"
  ON "RagChunk" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 5. Per-locale partial index on RagChunk so the `WHERE locale IN ($1, 'en')`
--    branch in AskService.retrieve is fast even at millions of chunks.
CREATE INDEX IF NOT EXISTS "RagChunk_locale_documentId_idx"
  ON "RagChunk" ("locale", "documentId");
