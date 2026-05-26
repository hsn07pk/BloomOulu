# Testing payments end-to-end

The payment system is wired to run against **real Paytrail and Vipps
test environments** — not mocks. Same code, same servers, same
HMAC-signed callbacks. The only difference between test and
production is the credentials in `.env`.

## What's already automated

- `scripts/payment-test-up.sh` — boots Cloudflare Tunnels (api + web),
  brings up Postgres / Redis / MinIO / MailHog from the **bloomoulu**
  Docker project, migrates + seeds the DB, starts `pnpm dev`, writes
  the tunnel URLs and a generated `BANK_TRANSFER_WEBHOOK_SECRET` into
  `.env.test-payments`.
- `scripts/payment-test-down.sh` — clean teardown.
- `scripts/register-vipps-webhook.sh` — once you have Vipps test
  credentials, fetches an access token + POSTs the webhook
  registration + writes the returned secret back into the overlay.

Run `bash scripts/payment-test-up.sh` and the stack is live in ~60
seconds. Re-run it any time — the overlay file is regenerated.

## Where the test credentials live

- Paytrail cards + bank logins: [`docs/test-credentials/paytrail.md`](./test-credentials/paytrail.md)
- MobilePay setup + test users: [`docs/test-credentials/mobilepay.md`](./test-credentials/mobilepay.md)

## The three rails — what each test exercises

| Rail | What you need | Works out of the box? |
|---|---|---|
| **Paytrail** | Already in `.env` (public test merchant `375917`) | ✅ Yes — just run `payment-test-up.sh` |
| **MobilePay / Vipps** | Free portal registration + MT app on phone | ❌ Requires your portal account (see `test-credentials/mobilepay.md`) |
| **Bank transfer** | Nothing external | ✅ Yes — admin uploads CSV via `/admin → Reconciliation` |

## End-to-end flow for each rail

### Paytrail (cards + FI online banking)

1. `bash scripts/payment-test-up.sh` — prints the web tunnel URL
2. Open the web URL → `/en/plants`
3. Pick a plant → Adopt → **Card / Paytrail**
4. Real Paytrail hosted checkout opens
5. Use card `4153 0139 9970 0321`, exp `11/26`, CVC `321` (happy path)
6. 3DS auto-completes; Paytrail redirects to `/donate/complete`
7. `/webhooks/paytrail` fires; HMAC verified; Payment marked
   succeeded; Adoption activated; receipt queued
8. Check the result:
   - Adoption: `/admin/resources/Adoption`
   - Receipt PDF + email: <http://localhost:8025> (MailHog)
   - Audit trail: `/admin/resources/AuditLog`

Other test cards (decline / 3DS-fail / insufficient funds) — see
[`docs/test-credentials/paytrail.md`](./test-credentials/paytrail.md).

### MobilePay / Vipps

Requires the one-time setup in
[`docs/test-credentials/mobilepay.md`](./test-credentials/mobilepay.md)
(register at `portal.vippsmobilepay.com`, install the MT app, paste
credentials into `.env.test-payments`, run
`bash scripts/register-vipps-webhook.sh`). Then:

1. Restart so the api picks up the credentials:
   `bash scripts/payment-test-down.sh && bash scripts/payment-test-up.sh`
2. Open the web URL → Adopt → **MobilePay**
3. MT app on your phone pops up; approve with PIN `1236`
4. Browser redirects; webhook fires; adoption activates

### Bank transfer

1. Open the web URL → Adopt → **Bank transfer**
2. You land on `/donate/pay` with IBAN, BIC, RF reference, EPC069-12 QR
3. As an admin, go to <http://localhost:4100/admin> → Reconciliation
4. Upload a CSV row matching the RF reference + amount
5. Payment flips to succeeded; adoption activates

## Going from test to production

When real merchant credentials arrive, the **only** changes are env
values. Zero code changes.

```diff
- PAYTRAIL_MERCHANT_ID=375917
+ PAYTRAIL_MERCHANT_ID=<your real merchant id>
- PAYTRAIL_SECRET=SAIPPUAKAUPPIAS
+ PAYTRAIL_SECRET=<your real secret>

- MOBILEPAY_API_URL=https://apitest.vipps.no
+ MOBILEPAY_API_URL=https://api.vipps.no
+ MOBILEPAY_CLIENT_ID=<real>
+ MOBILEPAY_CLIENT_SECRET=<real>
# (same for SUBSCRIPTION_KEY, MERCHANT_SERIAL_NUMBER)

# Re-register the webhook against production Vipps
# → captures a new MOBILEPAY_WEBHOOK_SECRET

+ GARDEN_IBAN=<real Garden IBAN>
+ GARDEN_BIC=<real Garden BIC>
+ BANK_TRANSFER_WEBHOOK_SECRET=$(openssl rand -base64 32)
```

The HMAC verifiers, tokenisation flow, MIT charge, refund handling,
dunning ladder, renewal cron, disbursement bundling, and
reconciliation paths are the same in test and production.

## Outstanding human-only items (carry these forward)

- Sign Paytrail merchant + replace `PAYTRAIL_MERCHANT_ID` / `PAYTRAIL_SECRET`
- Sign Vipps MobilePay merchant + populate `MOBILEPAY_*`
- Register `https://api.bloomoulu.fi/webhooks/{paytrail,mobilepay}` in the provider portals
- Set real `GARDEN_IBAN` / `GARDEN_BIC` (`docs/ENV.md` has the matrix)
- Generate + share `BANK_TRANSFER_WEBHOOK_SECRET` with the accountant's reconciliation cron
- Confirm University finance's preferred CSV column layout — the default
  layout is in `apps/api/src/modules/disbursements/disbursements.service.ts`
- Run the €25 smoke per rail listed in
  [`PRE_LAUNCH_CHECKLIST.md`](./PRE_LAUNCH_CHECKLIST.md)
