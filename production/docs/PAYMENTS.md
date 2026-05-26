# Payments — config, providers, and going from sandbox to production

This is the operator playbook. All payment logic lives in
`packages/payments/src/{paytrail,mobilepay,banktransfer}/gateway.ts`; the
API wires it via `apps/api/src/modules/payments/`.

## Providers

| Provider       | When picked (router) | Fees       | Recurring |
|----------------|----------------------|------------|-----------|
| Paytrail       | Donor explicitly chose Card; non-FI donors; fallback when others off | ~1.5% + €0.35 | yes (token)
| MobilePay/Vipps| Donor chose MobilePay; FI/NO donors with recurring intent | ~1.4% | yes (agreement)
| Bank transfer  | Donor chose Bank; FI donor with no preference (zero-fee default) | €0 | no (reminder-driven)

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
verification, idempotency, audit logging, bundle activation, plaque
creation) runs exactly as in production.

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
cart's payment-method picker enables the MobilePay tile automatically
based on the same flag.

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
rather than silently activating adoptions).

## Recurring billing

Three paths, all production-wired:

- **MobilePay/Vipps**: native agreements. `createAgreement` returns a
  Vipps confirmation URL; on `recurring.agreement-activated.v1` the
  agreement id is stored in `Payment.providerCustomerId`. The
  `renewal` cron (daily 04:00 UTC) charges `chargeAgreement` for any
  adoption with `endsAt < now + 7d`. Failed charges write a failed
  `Payment` row and surface to dunning.
- **Paytrail tokenisation**: `createAgreement` POSTs `/payments` with
  `getToken: true`. The donor pays + opts into recurring in one step;
  the return URL carries `checkout-tokenization-id` which
  `parseWebhook` exchanges (via `POST /tokenization/{id}`) for the
  long-lived `token`. Renewals call `POST /payments/token/mit-charge`
  against that token. Refund callbacks land on the same
  `/webhooks/paytrail` endpoint via `PAYTRAIL_CALLBACK_URL`.
- **Bank transfer**: reminder-based. The renewal cron creates a
  pending Payment row with a fresh RF reference and emails the donor;
  the accountant's CSV upload reconciles the inbound SCT.

Dunning state machine (`apps/api/src/modules/jobs/processors/payment-retry.processor.ts`):
3d → 7d → 14d → 21d grace → cancel. Each escalation is a `chargeAgreement`
attempt for card / MobilePay rails; bank-transfer rails get a reminder
email per step until the accountant reconciles.

## Code that's already production-grade

- HMAC signature verification on every callback (Paytrail + MobilePay).
- Idempotent webhook handling via `(provider, providerEventId)` unique
  index on `ProcessedEvent`.
- One `prisma.$transaction` per webhook = payment update + adoption
  activation + audit log + plaque create all atomic.
- Bundle activation: every sibling `Adoption` sharing a `bundleId` flips
  to `active` on one event.
- Throttling on webhook routes (5000/min/IP).
- Recurring failure → adoption paused + `payment-retry` job enqueued.
- Receipts: enqueued after webhook commit; PDF + email handled by the
  worker.
- No PCI scope: Paytrail's hosted checkout owns card data; the api
  never sees PAN/CVV.
