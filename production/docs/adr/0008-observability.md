# ADR-0008: Observability + Incident Response

**Status:** Accepted
**Date:** 2026-05-13

## Context

Payments are involved. The platform must never silently lose a donation, never double-charge, never let a receipt go unsent. We need to *prove* this to finance and to donors who write in asking.

## Decision

### Three pillars

1. **Metrics — Prometheus + Grafana.** Every service exports `/metrics` (NestJS via `@willsoto/nestjs-prometheus`, Next.js via custom instrumentation). Dashboards committed to `infra/grafana/dashboards/`:
   - **Business** — adoptions per day, revenue per provider, tier mix, donor cohort retention.
   - **Payments** — webhook success rate, processing latency, refund rate, agreement renewal rate, dunning success.
   - **Backend** — request rate, error rate, p50/p95/p99 latency per route.
   - **DB** — slow queries (>200ms), pgvector hit rate, connection pool saturation.
   - **Queues** — BullMQ depth, failed jobs, retry rate per queue.
   - **Infra** — CPU/RAM/disk/network per container.

2. **Logs — Loki.** Structured `pino` JSON logs from every service, shipped via `promtail`. Standard fields: `traceId`, `spanId`, `userId`, `orderId`, `plantId`. Retained 30 days.

3. **Traces — OpenTelemetry → Tempo.** Auto-instrumented for HTTP, Prisma, Stripe, BullMQ. Sampling: head-based 10% in steady state, tail-based 100% on errors. Every payment event has a complete trace from webhook → DB → receipt → email.

### Errors

**GlitchTip** (Sentry-API-compatible, FOSS) catches uncaught exceptions in web/api/admin + reports React error boundaries from the frontend. Alerting threshold: any new error class fires immediately.

### Alerts

Three tiers, all delivered via **ntfy.sh** (self-hosted instance pushed to curator + ops phones via Android/iOS app):

| Tier | Triggers | SLA | Receivers |
|---|---|---|---|
| **P0 — Wake people up** | Payment webhook failing for 5 min · DB down · disk >95% · TLS expiry <3d · audit-log gap detected | < 5 min | All admins + on-call rotation |
| **P1 — Acknowledge before close-of-business** | Webhook retries > 10/hour · queue depth > 100 · p95 latency > 2s · GlitchTip new error · failed backup | < 4 h | Lead operator + ops channel |
| **P2 — Review weekly** | Slow query · low pgvector hit rate · MobilePay agreement renewal failures > 10% · low NPS reaction on AskTheGarden | weekly | Ops review meeting |

Each alert links to the relevant Grafana dashboard + the runbook entry.

### Healthchecks

Every container has a Docker HEALTHCHECK. The api exposes `/healthz` (process up, DB reachable, Redis reachable, MinIO reachable, Ollama reachable). Caddy is configured to mark a backend unhealthy after 3 consecutive failed checks.

External uptime monitoring: a tiny GitHub Action runs every 5 min hitting `https://bloomoulu.fi/healthz` from outside; if it fails twice, ntfy alert fires.

### Audit log

The single most important table. Every mutation across web/api/admin/jobs lands in `AuditLog` *in the same database transaction* as the business change. We expose it in the admin panel with filter-by-user, filter-by-resource, time range, and a daily "audit gap" check job that compares row counts day-over-day and alerts if a day has < 30% of the 30-day median.

### Reconciliation

Daily cron at 03:00 UTC:

- For every `Payment` with status `succeeded` in the last 24h, verify the corresponding provider record (Stripe API or MobilePay API or bank CSV row) exists and amounts match. Discrepancies create a `ReconciliationException` row + P0 alert.
- For every `Payment.pending` older than 24h, mark `failed` and notify the donor with a "your payment didn't go through, here's a fresh link" email.

## Consequences

**Positive**

- We can prove the integrity of every payment trail.
- Every alert is actionable; no noisy/false alarms (we tune thresholds quarterly).
- The audit log + reconciliation cron together catch the "silent loss" failure mode that scares finance the most.

**Negative**

- LGTM stack uses ~1.5 GB RAM. We accept this for the visibility it gives.
- ntfy.sh requires a self-hosted node + a TLS cert; Caddy handles both.

## Runbooks

`docs/runbook/` contains per-alert playbooks:

- `payment-webhook-failing.md`
- `db-down.md`
- `disk-full.md`
- `tls-near-expiry.md`
- `mobilepay-outage.md`
- `stripe-outage.md`
- `ollama-down.md`
- `audit-gap.md`
- `reconciliation-mismatch.md`
- `kiosk-offline.md`
- `restore-from-backup.md`
