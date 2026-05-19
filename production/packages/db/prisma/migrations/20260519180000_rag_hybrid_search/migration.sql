-- BloomOulu — hybrid retrieval (BM25 + pg_trgm + pgvector + RRF).
--
-- Research (2025): pure dense-vector retrieval caps around 62% precision
-- on RAG benchmarks; adding tsvector full-text + pg_trgm fuzzy and fusing
-- the three ranked lists via Reciprocal Rank Fusion lifts precision to
-- 84%+ at near-zero added latency. References:
--   https://www.tigerdata.com/blog/elasticsearchs-hybrid-search-now-in-postgres-bm25-vector-rrf
--   https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual
--
-- This migration adds two retrieval signals to RagChunk:
--   (a) tsvector full-text  → exact-token recall (e.g. "Dionaea")
--   (b) pg_trgm trigram     → fuzzy / typo-tolerant fallback
-- The dense vector column was already added in 20260519170000.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated tsvector — Postgres keeps it in sync automatically. We use
-- 'simple' config so we don't drop tokens that aren't English (Latin
-- binomials, family codes, Finnish/Swedish words). Tradeoff: no stemming,
-- but that's fine for short factual chunks.
ALTER TABLE "RagChunk"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED;

CREATE INDEX IF NOT EXISTS "RagChunk_searchVector_gin"
  ON "RagChunk" USING GIN ("searchVector");

-- Trigram index lets us fuzzy-match misspellings + partial words. The
-- ORDER BY text <-> $query operator returns chunks similar to the query
-- as a backup when both vector and tsvector miss.
CREATE INDEX IF NOT EXISTS "RagChunk_text_trgm"
  ON "RagChunk" USING GIN (text gin_trgm_ops);
