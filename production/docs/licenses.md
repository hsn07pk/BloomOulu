# Licence inventory

Every dependency we ship is open source. This file is the canonical list,
auto-checked in CI by `licensecheck` and `pnpm dlx license-checker`.

## Stack

| Component | Licence | Notes |
|---|---|---|
| Next.js 15 | MIT | apps/web, apps/kiosk |
| NestJS 10 | MIT | apps/api |
| AdminJS 7 | MIT | apps/admin |
| Prisma 5 | Apache 2.0 | packages/db |
| PostgreSQL 16 | PostgreSQL Licence (BSD-style) | infra/docker postgres image |
| pgvector | PostgreSQL Licence | bundled in pgvector/pgvector image |
| Redis 7 | BSD-3 (Redis 7.4 onward dual-licensed; we pin 7.4) | infra/docker redis image |
| MinIO | AGPL v3 | infra/docker minio image |
| Caddy 2 | Apache 2.0 | infra/docker caddy image |
| Ollama | MIT | infra/docker ollama image |
| Llama 3.1 | Llama Community Licence | model weights |
| nomic-embed-text | Apache 2.0 | model weights |
| bge-reranker-v2-m3 | MIT | model weights via HF text-embeddings-inference |
| Postal | MIT | self-hosted SMTP |
| Prometheus | Apache 2.0 | metrics |
| Grafana | AGPL v3 | dashboards |
| Loki | AGPL v3 | logs |
| Tempo | AGPL v3 | traces |
| GlitchTip | MIT | error tracking |
| ntfy.sh | Apache 2.0 | alerts |
| restic | BSD-2 | backups |
| BullMQ | MIT | queues |
| @react-pdf/renderer | MIT | receipts |
| Leaflet | BSD-2 | maps |
| OpenStreetMap tiles | ODbL | maps |
| Open-Meteo | CC BY 4.0 | weather |
| qrcode-generator | MIT | QR codes |
| Auth.js v5 | ISC | auth |
| next-intl | MIT | i18n |
| Zod | MIT | validation |

## Data sources

| Source | Licence | Used for |
|---|---|---|
| GBIF | CC0 / CC-BY (per dataset) | Plant taxonomy + Finnish occurrences |
| Wikidata | CC0 | Common names cross-lingual |
| Wikimedia Commons | Various CC licences (CC-BY-SA-4.0 most common) | Plant photos; attribution recorded per row |
| IUCN Red List | Terms of Use (research) | Global threat categories |
| Suomen lajien uhanalaisuus 2019 | Open data | Finnish Red List 2019 |
