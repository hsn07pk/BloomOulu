-- Postgres init script. Runs once on first container boot.
--
-- Creates: extensions, server-level tuning for the planned scale
-- (millions of plants, thousands of adopters), and the second DB for
-- GlitchTip error tracking.

\connect bloomoulu;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "vector";
-- btree_gin gives us composite indexes that mix scalar columns with
-- gin-indexable types (used by the plant-search index that combines
-- `status = 'active'` with a trigram match on the localised names).
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Server-level tuning. These ALTER SYSTEM settings persist; the container
-- restart at the end of the entrypoint reloads them.
--
-- Reference target hardware (production VPS): 4 vCPU / 8–16 GB / NVMe SSD.
-- If you scale up to a 32-GB box, double work_mem + maintenance_work_mem.
ALTER SYSTEM SET shared_buffers          = '2GB';      -- 25% of 8GB
ALTER SYSTEM SET effective_cache_size    = '6GB';      -- 75% of 8GB
ALTER SYSTEM SET work_mem                = '32MB';     -- per sort/hash op
ALTER SYSTEM SET maintenance_work_mem    = '512MB';    -- VACUUM, CREATE INDEX
ALTER SYSTEM SET max_connections         = '200';      -- API pool + workers
ALTER SYSTEM SET random_page_cost        = '1.1';      -- NVMe SSD
ALTER SYSTEM SET effective_io_concurrency= '200';      -- NVMe SSD
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET wal_buffers             = '16MB';
ALTER SYSTEM SET default_statistics_target = '200';    -- better plans on large tables
-- Logging: capture queries slower than 1s for the slow-query Grafana panel.
ALTER SYSTEM SET log_min_duration_statement = '1000';
-- Autovacuum: more aggressive — at scale this avoids transaction-id wraparound
-- and keeps the planner statistics fresh on the hot tables.
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = '0.05';
ALTER SYSTEM SET autovacuum_analyze_scale_factor = '0.02';

-- Per-DB pgvector default ef_search — controls recall/latency at query
-- time on HNSW indexes. ef_search=64 is a good default for ~1M chunks;
-- bump to 128 if recall@5 drops below 0.95 on the RAG eval.
ALTER DATABASE bloomoulu SET vector.hnsw.ef_search = 64;

-- Second DB for GlitchTip error tracking (kept separate from app data).
\connect postgres;
SELECT 'CREATE DATABASE glitchtip OWNER bloomoulu'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'glitchtip')\gexec
