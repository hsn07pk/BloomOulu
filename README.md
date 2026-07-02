# BloomOulu

Digital platform for the University of Oulu Botanical Garden, built by Team Meraki at GrowthHack 2026. The repository holds two parts:

- `demo-design/`: the original static prototype, live at [bloom-oulu.vercel.app/demo-design/](https://bloom-oulu.vercel.app/demo-design/)
- `production/`: a pnpm + Turborepo monorepo (Next.js web and kiosk, NestJS API, AdminJS panel, Postgres + pgvector) that implements the platform end to end

## Live demo

[bloom-oulu.vercel.app/demo-design/](https://bloom-oulu.vercel.app/demo-design/)

Things to try:

- Scan the kiosk QR code with a phone; it deep links to a plant page through the URL hash (`#plant=puls-pat`)
- Switch language in the top bar; UI strings, audio narration, and on-screen captions change together
- Open a plant page and toggle Kid mode or School mode (reading levels, quiz, printable worksheet)
- Press "Show on map" for a Leaflet pin on OpenStreetMap tiles
- Open the accessibility panel (bottom left) for larger text, high contrast, and reduced motion

## Repository layout

```
BloomOulu/
├── index.html           # redirects to /demo-design/
├── vercel.json          # cleanUrls + cache headers for the demo
├── Dockerfile           # nginx image for serving the demo locally (port 8080)
├── docker-compose.yml   # demo on :8080, hot-reload variant on :8081
├── environment.yml      # conda env with ffmpeg/pillow for regenerating assets
├── demo-design/         # static prototype (React via Babel standalone)
└── production/          # pnpm + Turborepo monorepo
    ├── apps/            # web, api, admin, kiosk
    ├── packages/        # db, rag, payments, emails, i18n, ui, constants, config
    ├── infra/           # Caddy, Prometheus, Grafana, Loki, Tempo, reranker, restic
    └── docs/            # 11 ADRs, system design, runbooks, DPIA, security audit
```

## The prototype (demo-design/)

A self-contained static site: React 18 loaded through Babel standalone, no bundler, no npm install. Each screen is a `.jsx` file evaluated in the browser.

- Six screens: discover, plant detail, adopt, AskTheGarden chat, my garden, and lobby kiosk (`screens-*.jsx`)
- Hash-based routing with per-plant deep links; the kiosk QR encodes the same hash (qrcode-generator, error correction level H)
- Leaflet 1.9.4 with OpenStreetMap tiles for plant positions inside the garden
- Live Oulu weather from the Open-Meteo forecast API, no API key
- Eight species, each with three Wikimedia Commons photos (per-image attribution in `plants/CREDITS.md`) and 24 audio narrations (8 plants x 3 languages) under `audio/`
- Finnish and Swedish UI strings in `translations.jsx`, English inline
- Skip link, ARIA landmarks, focus-visible outlines, reduced-motion support, larger-text and high-contrast toggles; targets WCAG 2.2 AA

Run it locally any of three ways:

```bash
docker compose up -d          # nginx, http://localhost:8080/
# or
conda env create -f environment.yml && conda activate bloomoulu && python -m http.server 8000
# or
python3 -m http.server 8000   # then open /demo-design/
```

## The production monorepo (production/)

Requires Node >= 20.11 and pnpm >= 9. Four apps and eight workspace packages, orchestrated by Turborepo.

### Apps

| App | Stack | What it does |
|---|---|---|
| `apps/web` (:3000) | Next.js 15, next-intl, next-auth, react-leaflet | Public site: locale-prefixed routes for the plant index and detail pages, donation flow, AskTheGarden chat, favourites, donor wall, profile, sign-in with email plus a University of Oulu SSO route, receipt and tax certificate PDF endpoints, GDPR export/erase API routes |
| `apps/api` (:4000) | NestJS 10 on Fastify, Prisma, BullMQ, Swagger | REST API plus a separate worker process; modules for plants, donations, payments, webhooks, disbursements, reconciliation, ask (RAG), narration, enrichment, Instagram feed, quiz, kiosk, GDPR, audit, auth, translations, settings |
| `apps/admin` (:4100) | AdminJS 7 on Fastify | Curator and finance panel: plant tools, bulk add, QR label printing, translations editor, bank reconciliation, enrichment review, payment provider config, backups, observability |
| `apps/kiosk` (:3100) | Next.js 15 | Lobby display with an Open-Meteo weather pill and a scannable deep-link QR |

### Packages

| Package | Contents |
|---|---|
| `packages/db` | Prisma schema (44 models) on Postgres 16 + pgvector, 25 migrations, seed data for Finnish flora |
| `packages/rag` | Chunking, Ollama embeddings, reranker client, ingest CLI, corpus files |
| `packages/payments` | Paytrail, Vipps MobilePay, and bank transfer gateways behind a provider router, each with vitest specs; bank transfers use ISO 11649 RF creditor references matched during CSV reconciliation |
| `packages/emails` | Email templates plus PDF renderers for adoption certificates, tax certificates, disbursement reports, and quarterly CSR summaries |
| `packages/i18n` | next-intl message catalogues for en, fi, sv |
| `packages/ui`, `constants`, `config` | Shared components, shared enums, lint and formatting config |

### RAG pipeline

The AskTheGarden chat (`apps/api/src/modules/ask/ask.service.ts`) answers from the garden's own corpus:

1. Guardrail and intent classification; common intents get template answers without touching the LLM
2. The query is embedded with `nomic-embed-text:v1.5` on a local Ollama instance
3. Hybrid retrieval in Postgres: pgvector cosine search (HNSW index), tsvector full text, and pg_trgm trigram matching, fused with reciprocal rank fusion
4. Candidates are reranked by a FastAPI sidecar running the `BAAI/bge-reranker-v2-m3` cross-encoder (`infra/reranker/`)
5. The answer streams from a local Ollama model (default `llama3.2:1b`), with citations persisted per answer; `USE_HOSTED_LLM` swaps in a hosted model

### Background jobs

Fifteen BullMQ processors handle receipts, bank reconciliation, monthly disbursements, annual tax certificates, plant enrichment (images, origin, red-list status, stories), RAG ingest and evaluation, Instagram sync, GDPR export and erasure, data retention, kiosk watchdog checks, and audit gap detection.

### Infrastructure and operations

- Caddy for TLS termination, with compose files for local, VPS, and CSC cPouta deployments (`docker-compose.yml`, `docker-compose.csc.yml`, `infra/cloud-init.cpouta.yaml`)
- Prometheus + Alertmanager, six Grafana dashboards, Loki + Promtail logs, Tempo traces, OpenTelemetry instrumentation in the API
- Nightly restic backups (`infra/restic/run-backup.sh`) and a restore runbook
- Runbooks for deploys, DNS/TLS, university SSO, payment webhook failures, and chaos drills under `docs/runbook/`
- Architecture decision records (11) in `docs/adr/`, plus a DPIA and security audit in `docs/compliance/`

### Running it

```bash
cd production
cp .env.example .env                     # defaults work for local dev
docker compose --profile bootstrap up -d # Postgres, Redis, Ollama, MinIO, observability
pnpm install
pnpm db:generate && pnpm db:migrate:dev && pnpm db:seed
pnpm dev                                 # web :3000, api :4000 (/docs), admin :4100, kiosk :3100
```

### Testing

- Unit and integration tests with vitest: payment gateways, webhook idempotency, Instagram sync, tax certificates
- Playwright accessibility spec with axe-core
- k6 load test script (`scripts/loadtest.k6.js`)
- Workflow definitions under `production/.github/workflows/` cover lint, typecheck, tests, and build

```bash
pnpm test        # turbo run test across the workspace
pnpm test:e2e
```

## Internationalisation and accessibility

English, Finnish, and Swedish throughout: UI messages (`production/packages/i18n/messages/`), demo audio narration and captions, and chat intent matching. Both the prototype and the web app target WCAG 2.2 AA; the API test suite includes an axe-based Playwright spec.

## Attribution

- Plant photos from Wikimedia Commons under Creative Commons licences; per-image credits in `demo-design/plants/CREDITS.md`
- Map tiles (c) OpenStreetMap contributors
- Weather data from Open-Meteo (CC BY 4.0)

## License

MIT, see [LICENSE](./LICENSE).
