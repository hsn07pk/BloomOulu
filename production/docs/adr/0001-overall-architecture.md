# ADR-0001: Overall Architecture for BloomOulu Production

**Status:** Accepted (revised 2026-05-13 — self-hosted, FOSS, zero-recurring-cost)
**Date:** 2026-05-13
**Deciders:** Team Meraki + University of Oulu Botanical Garden

## Constraints (hard requirements)

1. **Zero recurring software/SaaS cost.** Everything runs on infrastructure the Garden already owns (or can buy for a one-time fee — e.g. a Hetzner CX22 at ~€5/month or a donated lab server). No SaaS subscriptions, no per-API-call billing.
2. **Open-source only.** Every dependency must have an OSI-approved licence and a copy-left compatible licence where applicable. License inventory at `docs/licenses.md`.
3. **Production-grade robustness.** Payments are involved; downtime is reputational damage. Audit log on every mutation, full observability, automated backups.
4. **Operable by non-technical staff after handover.** Every business decision (prices, copy, languages, plant content, feature toggles, even the adopt flow steps) editable in an admin panel. No code change should be required for ordinary garden operations.
5. **Finnish data residency.** Every byte stays on hardware physically located in Finland (or, at minimum, the EU). GDPR DPIA-ready.

## Architecture

A single Docker Compose stack on one VPS (or two for HA), reverse-proxied by Caddy with free Let's Encrypt TLS.

```
                       ┌──────────────────────────────────┐
                       │       Caddy (reverse proxy)      │   Let's Encrypt
                       │ bloomoulu.fi · admin · *.kiosk   │   auto-renews
                       └──────────────┬───────────────────┘
                                      │
        ┌─────────────────┬───────────┴───────────┬────────────────┐
        ▼                 ▼                       ▼                ▼
   ┌─────────┐       ┌─────────┐            ┌──────────┐      ┌──────────┐
   │   web   │       │  admin  │            │   api    │      │  kiosk   │
   │ Next.js │       │AdminJS  │            │ NestJS   │      │ Next.js  │
   │   15    │       │ (Node)  │            │ Fastify  │      │ kiosk    │
   └────┬────┘       └────┬────┘            └────┬─────┘      └────┬─────┘
        │                 │                      │                 │
        └─────────────────┴──────────┬───────────┴─────────────────┘
                                     │
            ┌────────────┬───────────┼───────────┬───────────────┐
            ▼            ▼           ▼           ▼               ▼
       ┌────────┐  ┌──────────┐ ┌─────────┐  ┌──────────┐  ┌──────────┐
       │postgres│  │  redis   │ │  minio  │  │  ollama  │  │ glitchtip│
       │ 16 +   │  │ 7 (cache │ │ S3 API  │  │ llm +    │  │  errors  │
       │pgvector│  │  +queue) │ │ +backup │  │embeddings│  │  (FOSS)  │
       └────────┘  └──────────┘ └─────────┘  └──────────┘  └──────────┘

            ┌─────────────┬─────────────┬─────────────┐
            ▼             ▼             ▼             ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
      │prometheus│  │ grafana  │  │   loki   │  │  tempo   │
      │ metrics  │  │dashboards│  │   logs   │  │  traces  │
      └──────────┘  └──────────┘  └──────────┘  └──────────┘

      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │  ntfy    │  │ restic + │  │  postal  │
      │  alerts  │  │ B2/local │  │   SMTP   │
      │ (FOSS)   │  │  backups │  │  (FOSS)  │
      └──────────┘  └──────────┘  └──────────┘
```

Every box above is one Docker container. The whole stack starts with `docker compose up -d`. On a 4-core / 8 GB VPS it idles at ~1.5 GB RAM and handles the year-1 traffic projection (30k visitors, 100 adopters) with headroom.

## Stack — final picks

| Concern | Choice | Licence | Why |
|---|---|---|---|
| **Web framework** | **Next.js 15** (App Router + RSC + Server Actions) | MIT | SSR/SSG free; mature i18n via `next-intl`. |
| **API framework** | **NestJS 10 + Fastify adapter** | MIT | Modular, decorator-driven, OpenAPI generator, BullMQ adapter built in. |
| **Admin panel** | **AdminJS 7** + custom React resources | MIT | Drop-in CRUD against Prisma models, RBAC, file uploads. Custom resources for translation editor, content blocks, pricing, email templates, feature flags. |
| **DB** | **Postgres 16 + pgvector** (Docker) | PostgreSQL Licence | Single store for relational + vector. |
| **ORM** | **Prisma 5** | Apache 2.0 | Type-safe, transactional, migrations. |
| **Cache + queue** | **Redis 7** + **BullMQ** | Redis BSD-3 / BullMQ MIT | Free, well-tested. (DragonflyDB is API-compatible if scaling is ever needed.) |
| **Object storage** | **MinIO** | AGPL v3 | S3-compatible, self-hosted, GUI included. |
| **Reverse proxy + TLS** | **Caddy 2** | Apache 2.0 | Automatic Let's Encrypt, single-file config. |
| **Email** | **Postal** | MIT | Full SMTP/IMAP server; or smtp relay to ProtonMail/garden's existing university mailbox if preferred. |
| **PDF generation** | **`@react-pdf/renderer`** | MIT | Deterministic, Finnish-character-safe. |
| **LLM** | **Ollama** running **Llama 3.1 8B Instruct** (or **Mistral Nemo 12B** for stronger Nordic-language quality) | Apache 2.0 (Ollama), Llama Community Licence | Local, no API cost, GDPR-clean. |
| **Embeddings** | **Ollama** running **`nomic-embed-text-v2-moe`** | Apache 2.0 + nomic licence | Multilingual MoE, excellent on FI/SV/EN retrieval. |
| **Reranker** | **`bge-reranker-v2-m3`** via Python sidecar (`text-embeddings-inference`) | MIT | Multilingual, p95 reranker latency < 200ms on CPU. |
| **Search** | Postgres `pg_trgm` + full-text + pgvector hybrid | included | Avoid a separate ES. |
| **Maps** | **Leaflet** + OpenStreetMap | BSD-2 / ODbL | Free tiles. Self-hosted tile server (`openmaptiles`) optional for fully off-net. |
| **Weather** | **Open-Meteo** | CC BY 4.0 | Free, no key. |
| **Auth** | **Auth.js v5 (NextAuth)** | ISC | Email magic-link via Postal; OIDC for University staff. |
| **Observability** | **Prometheus + Grafana + Loki + Tempo** (LGTM stack) | Apache 2.0 / AGPL | Self-hosted. Dashboards JSON committed in `infra/grafana/dashboards/`. |
| **Error tracking** | **GlitchTip** | MIT | Sentry-API-compatible, self-hosted. |
| **Alerts** | **ntfy.sh** (self-hosted instance) | Apache 2.0 | Free push alerts to phones, Slack-compatible webhooks. |
| **Backups** | **restic** to MinIO + offsite to a second VPS / NAS | BSD-2 | Daily encrypted incremental, 30-day retention. |
| **CI** | **GitHub Actions** (free tier for public repo) or self-hosted **Forgejo Actions** | various | Build images, run tests, push to a private registry on the VPS. |
| **Container registry** | self-hosted **Docker Registry v2** | Apache 2.0 | Or push to ghcr.io free public. |

## Payments — three rails

1. **Manual bank transfer (default, zero fees).** Adopt flow generates a unique **RF Creditor Reference** (ISO 11649, alphanumeric). Donor's banking app already supports it. Garden's accountant downloads a daily camt.054 / Tilisiirto CSV from their bank, an admin job reconciles by RF reference, marks `Payment.status = succeeded`, fires the receipt job. **No third party touches the money.**
2. **Stripe (optional).** Toggleable per environment. If enabled, supports cards, SEPA, Klarna, Pay-by-Bank. Stripe charges ~1.4% + €0.25 per EU-card transaction — this is a per-transaction merchant fee, not a software subscription, and is opt-in.
3. **MobilePay (optional).** Toggleable. Native Recurring API for the annual/monthly cadence. Same caveat — per-transaction fees, opt-in.

The default install ships with only bank transfer enabled. Garden staff flip Stripe / MobilePay on in the admin panel when they sign their respective merchant agreements; the platform stays free to operate either way.

## Configurability — "edit everything from the admin panel"

Every business decision is data, not code:

| What the admin can change | Where it lives | Editor in admin panel |
|---|---|---|
| Tier names, prices, copy, perks | `Tier` table | Pricing editor |
| Plant story, names, Red-List, photo, audio | `Plant` + `PlantImage` + `AudioNarration` | Plant CRUD |
| UI strings (every label, FI/SV/EN) | `Translation` table (keyed by `i18nKey`) | Translation editor (search + bulk edit, Moodle-style) |
| Email templates | `EmailTemplate` table (MJML body + locales) | Template editor with live preview |
| Homepage content blocks | `ContentBlock` table (hero, callouts) | Block editor |
| Adoption flow steps + form fields | `FlowDefinition` JSON in `SystemSetting` | Flow editor |
| Payment providers (enable/disable Stripe, MobilePay) | `SystemSetting` | Toggle UI |
| Feature flags | `FeatureFlag` table | Toggle list |
| VAT rates per line type | `VatRule` table | VAT rule editor |
| Plaque engraving rules | `SystemSetting` | Form editor |
| Audit retention, GDPR auto-erasure window | `SystemSetting` | Settings |
| Receipt numbering, prefix, branding | `SystemSetting` + `SettingsBranding` | Branding editor |
| Donor wall display rules | `SystemSetting` | Toggle |

All `SystemSetting` values are typed (Zod-validated) and audited. Changes go through the same `AuditLog` pipeline so finance can trace exactly who changed which price at which time.

## Robustness — "never fails"

- Every mutation goes through a NestJS service → `db.$transaction()` → audit-log write in the same transaction.
- Every external call (Stripe, MobilePay, Ollama, Postal SMTP) has a circuit breaker (`opossum`) and a retry policy (`p-retry` with jitter).
- Every queue is a BullMQ queue with a **dead-letter queue** + retry exponential backoff + max 5 retries before manual review.
- Every webhook is idempotency-keyed by `ProcessedEvent (provider, providerEventId)` — DB-level uniqueness, not application-level.
- Every container has a HEALTHCHECK; `docker compose` restarts unhealthy ones.
- Caddy retries upstream connection failures up to 3 times with exponential backoff before returning 502.
- Postgres backups: nightly `pg_dump` to MinIO + WAL archiving for PITR; weekly `restic` snapshot to off-VPS storage.
- Prometheus alerts fire to ntfy.sh (the curator's phone) for: payment webhook failures, queue depth > 100, p95 latency > 1s, disk > 80%, certificate expiry < 14d.
- Quarterly chaos test: kill each container in turn, verify everything still works.

## Consequences

**Positive**

- ~€5–10/month total operating cost (VPS only). Donor money goes to plants, not vendors.
- One-binary-per-service makes onboarding new operators easy: "read the README, run `docker compose up`".
- Full audit trail + observability makes "the platform did X on date Y" provably-true for finance, IT audit, university procurement.

**Negative**

- We operate the hardware. We back up the database. Power outage at the data centre is our problem.
- The Ollama node needs ~6 GB RAM for Llama 3.1 8B; the VPS spec drives this.
- Local LLM quality < hosted frontier models. We mitigate by tight RAG grounding (citations enforced, low recall short-circuits).

**Mitigations**

- 2-server HA option in `infra/docker-compose.ha.yml`: primary DB + standby with streaming replication, Caddy on both, GeoDNS to the live one.
- Local LLM is swappable behind the `LLMClient` port — if a future budget allows a hosted LLM, change one line.
- Each ADR is a contract; deviating from a stack choice requires a new ADR superseding the old one.

## See also

- ADR-0002 Data model
- ADR-0003 Auth / authz
- ADR-0004 Payment provider abstraction + bank transfer flow
- ADR-0005 RAG pipeline (local LLM)
- ADR-0006 Accessibility + i18n
- ADR-0007 Admin panel (AdminJS)
- ADR-0008 Observability + alerts
- ADR-0009 Backups + disaster recovery
- ADR-0010 Plant data ingest (GBIF + Wikimedia + IUCN)
