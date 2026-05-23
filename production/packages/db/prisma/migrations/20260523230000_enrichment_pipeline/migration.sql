-- 24/7 enrichment pipeline: schedule table + suggestion table.
-- EnrichmentSchedule: per-plant cadence the worker reads to pick the next
-- batch. EnrichmentSuggestion: proposed values awaiting review (human-in-
-- the-loop) or already auto-applied (audit trail).

CREATE TYPE "EnrichmentSuggestionStatus" AS ENUM (
  'pending', 'approved', 'rejected', 'applied', 'superseded', 'auto_applied'
);

CREATE TABLE "EnrichmentSuggestion" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "plantId"         UUID         NOT NULL REFERENCES "Plant"("id") ON DELETE CASCADE,
  "field"           TEXT         NOT NULL,
  "source"          TEXT         NOT NULL,
  "sourceUrl"       TEXT,
  "confidence"      DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "proposed"        JSONB        NOT NULL,
  "currentSnapshot" JSONB,
  "status"          "EnrichmentSuggestionStatus" NOT NULL DEFAULT 'pending',
  "appliedAt"       TIMESTAMP(3),
  "reviewedAt"      TIMESTAMP(3),
  "reviewedById"    UUID         REFERENCES "User"("id") ON DELETE SET NULL,
  "reviewNote"      TEXT,
  "jobRunId"        UUID,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EnrichmentSuggestion_plantId_field_status_idx"
  ON "EnrichmentSuggestion" ("plantId", "field", "status");
CREATE INDEX "EnrichmentSuggestion_status_createdAt_idx"
  ON "EnrichmentSuggestion" ("status", "createdAt" DESC);
CREATE INDEX "EnrichmentSuggestion_jobRunId_idx"
  ON "EnrichmentSuggestion" ("jobRunId");

CREATE TABLE "EnrichmentSchedule" (
  "plantId"           UUID         PRIMARY KEY REFERENCES "Plant"("id") ON DELETE CASCADE,
  "lastRunAt"         TIMESTAMP(3),
  "lastResult"        TEXT,
  "lastError"         TEXT,
  "nextDueAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consecutiveNoData" INTEGER      NOT NULL DEFAULT 0,
  "consecutiveErrors" INTEGER      NOT NULL DEFAULT 0,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EnrichmentSchedule_nextDueAt_idx" ON "EnrichmentSchedule" ("nextDueAt");
