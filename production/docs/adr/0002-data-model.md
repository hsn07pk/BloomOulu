# ADR-0002: Data Model

**Status:** Accepted
**Date:** 2026-05-13

## Context

The platform's domain is denser than it looks. Each *plant* in the catalogue is connected to:

- One or more **accessions** (the University's specimens, each with provenance, collection date, source population, propagation lineage).
- A **taxon** (canonical Latin name) with synonyms and a Red-List status that changes over time (we must retain history).
- **Citations** (peer-reviewed papers, internal reports, the Garden's care notes), which back the plant's narrative and AskTheGarden's answers.
- **Audio narrations** in three languages, each with a transcript and a captions track.
- A live **adoption ledger** (which donor adopted which plant, at which tier, when, how much remained, who got the printed plaque).

We chose a **relational** Postgres model with **pgvector** for embeddings. UUID v7 for primary keys (sortable, no enumeration). Soft deletes only where audit is mandatory.

## Decision

See `packages/db/prisma/schema.prisma` for the canonical definition. Highlights:

### Core entities

- **`Plant`** — public-facing entity, one per garden specimen displayed. Has `slug`, `latinName`, per-locale common names, `redListStatus` (enum: `LC | NT | VU | EN | CR | EX | DD | NA`), `bloomSeason`, `microCoordinates` (PostGIS `geography(Point, 4326)`).
- **`Accession`** — the physical specimen(s) behind a `Plant`. `accessionNumber` (e.g. `OULU-1998-0421`), `collectedAt`, `sourcePopulation`, `propagationLineage[]`.
- **`Taxon`** — the canonical scientific name + synonyms + family. Linked to `Plant` 1:1 with a history of name changes.
- **`Citation`** — DOI / ISBN / internal report ID, year, source.
- **`AudioNarration`** — locale, S3 URL, duration, transcript JSON (timed captions).

### Adoption + Payment

- **`Tier`** — `seedling | rooted | vulnerable | endangered | corporate` with prices keyed by `currencyCode` and `billingInterval`.
- **`Adoption`** — the act of adopting. Belongs to a `Donor` (User) and references a `Plant` and `Tier`. Holds `intent` (`for_self | gift | memorial | class`), `nickname`, `homeRegion` (for Internationalisation@Home), `recurring` (bool), `dedication` (text), `startedAt`, `endsAt`.
- **`Payment`** — one row per provider charge. References `Adoption` + `provider` enum (`stripe | mobilepay | manual_bank`) + `providerRef`, `amount`, `currency`, `status` (`pending | succeeded | failed | refunded`), `vatRate`, `vatAmount`, `netAmount`. Has a **unique** `providerEventId` column for webhook idempotency.
- **`Receipt`** — one per `Payment`, immutable once generated. Holds `pdfUrl`, `issuedAt`, `taxLineJSON` (full Finnish VAT breakdown).
- **`TaxCertificate`** — one per donor per tax year, summing all eligible donations for TVL §57 corporate deduction or the upcoming 2026 individual donor scheme.
- **`GiftCode`** — for gift / memorial / class adoptions, a short code the recipient redeems.
- **`Plaque`** — physical plaque allocations (Endangered tier and above). Has `engravedText`, `installedAt`, `installedBy` (staff user), `photoUrl`.

### RAG corpus

- **`RagDocument`** — title, sourceUrl, language, locale-tagged. Holds the full text (markdown).
- **`RagChunk`** — chunked text + `embedding vector(1024)` + a foreign key back to `RagDocument` + `tokenStart/End`.
- **`AskMessage`** + **`AskAnswer`** — every Q&A is persisted with the retrieved chunks + the final answer + emitted citations + reaction (`helpful | off_base | escalated`).

### Kiosk

- **`KioskDevice`** — name, location (`romeo_lobby | julia_lobby | ticket_hall`), `pairingToken` hash, last seen, current build SHA, healthcheck timestamp.
- **`KioskEvent`** — heartbeats + crash reports + watchdog reboots, for ops review.

### Audit + GDPR

- **`AuditLog`** — `actor` (user or `system`), `action`, `resource`, `before` + `after` JSON, ip, ua, occurredAt. Append-only.
- **`DataExportRequest`** — GDPR Article 15 (export).
- **`DataErasureRequest`** — GDPR Article 17 (right-to-be-forgotten). Has a state machine: `pending → verified → executing → completed`. We retain financial records under Finnish accounting law (6 years) but pseudonymise PII on completion.

## Consequences

**Positive**

- Soft-deleted Adoptions never lose receipts; finance audits pass.
- The `Payment.providerEventId` unique constraint gives us idempotency *at the database level* — if Stripe retries a webhook 50 times, we still book one row.
- pgvector co-located with the relational data means a single `JOIN` reaches from a chunk to its source `Plant`, which makes our citation contract trivially enforceable.

**Negative**

- The Audit log will be the largest table by row count within 18 months. We pre-partition by month and archive to S3 Glacier after 5 years (Finnish accounting retention = 6 years for receipts; AuditLog of access events can go to cold storage at 1 year).

## Migration / seeding

The prototype's `data.jsx` is converted to a Prisma seed (see `packages/db/seed/`) so the demo data lands intact on `pnpm db:seed`.
