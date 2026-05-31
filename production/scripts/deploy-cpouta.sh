#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# BloomOulu — turnkey CSC cPouta deployment.
#
#   sudo ./scripts/deploy-cpouta.sh <PUBLIC_HOST>
#
# <PUBLIC_HOST> is a *resolvable* hostname (NOT a bare IP — admin/kiosk are
# subdomains). The free, zero-setup option is sslip.io:
#
#   <your-floating-ip-with-dashes>.sslip.io     e.g. 195-148-30-10.sslip.io
#
# sslip.io resolves *.195-148-30-10.sslip.io → 195.148.30.10 at no cost, so the
# admin. and kiosk. subdomains work without you owning a domain.
#
# What this does, end to end, on a fresh Ubuntu cPouta VM:
#   1. installs Docker + compose plugin if missing
#   2. renders production/.env from .env.csc.example (substitutes the host,
#      generates every secret) — but ONLY on first run; re-runs reuse it so
#      the Postgres volume password never drifts
#   3. builds all images (web bakes the public URLs at build time)
#   4. hashes a generated admin password with the app's own bcryptjs
#   5. brings up Postgres/Redis/Ollama, waits for the DB, migrates + seeds
#   6. brings up the whole stack behind Caddy (automatic HTTPS)
#   7. pulls the Ollama models and builds the RAG corpus (best effort)
#   8. verifies health and prints the URLs + admin login
#
# Payments stay in MOCK mode (PAYTRAIL_MOCK=true, test cards only) — this is a
# demo/educational deployment and never moves real money. Do not change that.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Pretty logging ──────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$(printf '\033[1m'); G=$(printf '\033[32m'); Y=$(printf '\033[33m'); R=$(printf '\033[31m'); C=$(printf '\033[36m'); X=$(printf '\033[0m'); else B=; G=; Y=; R=; C=; X=; fi
step() { printf '\n%s▶ %s%s\n' "$B$C" "$*" "$X"; }
ok()   { printf '%s✓ %s%s\n' "$G" "$*" "$X"; }
warn() { printf '%s! %s%s\n' "$Y" "$*" "$X" >&2; }
die()  { printf '%s✗ %s%s\n' "$R" "$*" "$X" >&2; exit 1; }

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ── Args ──────────────────────────────────────────────────────────────────--
PUBLIC_HOST="${1:-}"
case "$PUBLIC_HOST" in
  ""|-h|--help) usage 0 ;;
esac
# A bare IPv4 has no resolvable subdomains → admin/kiosk would 404. Warn loudly
# but continue (the apex site still works).
if printf '%s' "$PUBLIC_HOST" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
  warn "PUBLIC_HOST '$PUBLIC_HOST' is a bare IP — admin.$PUBLIC_HOST / kiosk.$PUBLIC_HOST won't resolve."
  warn "Use the dashed sslip.io form instead, e.g. ${PUBLIC_HOST//./-}.sslip.io"
fi

# Run from the production/ directory regardless of where we were invoked.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.." || die "cannot cd to production/ root"
[ -f docker-compose.yml ] && [ -f docker-compose.csc.yml ] || die "run me from a checkout that has docker-compose.yml + docker-compose.csc.yml"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.csc.yml"

# ── 1. Docker ─────────────────────────────────────────────────────────────--
step "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" = "0" ]; then
    warn "Docker not found — installing via get.docker.com"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker 2>/dev/null || true
    # Let the non-root login user drive docker without sudo next time.
    real_user="${SUDO_USER:-}"
    [ -n "$real_user" ] && usermod -aG docker "$real_user" 2>/dev/null || true
  else
    die "Docker is not installed. Install Docker Engine + the compose plugin, then re-run."
  fi
fi
docker compose version >/dev/null 2>&1 || die "the 'docker compose' v2 plugin is required (got legacy docker-compose?)"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) ready"

# ── 2. .env (first run only) ────────────────────────────────────────────────
# Replace a REPLACE_ME token everywhere it appears. All generated values are
# restricted to characters that are safe in a sed replacement with | delim
# (no |, &, or backslash), so this is injection-safe.
subst() { sed -i.bak "s|$1|$2|g" .env && rm -f .env.bak; }
# Random secrets: hex/alnum only → safe in DATABASE_URL and in sed.
gen_hex()   { openssl rand -hex "${1:-32}"; }
gen_alnum() { openssl rand -base64 "$(( ${1:-20} * 2 ))" | tr -dc 'A-Za-z0-9' | cut -c "1-${1:-20}"; }

ADMIN_EMAIL_DEFAULT="admin@bloomoulu.demo"
ADMIN_PW=""

if [ -f .env ]; then
  warn ".env already exists — reusing it (secrets + DB password kept stable). Delete it to start fresh."
  ADMIN_EMAIL="$(grep -m1 -E '^ADMIN_BOOTSTRAP_EMAIL=' .env | cut -d= -f2- || true)"
  ADMIN_EMAIL="${ADMIN_EMAIL:-$ADMIN_EMAIL_DEFAULT}"
else
  step "Rendering .env for $PUBLIC_HOST"
  [ -f .env.csc.example ] || die ".env.csc.example missing"
  cp .env.csc.example .env
  subst REPLACE_ME_PUBLIC_HOST "$PUBLIC_HOST"
  subst REPLACE_ME_DB_PASSWORD "$(gen_hex 24)"
  subst REPLACE_ME_AUTH_SECRET "$(gen_hex 32)"
  subst REPLACE_ME_BANK_SECRET "$(gen_hex 32)"
  ADMIN_PW="$(gen_alnum 20)"   # plaintext; only the hash is stored, printed once at the end
  ADMIN_EMAIL="$ADMIN_EMAIL_DEFAULT"
  ok "Wrote $(pwd)/.env"
fi

# ── 3. Build images (web bakes NEXT_PUBLIC_* + public host at build time) ────
step "Building images (first build pulls the toolchain — can take 10-20 min)"
$COMPOSE build
ok "Images built"

# ── 4. Admin password hash (only when we just generated a password) ─────────-
if [ -n "$ADMIN_PW" ]; then
  step "Hashing the admin password with the app's bcryptjs"
  HASH_RAW="$($COMPOSE run --rm --no-deps -T \
      -e ADMIN_PW="$ADMIN_PW" -e NODE_OPTIONS= \
      --entrypoint sh api \
      -c 'node -e "console.log(require(\"bcryptjs\").hashSync(process.env.ADMIN_PW, 12))"')"
  ADMIN_HASH="$(printf '%s\n' "$HASH_RAW" | grep -E '^\$2[aby]\$[0-9]{2}\$' | tail -n1 || true)"
  [ -n "$ADMIN_HASH" ] || die "could not compute admin password hash (got: $HASH_RAW)"
  # docker compose interpolates $ inside .env values, so a bcrypt hash must be
  # stored with every $ doubled to $$ (the same convention .env.csc.example and
  # the dev .env use). Compose un-escapes $$ → $ when it injects the variable,
  # so the admin container's bcrypt.compare() sees the real hash.
  ADMIN_HASH_ESC="$(printf '%s' "$ADMIN_HASH" | sed 's/\$/\$\$/g')"
  subst REPLACE_ME_ADMIN_HASH "$ADMIN_HASH_ESC"
  ok "Admin hash written to .env"
fi

# ── 5. Data plane → migrate → seed ──────────────────────────────────────────
step "Starting Postgres, Redis and Ollama"
$COMPOSE up -d postgres redis ollama

step "Waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER:-bloomoulu}" >/dev/null 2>&1; then
    ok "Postgres is ready"; break
  fi
  [ "$i" = 60 ] && die "Postgres did not become ready in time"
  sleep 2
done

step "Applying database migrations"
# Call prisma directly (not the package's dotenv-wrapped script): the container
# already has DATABASE_URL/DIRECT_URL injected by compose, and /app/.env does
# not exist inside the image.
$COMPOSE run --rm --no-deps -T --entrypoint sh api \
  -c 'cd /app && pnpm --filter @bloomoulu/db exec prisma migrate deploy'
ok "Migrations applied"

step "Seeding tiers, settings, flora, emails, content + admin user"
# seedAdmin() creates the admin User row from ADMIN_BOOTSTRAP_EMAIL; the api
# service env doesn't carry that var, so pass it explicitly here.
$COMPOSE run --rm --no-deps -T \
  -e ADMIN_BOOTSTRAP_EMAIL="$ADMIN_EMAIL" \
  --entrypoint sh api \
  -c 'cd /app && pnpm --filter @bloomoulu/db exec tsx prisma/seed/index.ts'
ok "Database seeded"

# ── 6. Full stack ────────────────────────────────────────────────────────--
step "Bringing up the full stack behind Caddy"
$COMPOSE up -d
ok "All services started"

# ── 7. Ollama models + RAG corpus (best effort) ─────────────────────────────
OLLAMA_LLM="$(grep -m1 -E '^OLLAMA_LLM_MODEL=' .env | cut -d= -f2- || true)"; OLLAMA_LLM="${OLLAMA_LLM:-gemma3:4b}"
OLLAMA_EMBED="$(grep -m1 -E '^OLLAMA_EMBED_MODEL=' .env | cut -d= -f2- || true)"; OLLAMA_EMBED="${OLLAMA_EMBED:-bge-m3}"
step "Pulling Ollama models ($OLLAMA_LLM + $OLLAMA_EMBED) — several GB, please wait"
if $COMPOSE exec -T ollama ollama pull "$OLLAMA_EMBED" && $COMPOSE exec -T ollama ollama pull "$OLLAMA_LLM"; then
  ok "Models pulled"
  step "Building the RAG corpus + embeddings (best effort)"
  if $COMPOSE run --rm --no-deps -T --entrypoint sh api \
       -c 'cd /app && pnpm --filter @bloomoulu/rag run ingest'; then
    ok "RAG corpus built"
  else
    warn "RAG ingest failed — the site still works (Ask-the-Garden falls back to retrieval-only). Re-run later:"
    warn "  $COMPOSE run --rm --no-deps --entrypoint sh api -c 'cd /app && pnpm --filter @bloomoulu/rag run ingest'"
  fi
else
  warn "Ollama model pull failed (network / disk). The stack is up; pull later with:"
  warn "  $COMPOSE exec ollama ollama pull $OLLAMA_EMBED && $COMPOSE exec ollama ollama pull $OLLAMA_LLM"
fi

# ── 8. Verify ────────────────────────────────────────────────────────────--
step "Verifying health"
verify() { # name url
  for i in $(seq 1 30); do
    if curl -ksS -o /dev/null -w '%{http_code}' "$2" 2>/dev/null | grep -Eq '^(2|3)[0-9][0-9]$'; then
      ok "$1 OK"; return 0
    fi
    sleep 2
  done
  warn "$1 did not respond at $2 (it may still be warming up — check '$COMPOSE logs')"
}
verify "api  (loopback :4000)"  "http://127.0.0.1:4000/healthz"
verify "web  (loopback :3000)"  "http://127.0.0.1:3000/api/healthz"
verify "web  (https via Caddy)" "https://$PUBLIC_HOST/"
verify "admin (https via Caddy)" "https://admin.$PUBLIC_HOST/admin/health"
verify "kiosk (https via Caddy)" "https://kiosk.$PUBLIC_HOST/"

# ── Summary ────────────────────────────────────────────────────────────────
printf '\n%s════════════════════════════════════════════════════════════════%s\n' "$B$G" "$X"
printf '%s BloomOulu is deployed.%s\n' "$B$G" "$X"
printf '%s════════════════════════════════════════════════════════════════%s\n' "$B$G" "$X"
cat <<EOF

  Public site   https://$PUBLIC_HOST
  Operator      https://admin.$PUBLIC_HOST/admin
  Kiosk         https://kiosk.$PUBLIC_HOST

EOF
if [ -n "$ADMIN_PW" ]; then
  printf '  %sAdmin login (shown ONCE — save it now):%s\n' "$B$Y" "$X"
  printf '    email     %s\n' "$ADMIN_EMAIL"
  printf '    password  %s%s%s\n\n' "$B" "$ADMIN_PW" "$X"
else
  printf '  %sAdmin password was set on a previous run (not re-shown).%s\n' "$Y" "$X"
  printf '    email     %s\n\n' "$ADMIN_EMAIL"
fi
cat <<EOF
  Payments are in MOCK mode (test cards only) — no real money moves.
  TLS is self-signed by default (browser warning is expected). For a real
  cert on a resolvable host: set CADDY_TLS= and CADDY_ACME_EMAIL=you@org in
  .env, then: $COMPOSE up -d caddy

  Logs:    $COMPOSE logs -f
  Stop:    $COMPOSE down
  Status:  $COMPOSE ps

EOF
