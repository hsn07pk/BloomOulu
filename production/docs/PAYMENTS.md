# Payments — config, providers, and going from sandbox to production

This is the operator playbook. All payment logic lives in
`packages/payments/src/{paytrail,mobilepay,banktransfer}/gateway.ts`; the
API wires it via `apps/api/src/modules/payments/`.

Related docs:
- [`TESTING.md`](./TESTING.md) — how to run end-to-end tests
- [`test-credentials/paytrail.md`](./test-credentials/paytrail.md) — test cards + bank logins
- [`test-credentials/mobilepay.md`](./test-credentials/mobilepay.md) — Vipps registration + MT app
- [`PRE_LAUNCH_CHECKLIST.md`](./PRE_LAUNCH_CHECKLIST.md) — final pre-launch gate

## Providers

| Provider       | When picked (router) | Fees       |
|----------------|----------------------|------------|
| Paytrail       | Donor explicitly chose Card; non-FI donors; fallback when others off | ~1.5% + €0.35 |
| MobilePay/Vipps| Donor chose MobilePay | ~1.4% |
| Bank transfer  | Donor chose Bank; FI donor with no preference (zero-fee default) | €0 |

Router rules: `packages/payments/src/router.ts`. Admin can flip a
provider on/off in `/admin → SystemSetting → payments.{paytrail,mobilepay,bank_transfer}` without a deploy.

## Paytrail

**Test credentials (well-known, included by default):**

```
PAYTRAIL_MERCHANT_ID=375917
PAYTRAIL_SECRET=SAIPPUAKAUPPIAS
PAYTRAIL_WEBHOOK_SECRET=SAIPPUAKAUPPIAS
PAYTRAIL_API_URL=https://services.paytrail.com
```

These are Paytrail's public test merchant — every Paytrail integrator
uses them for sandbox. They are NOT production credentials.

### Localhost mock mode (`PAYTRAIL_MOCK=true`)

Paytrail's real hosted checkout rejects `http://` callback URLs even in
sandbox, so localhost can't reach it. We solve this with a
`PaytrailMockGateway` toggle that:

- Bypasses the `services.paytrail.com/payments` API call entirely.
- Renders our own mock checkout UI at `/donate/paytrail-test` that looks
  like Paytrail's page.
- On "Pay", the api endpoint `/v1/payments/paytrail-mock/finalize`
  computes the **real** HMAC-SHA256 signature using the merchant secret
  and constructs a Paytrail-formatted return URL.
- The donor's browser follows that URL to `/donate/complete`, which
  forwards it to `GET /webhooks/paytrail` — the **same** signature
  verification + activation pipeline that fires in production.

Only the "pick your bank" UI step is mocked; everything else (signing,
verification, idempotency, audit logging, donation completion, receipt
enqueue) runs exactly as in production.

### Going to production

```
PAYTRAIL_MERCHANT_ID=<your-merchant-id>
PAYTRAIL_SECRET=<your-secret>
PAYTRAIL_WEBHOOK_SECRET=<optional-callback-secret>
PAYTRAIL_API_URL=https://services.paytrail.com
PAYTRAIL_MOCK=false      # ← key switch
NEXT_PUBLIC_WEB_URL=https://bloomoulu.fi
PAYTRAIL_CALLBACK_URL=https://api.bloomoulu.fi/webhooks/paytrail
PAYTRAIL_RETURN_URL=https://bloomoulu.fi/{locale}/donate/complete
```

Zero code change needed.

## MobilePay / Vipps

There are **no public shared test credentials** for MobilePay/Vipps.
Each merchant registers at https://developer.vippsmobilepay.com and
gets their own sandbox credentials emailed by `partner@vippsmobilepay.com`.

To enable:

```
MOBILEPAY_CLIENT_ID=<your-client-id>
MOBILEPAY_CLIENT_SECRET=<your-secret>
MOBILEPAY_SUBSCRIPTION_KEY=<your-subscription-key>
MOBILEPAY_MERCHANT_SERIAL_NUMBER=<MSN>
MOBILEPAY_WEBHOOK_SECRET=<your-webhook-secret>
MOBILEPAY_API_URL=https://apitest.vipps.no       # sandbox
# MOBILEPAY_API_URL=https://api.vipps.no         # production
MOBILEPAY_RETURN_URL=https://bloomoulu.fi/{locale}/garden
MOBILEPAY_CALLBACK_URL=https://api.bloomoulu.fi/webhooks/mobilepay
```

Then flip `payments.mobilepay=true` in `/admin → SystemSetting`. The
donate form's payment-method picker enables the MobilePay tile
automatically based on the same flag.

## Bank transfer

Real flow: donor lands on `/donate/pay` with IBAN + BIC + EPC069-12 QR.
They use their bank app to scan the QR and complete the SEPA Credit
Transfer. The Garden's accountant either:

- uploads the daily camt.054 statement via `/admin → Reconciliation`
  (role-guarded UI; no shared secret needed), or
- runs an automated cron that POSTs each parsed row to
  `POST /webhooks/bank-transfer` signed with HMAC-SHA256 over the raw
  body using `BANK_TRANSFER_WEBHOOK_SECRET`.

Configure in `/admin → SystemSetting`:

```
bankTransfer.iban             "FI21 1234 5600 0007 85"
bankTransfer.bic              "OKOYFIHH"
bankTransfer.beneficiaryName  "Oulun yliopiston kasvitieteellinen puutarha"
bankTransfer.instructionsUrl  "https://bloomoulu.fi/en/donate/pay"
```

Set in env:

```
BANK_TRANSFER_WEBHOOK_SECRET=<32+ char random>   # required if you wire the cron
```

The webhook fails closed: if `BANK_TRANSFER_WEBHOOK_SECRET` is unset,
the route still accepts requests but refuses any that include an
`Authorization` header (so a forgotten secret in prod returns 400
rather than silently completing donations).

## One-time checkout

Every donation is a single payment — there are no recurring agreements,
tokenised cards, renewal cron, or dunning ladder. The adopt-a-plant tier
model that required them was removed.

- **Paytrail / MobilePay**: the donor approves one payment on the
  provider's hosted page or app; the signed callback marks the
  `Payment` succeeded and the `Donation` completed, then enqueues the
  receipt. Refund callbacks land on the same `/webhooks/paytrail`
  endpoint via `PAYTRAIL_CALLBACK_URL`.
- **Bank transfer**: the donor makes the SEPA Credit Transfer once; the
  accountant's CSV upload reconciles the inbound payment by its RF
  reference. No reminder ladder.

A failed or abandoned payment simply leaves the `Donation` in
`pending` / `failed`; the donor can retry from `/donate`.

## Code that's already production-grade

- HMAC signature verification on every callback (Paytrail + MobilePay).
- Idempotent webhook handling via `(provider, providerEventId)` unique
  index on `ProcessedEvent`.
- One `prisma.$transaction` per webhook = payment update + donation
  completion + audit log all atomic.
- Throttling on webhook routes (5000/min/IP).
- Receipts: enqueued after webhook commit; PDF + email handled by the
  worker.
- No PCI scope: Paytrail's hosted checkout owns card data; the api
  never sees PAN/CVV.
