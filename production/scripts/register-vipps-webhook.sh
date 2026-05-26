#!/usr/bin/env bash
#
# Register the BloomOulu webhook with Vipps MobilePay's test environment.
#
# Pre-requisites (from you — these require your portal account):
#   MOBILEPAY_CLIENT_ID
#   MOBILEPAY_CLIENT_SECRET
#   MOBILEPAY_SUBSCRIPTION_KEY
#   MOBILEPAY_MERCHANT_SERIAL_NUMBER
#
# Set those in .env.test-payments (or export in your shell) before running.
# The script:
#   1. Fetches a Vipps access token
#   2. POSTs /webhooks/v1/webhooks with our ngrok callback URL
#   3. Prints the returned webhook id + secret
#   4. Appends MOBILEPAY_WEBHOOK_SECRET=… to .env.test-payments
#
# Idempotent: if a webhook already exists for the same URL, Vipps
# returns 409 and we surface the existing webhook details.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; . "$ROOT/.env"; . "$ROOT/.env.test-payments" 2>/dev/null || true; set +a

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

for var in MOBILEPAY_CLIENT_ID MOBILEPAY_CLIENT_SECRET MOBILEPAY_SUBSCRIPTION_KEY MOBILEPAY_MERCHANT_SERIAL_NUMBER MOBILEPAY_CALLBACK_URL; do
  if [[ -z "${!var:-}" ]]; then
    red "$var not set. Add it to .env.test-payments first."
    exit 1
  fi
done

API_URL="${MOBILEPAY_API_URL:-https://apitest.vipps.no}"

# ── 1. Access token ────────────────────────────────────────────────
green "Fetching Vipps access token from $API_URL/accesstoken/get"
TOKEN_RESP=$(curl -sS -X POST "$API_URL/accesstoken/get" \
  -H "client_id: $MOBILEPAY_CLIENT_ID" \
  -H "client_secret: $MOBILEPAY_CLIENT_SECRET" \
  -H "Ocp-Apim-Subscription-Key: $MOBILEPAY_SUBSCRIPTION_KEY" \
  -H "Merchant-Serial-Number: $MOBILEPAY_MERCHANT_SERIAL_NUMBER")

TOKEN=$(printf "%s" "$TOKEN_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
if [[ -z "$TOKEN" ]]; then
  red "Failed to obtain access token. Vipps responded:"
  echo "$TOKEN_RESP"
  exit 1
fi
green "Got access token (length: ${#TOKEN})"

# ── 2. Register webhook ────────────────────────────────────────────
BODY=$(cat <<JSON
{
  "url": "${MOBILEPAY_CALLBACK_URL}",
  "events": [
    "epayment.authorized.v1",
    "epayment.captured.v1",
    "epayment.cancelled.v1",
    "epayment.failed.v1",
    "epayment.aborted.v1",
    "epayment.refunded.v1",
    "recurring.agreement-activated.v1",
    "recurring.agreement-rejected.v1",
    "recurring.agreement-stopped.v1",
    "recurring.agreement-expired.v1",
    "recurring.charge-captured.v1",
    "recurring.charge-failed.v1",
    "recurring.charge-cancelled.v1"
  ]
}
JSON
)

green "Registering webhook → $MOBILEPAY_CALLBACK_URL"
REG_RESP=$(curl -sS -X POST "$API_URL/webhooks/v1/webhooks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Ocp-Apim-Subscription-Key: $MOBILEPAY_SUBSCRIPTION_KEY" \
  -H "Merchant-Serial-Number: $MOBILEPAY_MERCHANT_SERIAL_NUMBER" \
  -H 'Content-Type: application/json' \
  -d "$BODY")

ID=$(printf "%s" "$REG_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
SECRET=$(printf "%s" "$REG_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('secret',''))" 2>/dev/null || echo "")

if [[ -z "$ID" || -z "$SECRET" ]]; then
  yellow "Registration response (may already exist):"
  echo "$REG_RESP"
  yellow ""
  yellow "If 409 Conflict — list existing webhooks and reuse the secret:"
  yellow "  curl -X GET '$API_URL/webhooks/v1/webhooks' \\"
  yellow "    -H 'Authorization: Bearer $TOKEN' \\"
  yellow "    -H 'Ocp-Apim-Subscription-Key: $MOBILEPAY_SUBSCRIPTION_KEY' \\"
  yellow "    -H 'Merchant-Serial-Number: $MOBILEPAY_MERCHANT_SERIAL_NUMBER'"
  yellow ""
  yellow "Or delete the old one:"
  yellow "  curl -X DELETE '$API_URL/webhooks/v1/webhooks/<id>' \\"
  yellow "    -H 'Authorization: Bearer $TOKEN' \\"
  yellow "    -H 'Ocp-Apim-Subscription-Key: $MOBILEPAY_SUBSCRIPTION_KEY' \\"
  yellow "    -H 'Merchant-Serial-Number: $MOBILEPAY_MERCHANT_SERIAL_NUMBER'"
  exit 1
fi

green "✓ Webhook id     = $ID"
green "✓ Webhook secret = $SECRET"

OVERLAY="$ROOT/.env.test-payments"
if grep -qE '^MOBILEPAY_WEBHOOK_SECRET=' "$OVERLAY"; then
  sed -i.bak "s|^MOBILEPAY_WEBHOOK_SECRET=.*|MOBILEPAY_WEBHOOK_SECRET=${SECRET}|" "$OVERLAY" && rm -f "${OVERLAY}.bak"
else
  printf "MOBILEPAY_WEBHOOK_SECRET=%s\n" "$SECRET" >> "$OVERLAY"
fi
green "Saved MOBILEPAY_WEBHOOK_SECRET in .env.test-payments"

cat <<EOF

Next:
  1. Set PAYMENTS_MOBILEPAY_ENABLED=true in .env.test-payments
  2. Restart the dev stack:
       bash scripts/payment-test-down.sh
       bash scripts/payment-test-up.sh
  3. Open the web UI, adopt a plant, choose MobilePay
  4. The MT app on your test phone will prompt for approval (PIN 1236)
EOF
