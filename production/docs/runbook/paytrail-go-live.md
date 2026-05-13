# Runbook — Paytrail production go-live

**Owner:** Garden director (KYC) + engineering lead (config)
**Time budget:** Paytrail's KYC takes 1–2 weeks. Engineering config: 1 hour.

## 0. Pre-requisites

- A Finnish business account (Y-tunnus). The University of Oulu's Y-tunnus
  works for the Garden's adoption flow.
- A bank account in the Garden's name where Paytrail will settle.
- Verified contact (the garden director or accountant) with personal
  Finnish bank ID (verkkopankki-tunnukset) for KYC.

## 1. Register the merchant

1. Go to https://www.paytrail.com/ and click *Tee sopimus / Sign up*.
2. Fill in the company details. Use the University of Oulu's legal name and
   Y-tunnus 0245259-2 (or the Garden's separate entity if used).
3. Select the **e-commerce** product. Tick all rails you want enabled:
   cards, FI online-banking buttons, Apple Pay, Google Pay, MobilePay
   (one-off), Siirto, Klarna.
4. KYC verification — the contact person signs with verkkopankki-tunnukset.
   Paytrail responds within 2–10 business days.

## 2. Receive production credentials

Paytrail emails the merchant portal login. There you'll find:

- `merchantId` (numeric)
- `secret` (32-byte hex, base64)
- The webhook signing secret is the same `secret`.

**Treat as a top-secret.** Don't email it, don't paste it into Slack.

## 3. Configure BloomOulu

Production environment uses Doppler (or SOPS+age for the self-hosted
alternative). Set:

```
PAYTRAIL_MERCHANT_ID=<numeric>
PAYTRAIL_SECRET=<base64 secret>
PAYTRAIL_API_URL=https://services.paytrail.com   # default; keep this
PAYTRAIL_RETURN_URL=https://bloomoulu.fi/fi/donate/complete
PAYTRAIL_CALLBACK_URL=https://api.bloomoulu.fi/webhooks/paytrail
```

Roll the running api + worker containers so they pick up the new env:

```bash
docker compose --profile prod up -d --force-recreate api worker
```

## 4. Register the webhook URL in Paytrail's portal

1. Sign in to the merchant portal.
2. *Settings → Callback URLs* → add
   `https://api.bloomoulu.fi/webhooks/paytrail`.
3. Save. Paytrail will send a test event; check `pnpm logs api | grep paytrail`
   — you should see a 200.

## 5. Enable the rail

In `/admin/pages/settings`:

- Set `payments.paytrail` = `true`.
- Optional: set `features.payByBank` = `true` if Paytrail confirmed your
  merchant has Pay-by-Bank enrolment.

Settings reload within 60 s without restart.

## 6. Smoke test

1. From a clean browser session, go to `https://bloomoulu.fi/fi/adopt?plant=…`.
2. Pick a tier, select **Card / pankki** as the payment method.
3. Complete a real €25 donation with your own card.
4. Verify within 2 min:
   - `/admin/resources/Payment` shows `status=succeeded`, provider=paytrail.
   - `/admin/resources/Receipt` shows `BLO-2026-XXXXXX` with a non-null `pdfUrl`.
   - Your inbox has the receipt PDF.
   - `/admin/resources/AuditLog` shows `payment.succeeded` + `payment.initiate`.
5. From the merchant portal, refund the €25 to yourself. Verify:
   - Refund webhook fires.
   - `Payment.status=refunded`, `Adoption.status=cancelled`.
   - Credit-note email arrives.

## 7. Done

If steps 1–6 succeed, Paytrail is live. The `payments.paytrail` flag is the
single kill-switch — flip it off and new adoptions skip the rail; in-flight
payments still settle.

## Rollback

If something goes wrong in step 6 (e.g. webhook signature mismatch):

1. `payments.paytrail` = `false` immediately (admin panel; takes < 60 s).
2. Open an issue in `docs/runbook/payment-webhook-failing.md`.
3. Manual reconcile any in-flight Payment rows via the daily reconciliation
   cron (3am UTC) or trigger it ad-hoc:
   ```bash
   docker compose exec api node dist/scripts/reconcile-once.js
   ```
4. Refund the donor out-of-band from the Paytrail portal and email them.
