#!/usr/bin/env bash
#
# Stand up the BloomOulu test-payments environment end-to-end.
#
# Default: uses `cloudflared tunnel --url http://localhost:N` which gives
#   ephemeral *.trycloudflare.com HTTPS URLs with NO signup. Free, instant.
#
# Set TUNNEL=ngrok to use ngrok instead (requires `ngrok config add-authtoken …`).
#
# What this script does:
#   1. Generates BANK_TRANSFER_WEBHOOK_SECRET if missing
#   2. Starts two tunnels (api → 4000, web → 3000)
#   3. Writes tunnel URLs to .env.test-payments
#   4. Boots postgres + redis via docker compose
#   5. Migrates + seeds the DB
#   6. Starts api + web + admin + kiosk via pnpm dev
#   7. Health-probes the api through its tunnel
#   8. Prints next-step Vipps registration instructions
#
# Re-runnable: idempotent except for tunnel URLs (Cloudflare/ngrok issue
# fresh ones each invocation; the script always rewrites the overlay).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }

TUNNEL="${TUNNEL:-cloudflared}"

# ── 1. Preflight ───────────────────────────────────────────────────
command -v docker >/dev/null || { red "docker not installed."; exit 1; }
command -v pnpm  >/dev/null  || { red "pnpm not installed. npm i -g pnpm"; exit 1; }
command -v openssl >/dev/null || { red "openssl not installed."; exit 1; }

case "$TUNNEL" in
  cloudflared)
    command -v cloudflared >/dev/null || { red "cloudflared not installed. brew install cloudflared"; exit 1; }
    ;;
  ngrok)
    command -v ngrok >/dev/null || { red "ngrok not installed. brew install ngrok"; exit 1; }
    ngrok config check >/dev/null 2>&1 || {
      yellow "ngrok needs auth: get token at https://dashboard.ngrok.com/get-started/your-authtoken"
      yellow "then run: ngrok config add-authtoken <YOUR-TOKEN>"
      exit 1
    }
    ;;
  *) red "Unknown TUNNEL='$TUNNEL'. Use 'cloudflared' or 'ngrok'."; exit 1 ;;
esac

# ── 2. Overlay env ─────────────────────────────────────────────────
OVERLAY="$ROOT/.env.test-payments"
touch "$OVERLAY"

set_or_replace() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$OVERLAY"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$OVERLAY" && rm -f "${OVERLAY}.bak"
  else
    printf "%s=%s\n" "$key" "$val" >> "$OVERLAY"
  fi
}

if ! grep -q '^BANK_TRANSFER_WEBHOOK_SECRET=' "$OVERLAY"; then
  set_or_replace BANK_TRANSFER_WEBHOOK_SECRET "$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-44)"
  green "Generated BANK_TRANSFER_WEBHOOK_SECRET"
fi

# ── 3. Start tunnels ───────────────────────────────────────────────
mkdir -p "$ROOT/.run"
API_LOG="$ROOT/.run/tunnel-api.log"
WEB_LOG="$ROOT/.run/tunnel-web.log"
: > "$API_LOG"
: > "$WEB_LOG"

# Clean up prior tunnel processes
pkill -f 'cloudflared tunnel --url http://localhost:(3000|4000)' 2>/dev/null || true
pkill -f 'ngrok.*http (3000|4000)'                              2>/dev/null || true
sleep 1

start_cloudflared() {
  local port="$1" log="$2"
  nohup cloudflared tunnel --url "http://localhost:${port}" --loglevel info > "$log" 2>&1 &
}

start_ngrok() {
  local port="$1" log="$2"
  nohup ngrok http "$port" --log=stdout > "$log" 2>&1 &
}

wait_for_url_cloudflared() {
  local log="$1"
  for _ in $(seq 1 30); do
    local url
    url=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$log" | head -n1 || true)
    if [[ -n "$url" ]]; then echo "$url"; return 0; fi
    sleep 1
  done
  return 1
}

wait_for_url_ngrok() {
  local port="$1"
  # The first ngrok process exposes its API on 4040; the second on 4041
  # if started after the first. We just inspect both.
  for _ in $(seq 1 30); do
    for inspect_port in 4040 4041; do
      local url
      url=$(curl -s "http://127.0.0.1:${inspect_port}/api/tunnels" 2>/dev/null \
        | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((t['public_url'] for t in d.get('tunnels',[]) if t.get('config',{}).get('addr','').endswith(':${port}')),''))" 2>/dev/null || true)
      if [[ -n "$url" ]]; then echo "$url"; return 0; fi
    done
    sleep 1
  done
  return 1
}

# Single tunnel design: only the web (Next.js) gets a public URL.
# Client-side fetches to `/v1/*` and Paytrail/MobilePay webhooks to
# `/webhooks/*` are same-origin — Next.js rewrites them server-side
# to localhost:4000 (see apps/web/next.config.mjs). One tunnel means
# zero CORS, no DNS-propagation gap on a second subdomain, and one
# URL to register in the Paytrail/Vipps merchant portals.
case "$TUNNEL" in
  cloudflared)
    start_cloudflared 3000 "$WEB_LOG"
    sleep 3
    web_url=$(wait_for_url_cloudflared "$WEB_LOG") || { red "WEB tunnel failed; see $WEB_LOG"; exit 1; }
    ;;
  ngrok)
    start_ngrok 3000 "$WEB_LOG"
    sleep 2
    web_url=$(wait_for_url_ngrok 3000) || { red "WEB tunnel failed"; exit 1; }
    ;;
esac

api_url="$web_url"   # api is reached via /v1/* on the same host
green "Public tunnel: $web_url  (web + /v1/* api + /webhooks/*)"

# ── 4. Write overlay ───────────────────────────────────────────────
set_or_replace PAYTRAIL_MOCK                      false
set_or_replace PAYTRAIL_MERCHANT_ID               375917
set_or_replace PAYTRAIL_SECRET                    SAIPPUAKAUPPIAS
set_or_replace PAYTRAIL_WEBHOOK_SECRET            SAIPPUAKAUPPIAS
set_or_replace PAYTRAIL_API_URL                   https://services.paytrail.com
set_or_replace PAYTRAIL_CALLBACK_URL              "${web_url}/webhooks/paytrail"
set_or_replace PAYTRAIL_RETURN_URL                "${web_url}/en/donate/complete"

set_or_replace MOBILEPAY_API_URL                  https://apitest.vipps.no
set_or_replace MOBILEPAY_RETURN_URL               "${web_url}/en/donate/complete"
set_or_replace MOBILEPAY_CALLBACK_URL             "${web_url}/webhooks/mobilepay"

# Both PUBLIC URLs point at the single tunnel; INTERNAL_API_URL stays
# on localhost for SSR + the Next.js rewrite target (no tunnel hop).
set_or_replace NEXT_PUBLIC_API_URL                "$web_url"
set_or_replace NEXT_PUBLIC_WEB_URL                "$web_url"
set_or_replace INTERNAL_API_URL                   "http://localhost:4000"
set_or_replace API_REWRITE_TARGET                 "http://localhost:4000"

set_or_replace PAYMENTS_PAYTRAIL_ENABLED          true
# Bank-transfer is hidden from the donor UI by design; admins still
# reconcile via /admin → Reconciliation. Disable here so the API
# refuses new bank_transfer adoptions during test.
set_or_replace PAYMENTS_BANK_TRANSFER_ENABLED     false
# MobilePay needs real Vipps test creds — if the overlay already has
# them, enable the tile; otherwise keep it off so the donor doesn't
# see a tile that errors on click.
if grep -qE '^MOBILEPAY_CLIENT_ID=.+' "$OVERLAY"; then
  set_or_replace PAYMENTS_MOBILEPAY_ENABLED       true
else
  set_or_replace PAYMENTS_MOBILEPAY_ENABLED       false
fi

green "Wrote tunnel URLs to .env.test-payments"

# ── 5. Bring up infra ──────────────────────────────────────────────
docker compose up -d postgres redis >/dev/null
until docker exec bloomoulu-postgres-1 pg_isready -U bloomoulu >/dev/null 2>&1; do sleep 1; done
green "Infra up"

# dotenv-style loader that tolerates unquoted `<>` etc. — bash's
# native sourcing can't handle them (e.g. SMTP_FROM=Foo <a@b>).
load_env_via_python() {
  local files=("$@")
  python3 - "${files[@]}" <<'PY'
import os, sys, re, shlex
out_lines = []
for path in sys.argv[1:]:
    if not os.path.exists(path):
        continue
    with open(path, 'r', encoding='utf-8') as f:
        for raw in f:
            line = raw.rstrip('\n')
            if not line or line.lstrip().startswith('#'): continue
            m = re.match(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$', line)
            if not m: continue
            k, v = m.group(1), m.group(2)
            v = v.strip()
            # Strip matching outer quotes
            if (len(v) >= 2) and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
                v = v[1:-1]
            print(f"export {k}={shlex.quote(v)}")
PY
}

eval "$(load_env_via_python "$ROOT/.env" "$OVERLAY")"
pnpm db:migrate >/dev/null 2>&1
if [[ "${NO_SEED:-0}" == "1" ]]; then
  yellow "NO_SEED=1 — skipping pnpm db:seed (data restored from a dump?)"
else
  pnpm db:seed >/dev/null 2>&1
fi
green "DB migrated$([[ \"${NO_SEED:-0}\" == \"1\" ]] || echo \" + seeded\")"

# Override the seeded SystemSetting payment toggles to match the
# user's intent for THIS test run. The seed gives defaults; this
# step locks in what we want before the api starts.
mobilepay_db=$(grep -qE '^MOBILEPAY_CLIENT_ID=.+' "$OVERLAY" && echo true || echo false)
docker exec -i bloomoulu-postgres-1 psql -U bloomoulu -d bloomoulu -q >/dev/null 2>&1 <<SQL || true
  UPDATE "SystemSetting" SET value = 'false'::jsonb WHERE key = 'payments.bank_transfer';
  UPDATE "SystemSetting" SET value = 'true'::jsonb  WHERE key = 'payments.paytrail';
  UPDATE "SystemSetting" SET value = '${mobilepay_db}'::jsonb WHERE key = 'payments.mobilepay';
SQL
green "Synced payment toggles (paytrail=on, bank_transfer=off, mobilepay=${mobilepay_db})"

# Persist a merged env for the dev process so it stays in sync.
MERGED="$ROOT/.run/dev.env.sh"
load_env_via_python "$ROOT/.env" "$OVERLAY" > "$MERGED"

# ── 6. Start apps + the BullMQ worker ──────────────────────────────
# Turbo's `dev` target only spawns the foreground apps (api, web,
# admin, kiosk). The BullMQ worker is a separate process. Without it,
# the plant-enrichment queue, receipt PDF generation, dunning ladder,
# reconciliation cron, and disbursement monthly draft never fire —
# they just accumulate in Redis forever.
nohup bash -c "source '$MERGED'; NODE_OPTIONS='--import tsx' pnpm dev" \
  > "$ROOT/.run/dev.log" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > "$ROOT/.run/dev.pid"
green "Started api + web + admin + kiosk (PID $DEV_PID)"

# Run the worker via `node --import tsx --watch` so source edits
# hot-reload it alongside nest. Cwd is apps/api so relative paths in
# worker.ts resolve (it reads ../../.env via env.ts).
nohup bash -c "source '$MERGED'; cd '$ROOT/apps/api' && NODE_OPTIONS='--import tsx' node --watch src/worker.ts" \
  > "$ROOT/.run/worker.log" 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" > "$ROOT/.run/worker.pid"
green "Started worker (PID $WORKER_PID)"
yellow "Tail logs: tail -f $ROOT/.run/dev.log  ·  tail -f $ROOT/.run/worker.log"

# ── 7. Health probe ────────────────────────────────────────────────
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "$api_url/healthz" >/dev/null 2>&1; then
    green "api healthy at $api_url/healthz"
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" != 1 ]]; then
  yellow "api hasn't responded yet — check $ROOT/.run/dev.log; turbo can take ~60s on first boot"
fi

# ── 8. Next steps ──────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────────
 BloomOulu test-payments environment is up
────────────────────────────────────────────────────────────────────

Tunnels:
  API:   $api_url
  WEB:   $web_url

Donor-facing rails (by design):
  • Paytrail (cards + FI banks)  — ready now via real Paytrail test merchant
  • Vipps MobilePay              — needs YOUR one-time portal registration
  • Bank transfer                — admin-only (reconciliation upload), not in donor UI

Test Paytrail in the browser NOW:
  1. Open $web_url/en/plants
  2. Adopt any plant → Card / Paytrail
  3. Card 4153 0139 9970 0321  exp 11/26  CVC 321
  4. 3DS auto-completes → /donate/complete → webhook fires → adoption activates
  5. Verify in /admin (http://localhost:4100/admin) — receipt arrives via real SMTP

Test MobilePay in the browser (after one-time setup):

  □ Sign up at https://portal.vippsmobilepay.com (free, ~15 min)
    - Order ePayment + Recurring API products
    - For developers → Test users → Add a new test user
    - Copy: client_id, client_secret, subscription_key, MSN
  □ Install Vipps MobilePay MT app on your phone:
    - iOS: https://testflight.apple.com/join/hTAYrwea
    - Android: join Google Group 'vipps-mobilepay-test-app',
      then https://play.google.com/store/apps/details?id=no.dnb.vipps.mt
  □ Paste creds into .env.test-payments:
       MOBILEPAY_CLIENT_ID=…
       MOBILEPAY_CLIENT_SECRET=…
       MOBILEPAY_SUBSCRIPTION_KEY=…
       MOBILEPAY_MERCHANT_SERIAL_NUMBER=…
  □ Run: bash scripts/register-vipps-webhook.sh
      (auto-fills MOBILEPAY_WEBHOOK_SECRET in the overlay)
  □ Flip PAYMENTS_MOBILEPAY_ENABLED=true in .env.test-payments
  □ Restart: bash scripts/payment-test-down.sh && bash scripts/payment-test-up.sh

Tear down: bash scripts/payment-test-down.sh
EOF
