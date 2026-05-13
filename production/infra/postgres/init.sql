-- Postgres init script. Runs once on first container boot.
-- Creates: extensions, second DB for GlitchTip.

\connect bloomoulu;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Second DB for GlitchTip error tracking (kept separate from app data).
\connect postgres;
SELECT 'CREATE DATABASE glitchtip OWNER bloomoulu'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'glitchtip')\gexec
