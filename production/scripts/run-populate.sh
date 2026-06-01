#!/bin/sh
# 24/7 robust full-collection population supervisor.
#
# Runs inside the api-worker image (so it has @prisma/client, tsx, the
# compose network to postgres+ollama, and the api_storage volume mounted at
# /data/storage). Launch detached:
#
#   docker compose ... run --rm --no-deps --name bloomoulu-populate \
#     --entrypoint sh -e IMG_DELAY_MS=700 \
#     -v .../apps/api/src:/app/apps/api/src:ro -v .../scripts:/app/scripts:ro \
#     api-worker /app/scripts/run-populate.sh
#
# Robustness: every phase is idempotent + resumable, so a crash just resumes
# on retry. Each phase retries up to MAX_ATTEMPTS with a cooldown; a phase
# that still fails is logged and the run continues (a later pass or the next
# nightly run mops up). Rate limits are handled inside each tsx script
# (compliant UA + Retry-After + exponential backoff); the cooldown here is a
# second safety net. The whole script never exits non-zero on a single
# phase failure — it's meant to run unattended to completion.
set -u

MAX_ATTEMPTS="${MAX_ATTEMPTS:-6}"
COOLDOWN="${COOLDOWN:-90}"
TSX="/app/node_modules/.bin/tsx"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')Z] $*"; }

# Make @prisma/client resolvable from /app for the mounted scripts.
ln -sfn /app/apps/api/node_modules/@prisma /app/node_modules/@prisma 2>/dev/null || true
cd /app || exit 1

log "populate-all START — IMG_DELAY_MS=${IMG_DELAY_MS:-700} EMBED_MODEL=${EMBED_MODEL:-<default>} OLLAMA_URL=${OLLAMA_URL:-<unset>}"

run_phase() {
  name="$1"; shift
  attempt=1
  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    log "PHASE ${name} (attempt ${attempt}/${MAX_ATTEMPTS}): $*"
    if "$@"; then
      log "PHASE ${name} OK"
      return 0
    fi
    rc=$?
    log "PHASE ${name} failed rc=${rc}; cooldown ${COOLDOWN}s then retry"
    sleep "$COOLDOWN"
    attempt=$((attempt + 1))
  done
  log "PHASE ${name} GAVE UP after ${MAX_ATTEMPTS} attempts — continuing"
  return 1
}

# ── Images ────────────────────────────────────────────────────────────────
# 0) Clean stale rows (dead MinIO + old-model local without sourceUrl).
run_phase reset      "$TSX" scripts/reset-images.ts
# 1) Migrate existing external rows -> sourceUrl + cached local copy.
run_phase localize   "$TSX" scripts/localize-existing.ts
# 2) Fetch a fresh primary image for every plant that still lacks one.
run_phase images     "$TSX" scripts/enrich-images.ts
# 3) Straggler passes — re-runs only touch what failed (rate-limit retries).
run_phase localize2  "$TSX" scripts/localize-existing.ts
run_phase images2    "$TSX" scripts/enrich-images.ts

# ── Other plant data ────────────────────────────────────────────────────────
# Origin (native range) — WCVP bulk checklist, fast + local parse.
run_phase origin     "$TSX" scripts/enrich-origin-wcvp.ts
# Conservation status from the Finnish Red List (laji.fi).
run_phase redlist    "$TSX" scripts/enrich-redlist.ts

# ── RAG corpus rebuild (must use the SAME embed model as the API query path) ─
run_phase rag-plants       "$TSX" scripts/build-plant-rag-corpus.ts --locale all
run_phase rag-garden       "$TSX" scripts/build-garden-info-corpus.ts
run_phase rag-family       "$TSX" scripts/build-family-summary-corpus.ts
run_phase rag-conservation "$TSX" scripts/build-conservation-summary.ts

log "populate-all COMPLETE"
date -u '+%Y-%m-%dT%H:%M:%SZ' > /tmp/populate.done
