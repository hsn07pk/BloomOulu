# ADR-0010: Plant data ingest

**Status:** Accepted
**Date:** 2026-05-13

## Decision

Two ingest paths cover the spectrum from "demo works" to "every Finnish vascular plant":

### 1. Curated seed — `packages/db/prisma/seed/finnish-flora.ts`

Ships ~25 hand-curated species across the Red List spectrum (CR / EN / VU / NT / LC / NA / EX) with:

- Verified Finnish + Swedish + English common names.
- Wikimedia Commons CC-BY / CC-BY-SA image URLs with per-image attribution.
- 80–120-word stories in each language.
- Accession numbers matching the prototype's `OULU-YYYY-NNNN` pattern.

Runs on every `pnpm db:seed`. Idempotent.

### 2. Bulk ingest — `scripts/ingest-flora.ts`

Pulls open biodiversity data on demand:

| Source | What we pull | Licence |
|---|---|---|
| **GBIF Species API** | Accepted Finnish vascular plant species + taxonomy + family + authorship | CC0 |
| **Wikidata SPARQL** | Common names (FI / SV / EN) + Wikidata image ref | CC0 |
| **Wikimedia Commons** | Image URLs (resolved from Wikidata) | CC BY-SA per image |
| **IUCN Red List API** *(future)* | Global threat category | researcher terms |
| **`packages/plant-data/finland-redlist-2019.json`** *(local)* | Official Finnish 2019 Red List status per species | open data |

The script:

1. Pages through GBIF up to a `--limit`.
2. For each species, looks up Wikidata for names + image.
3. Upserts `Taxon` + `Plant` (status `hidden`) + `PlantImage` with attribution.
4. Logs progress; safe to interrupt + resume.

**`status='hidden'` on new rows** — curators review and flip to `active` before the plant appears publicly. This prevents un-vetted scientific names or low-quality images from being shown to donors.

## Consequences

**Positive**

- 100% of Finnish vascular plant species can be onboarded with one command.
- Every image has a documented licence + attribution → CC compliance is automatic.
- Curators stay in control (hidden by default).

**Negative**

- GBIF rate limit (~3 req/s without an API key). The script paces itself.
- Wikidata image quality varies. Curators may swap in higher-quality photos.

## Curator-friendly workflow

After bulk ingest, the curator:

1. Opens `/admin/resources/Plant?filters.status=hidden`.
2. Reviews each row's image + scientific name.
3. Adds the FI/SV/EN story.
4. Sets `bloomSeason`, `gardenZone`, `targetCents`.
5. Flips `status` to `active`.

For ~2,667 species this is ~2 minutes per row × multiple curators = a manageable seasonal project; alternatively, only featured species are activated and the rest remain searchable but un-storied.
