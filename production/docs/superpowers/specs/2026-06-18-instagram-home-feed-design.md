# Instagram on the home page — design spec

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan
**Branch:** `insta-plus-endager-filter`

## Overview

Add a visually striking, auto-updating **"Latest from Instagram"** band to the
public home page that surfaces the garden's public Instagram
(<https://www.instagram.com/oulubotgarden>) and drives visitors to follow it.

The garden's Instagram credentials are **not** available, and the site is
GDPR-sensitive, so the feed is fetched **server-side** from Instagram's public
web profile endpoint, cached locally, and rendered with our own markup — **no
Meta/third-party scripts run in the visitor's browser**. A curator-managed
fallback set guarantees the band always looks intentional even if the unofficial
fetch is blocked.

## Goals

- A beautiful, on-brand home-page band that makes people want to visit the IG.
- Show recent posts (image + caption preview + date), each linking to the real post.
- Auto-update without anyone logging in or connecting the account.
- No third-party browser scripts; no visitor data sent to Meta.
- Never render broken/empty: degrade gracefully to a curated fallback, then to a
  plain "Follow" CTA.

## Non-goals (YAGNI)

- No official Instagram Graph API / app-review integration (needs credentials).
- No video playback, comments, likes, or Stories — static post thumbnails only.
- No guaranteed freshness SLA — the data source is unofficial (see Risks).
- No client-side calls to instagram.com.

## Locked decisions (from brainstorming)

1. **Approach:** self-hosted auto-feed (server fetch + local cache + our own UI).
2. **Placement:** full-width band immediately **before the footer**, after the
   "Scan · Ask · Donate · Return" section.
3. **Tile content:** image + 1–2 line caption preview + relative date; whole tile
   links to the post on Instagram (`target="_blank" rel="noopener noreferrer"`).
4. **Fallback:** **admin-editable** — curators set the handle and upload ~6
   fallback images via `/admin`.

## Architecture & data flow

```
Instagram (public)
   ▲  server-to-server fetch (cron, ~every 6h)
   │
API: instagram-sync processor
   ├─ GET i.instagram.com/api/v1/users/web_profile_info/?username={handle}
   │      header: x-ig-app-id: 936619743392459 (public web app id), descriptive UA
   ├─ parse edge_owner_to_timeline_media → recent posts
   │      (shortcode, caption, taken_at_timestamp, display_url, is_video)
   ├─ download each thumbnail → /data/storage/instagram/{shortcode}.jpg
   │      (IG CDN URLs expire + are hotlink-protected → must rehost)
   └─ upsert InstagramPost(isFallback=false); prune removed; set instagram.lastSyncedAt
   │      on ANY failure (401/429/parse): log + metric, keep last-good rows, never throw
   │
GET /v1/instagram → { handle, posts[], source: 'live'|'fallback', lastSyncedAt }
   │      prefer live cached posts; if none have ever been fetched → curated fallback
   ▼
Web <InstagramSection/> (server component, revalidate ~3600s)
   └─ renders our own grid; images served same-origin via /v1/files/{imageKey}
```

## Data model

One new Prisma model (+ migration):

```prisma
model InstagramPost {
  id           String   @id @default(cuid())
  shortcode    String?  @unique          // null for fallback rows
  caption      String?  @db.Text
  takenAt      DateTime?
  mediaType    String   @default("image") // image | carousel | video (thumbnail only)
  imageKey     String                      // local storage key under instagram/
  permalink    String?                     // https://instagram.com/p/{shortcode}
  displayOrder Int      @default(0)
  isFallback   Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([isFallback, displayOrder])
}
```

Configuration reuses the existing **SystemSetting** table (admin-editable,
no deploy needed):

- `instagram.handle` (default `oulubotgarden`)
- `instagram.enabled` (default `true`)

## Components (isolated units)

| Unit | Location | Responsibility | Depends on |
|---|---|---|---|
| `fetchInstagramProfile()` | `apps/api/.../instagram/instagram.source.ts` | HTTP fetch + parse JSON → `ParsedPost[]` (pure, mockable) | fetch, zod |
| `InstagramSyncProcessor` | `apps/api/.../jobs/processors/instagram-sync.processor.ts` | orchestrate fetch → rehost thumbnails → upsert/prune rows → stamp lastSyncedAt; swallow errors | source, storage, prisma |
| cron registration | `apps/api/.../jobs/cron.ts` | enqueue sync ~every 6h | queues |
| `GET /v1/instagram` | `apps/api/.../instagram/instagram.controller.ts` | selection logic live→fallback→empty; shape response | prisma |
| `<InstagramSection/>` | `apps/web/.../components/InstagramSection.tsx` (server) | render band; empty-safe | internal API, /v1/files |
| Admin resource | `apps/admin/src/server.ts` | manage fallback rows (upload/caption/order); fetched rows read-only; expose SystemSetting keys | AdminJS |

### Thumbnail caching

Reuse the existing local image-rehost pattern (same as plant-image rehosting):
download `display_url` to `STORAGE_DIR/instagram/{shortcode}.jpg`, store the key in
`imageKey`, serve via the existing `/v1/files/{key}` route. Fallback rows get their
`imageKey` from the admin upload.

### API response

```json
{
  "handle": "oulubotgarden",
  "source": "live",
  "lastSyncedAt": "2026-06-18T06:00:00.000Z",
  "posts": [
    { "shortcode": "Cxyz", "caption": "Spring in the alpine house…",
      "takenAt": "2026-06-15T09:12:00.000Z", "permalink": "https://instagram.com/p/Cxyz",
      "imageUrl": "/v1/files/instagram/Cxyz.jpg", "mediaType": "image" }
  ]
}
```

Selection: return up to ~9 live posts ordered by `takenAt desc`; if there are no
live rows at all, return fallback rows ordered by `displayOrder` with
`source: "fallback"`. `enabled=false` → empty `posts` (section self-hides).

## Web rendering & aesthetic

- Full-bleed band before the footer. Forest-deep background with cream text
  (echoes the kiosk's closing band) — final visual to be refined with the
  **frontend-design** skill at implementation.
- Header: small uppercase eyebrow + Fraunces serif title (e.g. "From our garden,
  on Instagram"), an `@oulubotgarden` chip, and a prominent **Follow on Instagram**
  button linking to the profile.
- Grid: responsive (3 cols desktop / 2 tablet / horizontal scroll or 2-up mobile)
  of rounded tiles; each shows the image, a clamped 1–2 line caption, and a
  relative date ("3 days ago"); subtle hover lift + caption reveal.
- Images via the same-origin `/v1/files/...` URLs; lazy-loaded.
- **Empty state:** if `posts` is empty, render just the branded heading + Follow
  CTA (still attractive, no broken grid).
- Localized (en/fi/sv): heading, eyebrow, CTA, relative-date formatting via `Intl`.

## Privacy / GDPR

- No third-party scripts; nothing loads from instagram.com in the browser.
- Post thumbnails are cached and served same-origin.
- Only user-initiated outbound links navigate to Instagram.
- The server-to-server fetch sends no visitor data and uses a descriptive
  contact User-Agent (reuse `WEBAPP_USER_AGENT_EMAIL`). It reads only public data.

## Reliability & fallback

- Fetch is **best-effort**: any non-200, parse error, or thumbnail-download
  failure is logged + counted, the last-good rows are left intact, and the
  processor never throws (won't break the queue).
- Cron interval ~6h (one request per run; rate-limit friendly).
- `GET /v1/instagram` and `<InstagramSection/>` are empty-safe end to end.

## Testing

- **Unit:** `fetchInstagramProfile()` parser against a captured sample JSON
  (incl. video/carousel + missing-caption cases); live-vs-fallback selection in
  the controller; relative-date formatting.
- **Fetcher:** processor with mocked HTTP — success path (upsert/prune) and
  failure path (keep last-good, no throw).
- **Web:** `<InstagramSection/>` renders correctly for live posts, fallback
  posts, and the empty state.

## Rollout

1. Prisma model + migration.
2. API: source + processor + cron + endpoint + thumbnail rehost.
3. Web: section component + i18n + insert into home page.
4. Admin: resource + SystemSetting keys; upload ~6 fallback images.
5. Deploy (rebuild web/api/api-worker/admin); seed fallback set; verify the
   band renders (live if the fetch succeeds, otherwise fallback).

## Risks & open questions

- **Unofficial endpoint:** `web_profile_info` may return 401/429 from datacenter
  IPs or change shape. Mitigated by last-good cache + curated fallback; if it
  proves consistently blocked in production, the realistic fix is for the garden
  to connect the account to an official integration later (out of scope).
- **ToS:** reads only public data, server-side, low frequency, attributes + links
  back to Instagram. Documented as unofficial; revisit if Instagram objects.
- **Caption length / emoji:** store full caption, clamp in UI; ensure UTF-8/emoji
  safe.
