# Changelog

Chronological log of merged PRs that affect this codebase. New entries
go at the top. GitHub PR links are the source of truth for the full
diff + discussion; the handover doc column points at any longer-form
write-up that landed alongside the PR.

| PR | Merged | Commit | Title | Handover doc |
|---|---|---|---|---|
| [#7](https://github.com/hsn07pk/BloomOulu/pull/7) | 2026-06-17 | _pending_ | donations: replace adopt-a-plant (tiers, perks, plaques, recurring billing, gift codes, dunning) with one-time donations + a favourites/votes leaderboard; payment rails kept, now one-time only | — |
| [#6](https://github.com/hsn07pk/BloomOulu/pull/6) | 2026-05-24 | _pending_ | plant detail: per-plant engagement stats | _shipped alongside [stats-roadmap.md](handover-files/stats-roadmap.md)_ |
| [#5](https://github.com/hsn07pk/BloomOulu/pull/5) | 2026-05-24 | `703ebda` | homepage: live engagement stats + public stats roadmap doc | [stats-roadmap.md](handover-files/stats-roadmap.md) |
| [#4](https://github.com/hsn07pk/BloomOulu/pull/4) | 2026-05-24 | `28e0c5e` | plants page: red-list fixes + bloom/adopted/family filters + page-number pagination + accurate counter + image error fallback | — |
| [#3](https://github.com/hsn07pk/BloomOulu/pull/3) | 2026-05-24 | `151311c` | web: homepage polish + live plant count + collapsible legal pages | — |
| [#2](https://github.com/hsn07pk/BloomOulu/pull/2) | 2026-05-24 | `063e6ea` | dev: fix `pnpm dev` + `pnpm db:*` env-loading on cold clone | [dev-env-loading.md](handover-files/dev-env-loading.md) |
| [#1](https://github.com/hsn07pk/BloomOulu/pull/1) | 2026-05-21 | `a770caf` | Plant content: open-data enrichment (bulk scripts + on-demand admin feature) | [plant-enrichment.md](handover-files/plant-enrichment.md) |

## How to add an entry

1. Get the squash-merge commit hash from `main` after `gh pr merge … --squash`.
2. Insert a new row at the top of the table.
3. Format the title exactly as the PR title (matches what `git log` shows).
4. Link the handover doc if the PR landed one in `docs/handover-files/`,
   else `—`.
5. PR # links to `https://github.com/hsn07pk/BloomOulu/pull/N`.

The PR description on GitHub remains the source of truth for the full
context — this file is just an index so people don't have to scroll
through git log to find prior work.
