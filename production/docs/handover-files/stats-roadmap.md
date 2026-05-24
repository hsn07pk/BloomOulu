# Public stats — roadmap & infrastructure map

**Audience:** anyone planning to surface engagement / activity / mission
stats on the public site, donor dashboard, kiosk, or admin panel.
Captures both the broader plan and what shipped in Phase 1 so the next
ticket (or Claude thread) doesn't have to re-discover any of it.

> Handoff note: durable parts fold into `system-design.md` once Phases 2+
> land; this file can then be removed.

## Phase 1 — what shipped (2026-05-24)

The homepage hero strip used to read:

```
[live plant count] · 175 (LIFE+ESCAPE) · 1.7M (LIFE+ESCAPE) · 56% (LIFE+ESCAPE)
```

Now reads:

```
[live plant count] · [live adoptions] · [live € raised] · 56% (LIFE+ESCAPE)
```

Three live engagement tiles + one mission anchor. The 56% ex-situ
coverage stat stays because LIFE+ESCAPE is the conservation narrative
this whole project sits inside; dropping it would lose the *why*.

### Implementation

| Piece | Path | Notes |
|---|---|---|
| Endpoint | `apps/api/src/modules/stats/stats.module.ts` | `GET /v1/stats/homepage` → `{ plantCount, adoptionCount, raisedCents, asOf }`. Three parallel queries against the partial indexes on `Plant.status`, `Adoption.status`, `Payment.status`. Single-digit ms even at scale. |
| Wired in | `apps/api/src/app.module.ts` | `StatsModule` added to the global imports list. |
| Consumer | `apps/web/src/app/[locale]/page.tsx` | `fetchHomepageStats()` runs in parallel with `fetchInitialPlants()`. Stats cached at the Next.js layer (`next: { revalidate: 300 }`) — 5 min freshness, instant SSR. |
| Currency formatting | Same file, `formatEur(cents, locale)` | Uses `Intl.NumberFormat` with `style: 'currency'`. Renders `€1,266` in en and `1 266 €` in fi/sv automatically (no manual symbol positioning). |
| Locale labels | Inline in the hero map | en / fi / sv literals. Could be moved into the `Home` i18n namespace later if the marketing team starts editing them. |

### Why a separate `StatsModule` and not adding to `PlantsModule`?

Public stats can fan out across many entities (plants, adoptions,
payments, scans, ask-messages) — they're not "plants" semantically.
Keeping a dedicated module lets the controller stay flat, makes
permissions / rate-limiting decisions per-endpoint, and avoids
PlantsController growing into a god-controller.

Admin / operator stats live separately in
`apps/api/src/modules/admin-plants/admin-metrics.controller.ts` (QR
funnel, top-scanned, daily timeline). Don't merge the two — admin can
do heavier work behind auth + the IP allowlist; public stats must stay
cheap and PII-free.

## What's already collected (you can surface without new schema)

The codebase has a surprisingly rich event-log layer. Most stats people
would want are derivable from what we already track:

| Event | Table | Captured fields |
|---|---|---|
| QR scans | `PlantScan` | `scannedAt`, `plantId`, `locale`, `kioskId?`, `visitorHash` (SHA256(ip\|ua), anonymized) |
| Ask the Garden Q&A | `AskMessage` + `AskAnswer` + `AskAnswerCitation` | Intent classification, latency, tokens, retrieved chunk IDs, reaction (helpful / off_base / escalated) |
| Quiz attempts | `QuizAttempt` | `plantId`, `score`, `durationMs`, `locale` |
| Plant saves | `SavedPlant` | `userId`, `plantId`, `note` |
| Kiosk health | `KioskEvent` | `deviceId`, `kind` (heartbeat / crash / reboot / qr_scan / error), `payload` |
| System audit | `ObservabilityEvent` | `severity`, `source`, `traceId`, `userId?`, `durationMs`, `details` |
| Adoptions | `Adoption` | `userId`, `plantId`, `amountCents`, `status`, `intent`, `tier`, `createdAt` |
| Payments | `Payment` | `amountCents`, `status` (succeeded / pending / failed / refunded / cancelled / requires_action) |

Denormalized counters on `Plant`: `adopterCount`, `scanCount`,
`fundedCents`, `targetCents`. Source of truth is the event tables;
counters get bumped transactionally on insert.

## Suggested stats by audience / page

Effort: 🟢 small (a few hours) · 🟡 medium (half day) · 🔴 large (day+).

### 🌐 Homepage (public)

| Stat | Source | Effort | Status |
|---|---|---|---|
| Plants in collection | `Plant.count(status=active)` | 🟢 | ✅ Phase 1 |
| Adoptions to date | `Adoption.count(status=active)` | 🟢 | ✅ Phase 1 |
| € raised | `Payment.sum(amountCents, status=succeeded)` | 🟢 | ✅ Phase 1 |
| Mission stat (56% ex-situ) | Hardcoded — external LIFE+ESCAPE figure | 🟢 | ✅ Kept |
| "X scans today/this week" | `PlantScan.count(scannedAt >= …)` | 🟢 | Backlog |
| "Most-asked plant this week" | Aggregate `AskAnswer` over linked plants | 🟡 | Backlog |
| Latest adoption ticker (anonymized) | `Adoption order by createdAt desc limit 1` | 🟢 | Backlog |

### 🌱 Plant detail page

| Stat | Source | Effort | Status |
|---|---|---|---|
| Scans (lifetime) | `Plant.scanCount` | 🟢 (already there) | Backlog |
| Save count | NEW `Plant.saveCount` (denormalize via `SavedPlant` rollup) | 🟢 | Backlog |
| Last adopted | `Adoption.max(createdAt) where plantId=?` | 🟢 | Backlog |
| "X people asked about me" | Link `AskAnswer` ↔ plant via citations or latin-name match | 🟡 | Backlog |
| Avg donation amount | `Adoption.avg(amountCents) where plantId=?` | 🟢 | Backlog |
| Funding progress bar | `Plant.fundedCents / Plant.targetCents` | 🟢 (already there) | Backlog |

### 📋 Plants index (`/plants`)

| Stat | Source | Effort | Status |
|---|---|---|---|
| "Most adopted" sort | already sorted this way | 🟢 | ✅ Done |
| "Most scanned this week" sort | new sort using `PlantScan` aggregate | 🟡 | Backlog |
| 🔥 "Trending" badge | recent scan growth vs baseline | 🟡 | Backlog |
| "New this week" filter | `Plant.createdAt >= …` | 🟢 | Backlog |

### 🤖 Ask the Garden

| Stat | Source | Effort | Status |
|---|---|---|---|
| "X questions answered this week" | `AskAnswer.count(createdAt >= …)` | 🟢 | Backlog |
| Avg answer time | `AskAnswer.avg(latencyMs)` | 🟢 | Backlog |
| "Top 5 questions" | `AskMessage` aggregate by intent + text cluster | 🟡 | Backlog |
| "Sources used: N" per answer | `AskAnswerCitation` count | 🟢 (already there) | Backlog |
| Per-answer "X people asked similar" | Semantic similarity over embeddings | 🔴 | Backlog |

### 👤 My Garden (logged-in donor)

| Stat | Source | Effort | Status |
|---|---|---|---|
| Your contribution: €X across N plants | sum + count of user's `Adoption` | 🟢 | Backlog |
| "Top X% of donors" | Percentile rank over `Adoption.amountCents` | 🟢 | Backlog |
| Tier upgrade preview | "If monthly €Y you'd be at tier T" | 🟢 | Backlog |
| Plants you scanned but haven't adopted | join `PlantScan` ⋈ `Adoption` for this `userId` | 🟢 | Backlog |
| Months since last gave | `now - max(Adoption.createdAt)` | 🟢 | Backlog |

### 🖥️ Kiosk (touchscreen)

| Stat | Source | Effort | Status |
|---|---|---|---|
| "Most scanned today" rotating | `PlantScan` today group by plant | 🟢 | Backlog |
| "Adopted in last hour" banner | `Adoption.where(createdAt >= now()-1h)` | 🟢 | Backlog |

### 👨‍🌾 Admin (curator)

| Stat | Source | Effort | Status |
|---|---|---|---|
| QR scan funnel | `/v1/admin/metrics/funnel` | 🟢 | ✅ Already there |
| Top-scanned plants | `/v1/admin/metrics/qr` | 🟢 | ✅ Already there |
| High-scan-low-adopt plants | `scanCount` / `adopterCount` ratio | 🟢 | Backlog |
| Plants with broken / missing images | NULL `primaryImage` + 404 detection sample | 🟡 | Backlog |
| Low-confidence RAG answers | `AskAnswer.where(reaction=off_base)` | 🟢 | Backlog |
| Enrichment queue depth + age | `EnrichmentSuggestion.where(status=pending)` count + age | 🟢 | Backlog |

## Three implementation patterns to keep using

### Pattern A — pure surfacing (zero new infra)

When the data is already in DB, just add a public endpoint that
aggregates it. Phase 1 is the template — see `stats.module.ts`. Three
parallel queries, single round-trip to the client, Next caches it for
5 min.

### Pattern B — denormalized counters

When a stat is on the public plant card render path (renders per row
in a 24-card grid), don't do `count()` per card — denormalize.
Mirror how `Plant.scanCount` already works: bump it in the same
transaction that inserts the event. Worth doing for `saveCount`, not
worth for stats only seen on detail pages.

### Pattern C — cron rollups for time-windowed stats

For anything like "trending this week" or "top 10 this month" that
needs aggregations over event tables, add a BullMQ cron processor
that computes the rollup every N minutes and writes to a small
denormalized table (e.g. `PlantTrending { plantId, scans24h, scans7d,
asks7d, computedAt }`). Public endpoints read from there.

Don't recompute on every request — `PlantScan` will be the hottest
table once QR adoption picks up.

### Pattern D — opt-in page view tracker (the one missing piece)

Today we have `PlantScan` (physical QR scan) but no `PlantView`
(clicked a plant card on the web). Adding one would unlock real
engagement signals (vs scan-only signals). Skeleton:

```prisma
model PlantView {
  id           String   @id @default(...)
  plantId      String
  viewedAt     DateTime @default(now())
  locale       String
  source       String   // 'organic' | 'qr' | 'search' | 'card-click'
  visitorHash  String   // same anonymization as PlantScan
}
```

GDPR-clean by construction (no IP / UA stored). The fire-and-forget
beacon pattern from `PlantsController.recordScan` is the template.

## Privacy notes (this is for Finnish + EU traffic)

- Every event table uses `visitorHash = SHA256(ip|ua)` for cookie-less
  anonymization. Any new event table MUST follow the same — do NOT
  store raw IP or UA.
- "X people did Y" stats are always aggregates. No per-user
  disclosure on public endpoints.
- GDPR data-export + erase jobs (`gdpr-export.processor.ts`,
  `gdpr-erase.processor.ts`) need to be extended whenever a new event
  table is added that ties to `userId` — otherwise a delete-me request
  won't fully clean up.

## Suggested next phase

The biggest gap right now is **per-plant engagement on the plant
detail page** — donors land there from a QR scan or homepage click,
and there's nothing telling them "this plant is interesting / popular
/ recently asked-about". Phase 2 candidate:

1. Surface `Plant.scanCount` (already in DB) as "👁 N visits"
2. Denormalize `Plant.saveCount` from `SavedPlant` rows (Pattern B)
3. Add "Last adopted: N days ago" via a new `Adoption` aggregate query
4. Add `Plant.askCount` denormalized — bump on every successful
   `AskAnswer` that retrieves a chunk linked to that plant

About a half-day's work, big donor-decision impact, no new event
collection needed.
