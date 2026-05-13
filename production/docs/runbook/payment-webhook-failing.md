# Runbook — Payment webhook failing

**Alert:** `PaymentWebhookFailing` (P0)
**Trigger:** > 6 failed webhook attempts in 5 min, sustained.

## Immediate triage (5 min)

1. Open Grafana → "Payments" dashboard → "Webhook success rate" panel.
2. Identify the failing provider (Paytrail, MobilePay, or bank_transfer).
3. Check `errors.bloomoulu.fi` (GlitchTip) for stack traces.

## Common causes

| Symptom | Likely cause | Fix |
|---|---|---|
| All Paytrail webhooks failing with "signature mismatch" | Paytrail secret rotated | Update `PAYTRAIL_SECRET` in `.env`, `docker compose restart api` |
| Sudden 100% MobilePay failure | Access token expired and refresh failing | Check `MOBILEPAY_CLIENT_ID/SECRET`; verify `https://api.vipps.no/accesstoken/get` reachable |
| Mixed providers, increased latency | Postgres saturated | Check Prisma connection pool metrics; consider scaling |
| Specific orders failing repeatedly | Bad payload (orderId malformed) | Read `ProcessedEvent.payloadDigest` in admin |

## Recovery

1. Once root cause fixed, replay queued retries:
   ```bash
   docker compose exec api node -e "require('./dist/scripts/replay-webhooks.js')"
   ```
2. Verify reconciliation cron picks up missed events at 03:00 UTC.
3. If donor-impacting, draft an apology email via the Email queue.

## Post-incident

- File a blameless postmortem in `docs/postmortems/`.
- If signature-mismatch: rotate secret in Doppler and update runbook timestamp.
- If provider-side: subscribe to their status page if not already.
