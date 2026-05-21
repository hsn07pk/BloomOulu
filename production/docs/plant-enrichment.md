# Plant Enrichment — feature & handoff

**Audience:** whoever builds the plant CRUD in the admin panel (and their
Claude Code thread). This explains the on-demand enrichment feature so it can
be wired into the CRUD cleanly.

> Handoff note: this is a handoff aid. Fold the durable parts into
> `system-design.md` once the CRUD work lands; this file can then be removed.

## What it is

A curator opens a plant in the admin panel and clicks **Enrich** → a
background job fills the plant's **story**, **native origin**, **conservation
status**, and **photo** from open data, and records the result. **Fill-empty
by default** — it never overwrites a field a curator has already written.

Sources: Wikipedia (story), GBIF (origin), laji.fi / Finnish Red List
(status), Wikimedia Commons + iNaturalist (photo, re-hosted into our own
MinIO bucket).

## The single integration point

```ts
// exported from apps/api/src/modules/jobs/enqueue.ts
await enqueuePlantEnrich({ plantId, fields?, overwrite?, requestedBy? });
```

Whatever triggers enrichment — an admin action, an API endpoint, a create
hook — calls `enqueuePlantEnrich`. Everything downstream (fetch, DB write,
photo hosting, audit `JobRun`) is handled.

- `plantId` — required.
- `fields?` — `('story'|'origin'|'status'|'image')[]`; omit for all four.
- `overwrite?` — `false` (default) = fill empty fields only; `true` = replace.
- `requestedBy?` — admin user id, for the audit trail.

## File map

| Path | Role |
|---|---|
| `apps/api/src/modules/enrichment/` | The enrichment library. Entry point `enrichPlant(plantId, opts)`. |
| `  sources/{story,origin,redlist,image}.ts` | One open-data fetcher per field. |
| `  image-store.ts` | Downloads the photo, hosts it in the public MinIO bucket. |
| `  enrich-plant.ts` | Orchestrator — fetches, writes `Plant` + `PlantImage`. |
| `apps/api/src/modules/jobs/queues.ts` | `QUEUE_PLANT_ENRICH`. |
| `apps/api/src/modules/jobs/enqueue.ts` | **`enqueuePlantEnrich()`** — the trigger. |
| `apps/api/src/modules/jobs/processors/plant-enrich.processor.ts` | Runs `enrichPlant`, writes a `JobRun`. |
| `apps/api/src/worker.ts` | `plant-enrich` queue registered (concurrency 2). |
| `apps/admin/src/server.ts` | Plant resource: `enrich` + `enrichOverwrite` record actions, `enrichHandler`, `enrichQueue`. |

## Flow

```
Curator clicks "Enrich"  →  AdminJS action (enrichHandler)
  →  enqueue plant-enrich job (BullMQ)
  →  worker  →  processPlantEnrich  →  enrichPlant()
  →  writes Plant.{story,origin,redListStatus} + PlantImage + primaryImageId
  →  writes a JobRun row
Curator refreshes the edit form, or checks Operations → Job Runs.
```

## Wiring it into the plant CRUD

The "Enrich" actions are **already on the Plant resource** in
`apps/admin/src/server.ts`. Two things to keep in mind when you work on the
Plant CRUD:

**1. Keep the `actions` block.** The Plant resource's `actions` is now:

```ts
actions: {
  ...restrictTo(...CURATOR_OR_ADMIN),
  enrich: { ... },
  enrichOverwrite: { ... },
}
```

If you restructure the Plant resource, do **not** replace `actions` with a
bare `restrictTo(...)` — keep `enrich` / `enrichOverwrite`, plus the
`enrichHandler` function and the `enrichQueue` handle above it.

**2. (Recommended) Auto-enrich on create.** When a curator creates a new
plant, kick off enrichment automatically — they enter the basics, enrichment
fills the rest. Add an `after` hook to the Plant resource's `new` action:

```ts
new: {
  ...restrictTo(...CURATOR_OR_ADMIN).new,  // keep the existing access guard
  after: async (response, _request, context) => {
    const id = response?.record?.params?.id;
    if (id) {
      await enrichQueue.add(
        'enrich',
        { plantId: id, requestedBy: context.currentAdmin?.id ?? null },
        { jobId: `enrich-${id}`, removeOnComplete: true, removeOnFail: true },
      );
    }
    return response;
  },
}
```

Fill-empty makes this safe — if the curator typed a story in the create form,
enrichment leaves it alone.

**If your CRUD is API-driven** (not pure AdminJS — e.g. via the
`admin-plants` API module): call `enqueuePlantEnrich({ plantId })` from your
create/update handler. Same contract.

**Division of fields:** the CRUD form owns the *basics* (name, taxon, slug,
garden zone, funding target…). Enrichment owns the *open-data* fields (story,
origin, status, photo). They don't conflict — fill-empty keeps them
complementary.

## Requirements

- **The API worker must be running** — jobs are processed there (the
  `api-worker` service in `docker-compose.dev.yml`, or `node dist/worker.js`).
- **Redis** (queue) + **Postgres** (data) + **MinIO** (photo hosting) — all in
  `docker-compose.dev.yml`.
- Env (`.env`): `DATABASE_URL`, `REDIS_URL`, `S3_*`. Photo hosting uses a
  dedicated public bucket — `S3_PUBLIC_BUCKET` (default `bloomoulu-public`),
  created with a public-read policy on first run, separate from the private
  `bloomoulu-assets`.
- The web app already allowlists `localhost:9000` in `next.config.mjs`
  `images.remotePatterns`, so re-hosted photos render.

## Gotchas

- **Image hosting & Wikimedia rate limits:** enrichment downloads each photo
  once and re-hosts it into MinIO. One plant at a time is fine; *bulk*
  downloading from `upload.wikimedia.org` gets the IP 429-throttled. If image
  enrichment fails during heavy testing, that is the throttle, not a bug.
- **Idempotency:** `enqueuePlantEnrich` uses `jobId: enrich-<plantId>` — a
  double-click while a job is in flight is a no-op; the id frees on
  completion, so a deliberate re-enrich still works.
- **`enrichPlant` is resilient** — a field with no open data is recorded in
  the `JobRun` payload's `failed[]`; the other fields still apply.

## Not part of this feature

`production/scripts/enrich-*.ts` and `rehost-images.ts` are separate,
**one-time bulk-backfill** CLI tools (they download large data dumps). The
admin "Enrich" feature is the **on-demand, per-plant** path — same data
sources, different code path (live APIs, one plant, naturally
rate-limit-safe). Don't merge the two.

## How to test

- **Admin UI:** open a Plant → click "Enrich from open data" → wait ~30 s →
  refresh; check **Operations → Job Runs** for the result.
- **Programmatically:** `enrichPlant(plantId, { overwrite: true })` from a
  script run with `pnpm tsx --env-file=.env`.

## Status

All three layers — enrichment module, background job, admin action — built,
**typecheck-clean**, and **end-to-end tested** (enqueue → worker →
`enrichPlant` → `JobRun`). Verified: story / origin / status enrich and
persist correctly; photo resolution works; photo *hosting* works except when
the dev IP is Wikimedia-throttled (environmental, see Gotchas).
