#!/usr/bin/env bash
#
# use-ngrok-domain.sh — point the whole stack at your reserved ngrok
# static domain so `docker compose up -d` always comes up on the SAME
# public HTTPS URL.
#
# Usage:
#   bash scripts/use-ngrok-domain.sh bloomoulu.ngrok-free.app
#
# What it does (idempotent — safe to re-run):
#   • NGROK_DOMAIN            = <domain>
#   • NEXT_PUBLIC_WEB_URL     = https://<domain>
#   • NEXT_PUBLIC_API_URL     = https://<domain>   (single-host design;
#                               web rewrites /v1/* + /webhooks/* to the api)
#   • PAYTRAIL_RETURN_URL     = https://<domain>/en/donate/complete
#   • PAYTRAIL_CALLBACK_URL   = https://<domain>/webhooks/paytrail
#   • MOBILEPAY_RETURN_URL    = https://<domain>/en/donate/complete   (if present)
#   • COMPOSE_PROFILES=tunnel (so `docker compose up -d` starts ngrok)
#
# Prereqs: NGROK_AUTHTOKEN already set in .env (one-time, from the ngrok
# dashboard). See docs/runbook/stable-tunnel.md.
set -euo pipefail

DOMAIN="${1:-}"
ENV_FILE="${2:-.env}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: bash scripts/use-ngrok-domain.sh <your-domain.ngrok-free.app> [env-file]" >&2
  exit 1
fi
# Strip any accidental scheme/trailing slash the user pasted.
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%/}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No $ENV_FILE found. Run this from the production/ directory." >&2
  exit 1
fi

URL="https://${DOMAIN}"

# set_kv KEY VALUE — replace an existing KEY= line in place, or append it.
set_kv() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Use a temp file for portable in-place edit (BSD + GNU sed differ).
    awk -v k="$key" -v v="$val" '
      BEGIN { FS=OFS="=" }
      $1 == k { print k "=" v; next }
      { print }
    ' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

set_kv NGROK_DOMAIN          "$DOMAIN"
set_kv NEXT_PUBLIC_WEB_URL   "$URL"
set_kv NEXT_PUBLIC_API_URL   "$URL"
set_kv PAYTRAIL_RETURN_URL   "${URL}/en/donate/complete"
set_kv PAYTRAIL_CALLBACK_URL "${URL}/webhooks/paytrail"
# Only set MobilePay return if the key already exists (don't introduce it
# for setups that don't use MobilePay).
if grep -qE "^MOBILEPAY_RETURN_URL=" "$ENV_FILE"; then
  set_kv MOBILEPAY_RETURN_URL "${URL}/en/donate/complete"
fi
set_kv COMPOSE_PROFILES      "tunnel"

echo "✓ Configured stable tunnel domain: ${URL}"
echo ""
echo "  NEXT_PUBLIC_WEB_URL    = ${URL}"
echo "  NEXT_PUBLIC_API_URL    = ${URL}"
echo "  PAYTRAIL_RETURN_URL    = ${URL}/en/donate/complete"
echo "  PAYTRAIL_CALLBACK_URL  = ${URL}/webhooks/paytrail"
echo "  COMPOSE_PROFILES       = tunnel"
echo ""

if ! grep -qE "^NGROK_AUTHTOKEN=.+" "$ENV_FILE"; then
  echo "⚠  NGROK_AUTHTOKEN is still empty in $ENV_FILE."
  echo "   Paste it from https://dashboard.ngrok.com/get-started/your-authtoken"
  echo "   then continue."
  echo ""
fi

echo "Next:"
echo "  • First boot (bakes the URL into the web image):"
echo "      docker compose up -d --build"
echo "  • Every boot after that (same URL, no rebuild):"
echo "      docker compose up -d"
echo ""
echo "Your stack will be live at: ${URL}"
echo "Paytrail webhook:          ${URL}/webhooks/paytrail"
