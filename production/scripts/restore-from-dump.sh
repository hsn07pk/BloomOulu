#!/usr/bin/env bash
#
# Replace the local Docker state (Postgres + MinIO + Grafana) with the
# contents of a BloomOulu-portable bundle. Used to import a teammate's
# dump or to roll back to a known-good snapshot.
#
#   bash scripts/restore-from-dump.sh /path/to/BloomOulu-portable-XXXX-XX-XX.zip
#
# The script:
#   1. Verifies the bundle (sha256, file layout)
#   2. Tears down the dev stack (apps + cloudflared tunnels)
#   3. Brings up Postgres + MinIO + Grafana from the bloomoulu compose project
#   4. Drops + recreates the bloomoulu database, pg_restore's the dump
#   5. Wipes + repopulates the minio_data + grafana_data volumes
#   6. Boots the stack via scripts/payment-test-up.sh with NO_SEED=1
#      (we don't want the seed file's upserts overwriting the dump's
#       SystemSetting rows)
#
# Idempotent — safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
bold() { printf "\033[1m%s\033[0m\n" "$*"; }

[[ $# -eq 1 ]] || { red "Usage: $0 <path/to/BloomOulu-portable-*.zip>"; exit 1; }
ZIP="$1"
[[ -f "$ZIP" ]] || { red "$ZIP not found"; exit 1; }

# ── 1. Verify SHA256 if a sidecar is present ───────────────────────
if [[ -f "${ZIP}.sha256" ]]; then
  bold "▶ Verifying SHA256"
  ( cd "$(dirname "$ZIP")" && shasum -a 256 -c "$(basename "$ZIP").sha256" )
  green "Checksum OK"
else
  yellow "No .sha256 sidecar; skipping checksum"
fi

# ── 2. Extract to a temp dir ───────────────────────────────────────
TMP="$(mktemp -d -t bloomoulu-restore)"
trap 'rm -rf "$TMP"' EXIT
bold "▶ Extracting bundle to $TMP"
unzip -q "$ZIP" -d "$TMP"

# The zip wraps everything in a single directory named after the bundle.
SUBDIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n1)"
SNAPSHOTS="$SUBDIR/snapshots"
[[ -f "$SNAPSHOTS/bloomoulu.dump" ]] || { red "Missing bloomoulu.dump"; exit 1; }
[[ -f "$SNAPSHOTS/minio-data.tar.gz" ]] || { red "Missing minio-data.tar.gz"; exit 1; }
[[ -f "$SNAPSHOTS/grafana-data.tar.gz" ]] || { red "Missing grafana-data.tar.gz"; exit 1; }
green "Bundle contents OK"

# ── 3. Stop dev apps but keep Docker running (we need volumes) ────
bold "▶ Stopping dev apps + tunnels"
bash "$ROOT/scripts/payment-test-down.sh" >/dev/null 2>&1 || true

# Bring backing services up if they aren't already (we'll need them).
docker compose up -d postgres minio grafana >/dev/null
until docker exec bloomoulu-postgres-1 pg_isready -U bloomoulu >/dev/null 2>&1; do sleep 1; done
green "Postgres up"

# ── 4. Restore Postgres ───────────────────────────────────────────
bold "▶ Restoring database from bloomoulu.dump"
docker cp "$SNAPSHOTS/bloomoulu.dump" bloomoulu-postgres-1:/tmp/bloomoulu.dump

docker exec bloomoulu-postgres-1 psql -U bloomoulu -d postgres -q -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='bloomoulu' AND pid <> pg_backend_pid();" \
  >/dev/null
docker exec bloomoulu-postgres-1 psql -U bloomoulu -d postgres -q -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS bloomoulu;"
docker exec bloomoulu-postgres-1 psql -U bloomoulu -d postgres -q -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE bloomoulu;"
docker exec bloomoulu-postgres-1 pg_restore -U bloomoulu -d bloomoulu \
  --no-owner --no-acl --exit-on-error /tmp/bloomoulu.dump
docker exec bloomoulu-postgres-1 rm /tmp/bloomoulu.dump
green "Database restored"

# ── 5. Restore MinIO + Grafana volumes ────────────────────────────
bold "▶ Restoring MinIO + Grafana volumes"
docker compose stop minio grafana >/dev/null 2>&1 || true

docker run --rm \
  -v bloomoulu_minio_data:/data \
  -v "$SNAPSHOTS":/in:ro \
  alpine:3.20 sh -lc 'cd /data && rm -rf ./* ./.??* 2>/dev/null || true; tar -xzf /in/minio-data.tar.gz'
green "MinIO volume restored"

docker run --rm \
  -v bloomoulu_grafana_data:/data \
  -v "$SNAPSHOTS":/in:ro \
  alpine:3.20 sh -lc 'cd /data && rm -rf ./* ./.??* 2>/dev/null || true; tar -xzf /in/grafana-data.tar.gz'
green "Grafana volume restored"

docker compose start minio grafana >/dev/null 2>&1 || docker compose up -d minio grafana >/dev/null

# ── 6. Apply newer migrations (safe — migrate:deploy is idempotent) ─
bold "▶ Applying any migrations newer than the dump"
DATABASE_URL='postgresql://bloomoulu:bloomoulu@localhost:5432/bloomoulu?schema=public' \
DIRECT_URL='postgresql://bloomoulu:bloomoulu@localhost:5432/bloomoulu?schema=public' \
  pnpm db:migrate >/dev/null 2>&1 || {
    red "migrate:deploy failed — schema in the dump may be too old; check manually"
    exit 1
  }
green "Migrations current"

# ── 7. Boot dev stack (NO_SEED=1 so we don't overwrite imported data) ─
bold "▶ Booting dev stack"
NO_SEED=1 bash "$ROOT/scripts/payment-test-up.sh"
