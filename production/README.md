<div align="center">

# 🌱 BloomOulu — Production

**One self-hosted, open-source platform for the University of Oulu Botanical Garden:
donations + favourites · AI-grounded plant guide · immersive QR · live kiosk.**

[![License: MIT](https://img.shields.io/badge/License-MIT-A8C060.svg)](./LICENSE)
[![WCAG 2.2 AA](https://img.shields.io/badge/WCAG-2.2%20AA-5FB0A0)](https://www.w3.org/WAI/WCAG22/quickref/)
[![EAA 2025](https://img.shields.io/badge/EAA-2025-1F3C2D)](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/european-accessibility-act-eaa_en)
[![Languages: FI · SV · EN](https://img.shields.io/badge/i18n-FI%20·%20SV%20·%20EN-88A050)](./packages/i18n/messages)

</div>

## What this is

The production monorepo for the BloomOulu platform. Built on top of the
prototype in `demo-design/`, this version is:

- **End-to-end working**: web, API, admin panel, kiosk, payments, RAG chat — all wired.
- **Self-hosted and free**: every piece runs in Docker on a single VPS (~€5/month). No SaaS subscriptions. Open-source licences only.
- **Production-grade**: idempotent payment webhooks, audit log on every mutation, full observability (Prometheus + Grafana + Loki + Tempo), automated daily restic backups, GDPR-ready data export + erasure.
- **Operable by non-developers**: AdminJS-powered control panel where curators add plants, finance refunds donations, admins toggle features and edit translations — Moodle-style.
- **Finnish-payment-first**: **Paytrail** for cards + all FI banks + Apple/Google Pay + Klarna; **Vipps MobilePay** direct for native one-time MobilePay payments; **manual bank transfer with ISO 11649 RF references** for zero-fee donations.

## Quick start (local dev)

```bash
# 1. Clone + configure
cp .env.example .env
# Edit .env: set DATABASE_URL, AUTH_SECRET, etc. The defaults work for local dev.

# 2. Start everything (Postgres + Redis + Ollama + MinIO + LGTM + …)
docker compose --profile bootstrap up -d
# The bootstrap profile pulls the Ollama models on first run (~5 GB, one-time).

# 3. Install JS deps
pnpm install

# 4. Generate Prisma client + run migrations + seed
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed

# 5. Run web + api + admin in watch mode
pnpm dev
```

Open:
- Public site → http://localhost:3000
- API docs (Swagger) → http://localhost:4000/docs
- Admin panel → http://localhost:4100/admin
- Kiosk view → http://localhost:3100
- Grafana → http://localhost:3000 (admin / bloomoulu)
- MinIO → http://localhost:9001 (minioadmin / minioadmin)

## Production install on a single VPS

A Hetzner CX22 (4 vCPU / 8 GB / 80 GB SSD, ~€5/month) fits comfortably.

```bash
# On the server
ssh root@your-vps
apt update && apt install -y docker.io docker-compose-v2 git ufw
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

git clone https://github.com/your-org/bloomoulu.git /opt/bloomoulu
cd /opt/bloomoulu
cp .env.example .env
$EDITOR .env       # ← set production values (DOMAIN, IBAN, MOBILEPAY_*, etc.)

# Point your DNS A records at this VPS:
#   bloomoulu.fi, api.bloomoulu.fi, admin.bloomoulu.fi, kiosk.bloomoulu.fi,
#   grafana.bloomoulu.fi, errors.bloomoulu.fi, ntfy.bloomoulu.fi
# Caddy will auto-issue Let's Encrypt certs on first request.

docker compose --profile bootstrap up -d
docker compose exec api pnpm --filter @bloomoulu/db run migrate:deploy
docker compose exec api pnpm --filter @bloomoulu/db run seed
```

## Architecture

See [`docs/adr/`](./docs/adr/) for the full set of Architecture Decision
Records and [`docs/system-design.md`](./docs/system-design.md) for service
sequence diagrams. In one paragraph:

> Next.js 15 (web + kiosk) and NestJS 10 (api + admin) talk to a single
> Postgres 16 + pgvector database. Payments route through three rails: Paytrail
> (Finnish e-commerce standard, used by 6,500+ FI sites), Vipps MobilePay
> direct (native one-time MobilePay payments), and manual bank transfer
> with ISO 11649 RF references (zero fees, reconciled from camt.054 / CSV
> uploads by the accountant). The RAG chatbot runs entirely locally on
> Ollama (`llama3.1:8b` + `nomic-embed-text` + `bge-reranker-v2-m3`). The
> whole stack is one `docker compose up`.

## Configurability — admins control everything

After handover, every business decision is editable from the admin panel.
Engineers should not be re-deployed for any of these:

| What | Where in admin |
|---|---|
| Donation amounts (suggested chips, custom, min/max, dedication) | `/admin/pages/settings#donation` |
| Plant story, names, Red-List, photo, audio | `/admin/resources/Plant` |
| Every UI string in FI/SV/EN | `/admin/pages/translations` (Moodle-style bulk editor) |
| Email templates | `/admin/pages/emails` |
| Homepage hero, callouts | `/admin/resources/ContentBlock` |
| Donor wall — public dedications | `/admin/resources/Donation` |
| Payment providers (enable Paytrail / MobilePay / bank-transfer) | `/admin/pages/settings#payments` |
| Feature flags (kiosk, RAG, favourites, …) | `/admin/pages/settings#features` |
| VAT rates per line type | `/admin/pages/settings#vat` |
| Receipt numbering + branding | `/admin/pages/settings#receipts` |
| GDPR retention windows | `/admin/pages/settings#gdpr` |
| Webhook log + manual retry | `/admin/resources/ProcessedEvent` |
| Bank-transfer reconciliation (CSV upload) | `/admin/pages/reconciliation` |
| RAG corpus (upload curator notes, re-index) | `/admin/resources/RagDocument` |
| Audit log | `/admin/resources/AuditLog` |
| Trigger backup | `/admin/pages/backups` |

## Payments — three rails

### 1. Manual bank transfer (default, zero fees)

The donate flow generates an [ISO 11649 RF Creditor Reference](https://en.wikipedia.org/wiki/Creditor_Reference) for each donation:

```
RF18 5390 0754 7034   ← printable, self-checksummed
```

The donor's banking app supports this format natively. The Garden's
accountant exports a daily camt.054 / Tilisiirto CSV from Nordea / OP / your
bank, uploads it at `/admin/pages/reconciliation`, and the platform matches
RF references to pending `Payment` rows — succeeded payments fire the receipt
job automatically.

**Zero third-party fees.** Donor money goes 100% to plants.

### 2. Paytrail (Finnish e-commerce standard)

[Paytrail](https://www.paytrail.com/) covers — in one integration:

- All Finnish online-banking buttons (Nordea, OP, Danske, S-Pankki, Aktia, Ålandsbanken, POP Pankki, Säästöpankki, Oma Säästöpankki, Handelsbanken)
- Cards (Visa, Mastercard, Amex)
- MobilePay (one-off)
- Apple Pay, Google Pay
- Siirto (instant FI A2A)
- BNPL: Klarna, Walley

Used by 6,500+ Finnish sites. Authentication is HMAC-SHA256 over canonicalised
`checkout-*` headers + body. See `packages/payments/src/paytrail/gateway.ts`.

### 3. Vipps MobilePay (native one-time payments)

We integrate directly with the [Vipps MobilePay ePayment API](https://developer.vippsmobilepay.com/docs/APIs/epayment-api/)
so MobilePay donors approve a single payment in their app (biometric → SCA
satisfied). No recurring agreement is created — every donation is one-time.

## Plant data

Two ingest paths:

1. **Curated seed** — `packages/db/prisma/seed/finnish-flora.ts` ships ~10
   representative species (one per Red List category) so the demo works
   immediately. Wikimedia Commons CC-licensed images.

2. **Bulk ingest** — `scripts/ingest-flora.ts` pulls the full Finnish
   vascular plant flora (~2,667 species) from open data:

   ```bash
   pnpm tsx scripts/ingest-flora.ts --limit 2700
   # or, just one family for a quick test:
   pnpm tsx scripts/ingest-flora.ts --family Asteraceae --limit 50
   ```

   Sources (all CC / open):
   - [GBIF Species API](https://www.gbif.org/) — taxonomy + Finnish occurrences
   - [Wikidata](https://www.wikidata.org/) — FI / SV / EN common names
   - [Wikimedia Commons](https://commons.wikimedia.org/) — CC-licensed photos
   - [IUCN Red List](https://www.iucnredlist.org/) — global threat categories
   - [Suomen lajien uhanalaisuus 2019](https://punainenkirja.laji.fi/) — Finnish Red List

   New rows land with `status='hidden'`; curators review before publishing.

## Robustness — never fails

- **Idempotent webhooks** — every inbound event passes through `ProcessedEvent (provider, providerEventId)` unique index. Stripe-style replay storms book one row.
- **In-transaction audit log** — every mutation writes to `AuditLog` in the same DB transaction. No silent state drift possible.
- **Daily reconciliation cron** — verifies every `Payment.succeeded` of the last 30 days against the provider; flags `ReconciliationException` rows + P0 alert on mismatch.
- **Dead-letter queues** — BullMQ DLQ for every queue with admin-side requeue UI.
- **Circuit breakers** — `opossum` around every external call (Paytrail, MobilePay, Ollama, SMTP).
- **Daily encrypted backups** — `restic` to MinIO + weekly offsite snapshot.
- **Healthchecks + auto-restart** — every container has Docker HEALTHCHECK; Caddy retries unhealthy upstreams.
- **Alerts** — Prometheus rules → ntfy.sh push to curator + ops phone. P0 wakes people up; P1 is acknowledge-by-close-of-business; P2 weekly review.

## Observability

- **Metrics** — Prometheus + Grafana, dashboards committed at `infra/grafana/dashboards/`
- **Logs** — Loki (30-day retention), structured pino JSON
- **Traces** — Tempo via OpenTelemetry, 100% sampling on errors
- **Errors** — GlitchTip (FOSS Sentry alternative)
- **Alerts** — ntfy.sh (FOSS push notifications)
- **External uptime** — GitHub Action probes `/healthz` every 5 min

## Accessibility

WCAG 2.2 AA / EAA 2025 conformance enforced in CI:

- `axe-playwright` runs on every PR; serious violations block merge.
- `jsx-a11y` ESLint rules, no overrides.
- Keyboard-only path through the entire donate flow verified by Playwright.
- Reduced-motion + larger-text + high-contrast modes built in.
- Audio narrations have on-screen captions per locale.
- Skip-to-main-content link, `:focus-visible` outlines, semantic landmarks throughout.

External audits planned at launch, +3 months, +12 months (per ADR-0006).

## i18n

Three languages, end-to-end (UI, audio, captions, intent matching, receipts, emails):

- `packages/i18n/messages/{en,fi,sv}.json` — application strings
- `AudioNarration` table — per-plant per-locale narrations + WebVTT captions
- AskTheGarden — cross-lingual retrieval, locale-tagged answers
- Receipts + emails — locale-aware copy and number formatting

## Repo layout

```
production/
├── apps/
│   ├── web/                    # Next.js 15 public site (SSR + ISR + RSC)
│   ├── api/                    # NestJS API + workers + webhooks
│   ├── admin/                  # AdminJS admin panel
│   └── kiosk/                  # Next.js standalone kiosk app
├── packages/
│   ├── db/                     # Prisma schema + migrations + seeds
│   ├── payments/               # PaymentGateway port + Paytrail / MobilePay / bank-transfer adapters
│   ├── rag/                    # Embeddings + retrieval helpers
│   ├── ui/                     # Shared React components, design tokens
│   ├── i18n/                   # Locale messages
│   ├── emails/                 # MJML templates
│   ├── plant-data/             # Static reference data (Red List)
│   └── config/                 # Shared tsconfig, eslint
├── infra/
│   ├── docker/                 # Dockerfiles (api, web, admin, kiosk)
│   ├── caddy/Caddyfile         # Reverse proxy + auto TLS
│   ├── postgres/init.sql       # pgvector + ancillary DBs
│   ├── prometheus/             # Scrape config + alert rules
│   ├── loki/, tempo/, promtail/
│   └── restic/                 # Daily backup script
├── docs/
│   ├── adr/                    # Architecture Decision Records (10)
│   ├── system-design.md
│   ├── runbook/                # Per-alert playbooks
│   └── api/                    # OpenAPI exports
├── scripts/
│   └── ingest-flora.ts         # Pulls all Finnish flora from GBIF
├── docker-compose.yml          # Full self-hosted stack
└── .github/workflows/          # CI + deploy
```

## Sources & references

This implementation is grounded in current 2026 best practice:

### Payments
- [Paytrail Payment API](https://docs.paytrail.com/) — Finnish e-commerce standard
- [Vipps MobilePay ePayment API](https://developer.vippsmobilepay.com/docs/APIs/epayment-api/)
- [ISO 11649 RF Creditor Reference](https://www.finanssiala.fi/wp-content/uploads/2024/04/structure-of-the-rf-creditor-reference-iso-11649.pdf) — Finnish accounting standard
- [PSD2 SCA + Stripe exemption logic](https://stripe.com/guides/strong-customer-authentication)
- [Stripe webhook idempotency best practices](https://docs.stripe.com/webhooks)

### Tax + nonprofit
- [Income taxation of Finnish non-profit organisations (vero.fi)](https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/associations-and-foundations/income-taxation-of-non-profit-organisations/)
- [Finland corporate tax deduction for university donations (TVL §57)](https://taxsummaries.pwc.com/finland/corporate/deductions)
- [New 2026 individual donor tax-deduction scheme (EFA)](https://efa-net.eu/news/new-tax-deduction-system-for-donations-in-finland/)

### Accessibility
- [European Accessibility Act 2025](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/european-accessibility-act-eaa_en)
- [WCAG 2.2 AA quickref](https://www.w3.org/WAI/WCAG22/quickref/)

### Tech
- [Next.js 15 App Router + next-intl](https://next-intl.dev/docs/getting-started/app-router)
- [Ollama production self-hosted RAG (2026)](https://ragaboutit.com/how-to-build-a-production-ready-rag-system-with-ollama-and-local-llms-the-complete-self-hosted-enterprise-implementation-guide/)
- [pgvector + HNSW production RAG](https://github.com/pgvector/pgvector)
- [AdminJS 7](https://docs.adminjs.co/)
- [GBIF Species API](https://techdocs.gbif.org/en/openapi/v1/species)

## Acknowledgments

- **Team Meraki** — concept, research, design, build.
- **University of Oulu Botanical Garden** — domain expertise.
- **Botanical Garden Conservation International (BGCI)** + **LIFE+ ESCAPE** — conservation framing.

## Licence

[MIT](./LICENSE)
