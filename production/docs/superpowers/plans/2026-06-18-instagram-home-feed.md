# Instagram Home-Page Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-hosted, auto-updating "Latest from Instagram" band before the home-page footer that fetches @oulubotgarden's public posts server-side, caches thumbnails locally, renders our own on-brand grid (no Meta scripts), and falls back to an admin-managed curated set.

**Architecture:** A BullMQ cron job (~every 6h) fetches Instagram's public `web_profile_info` JSON, rehosts each thumbnail to local storage, and upserts `InstagramPost` rows. `GET /v1/instagram` returns live posts (or the curated fallback). A server-component band on the home page renders them. Curators manage the handle and fallback images in `/admin`.

**Tech Stack:** NestJS + Fastify (API), BullMQ + Redis (jobs), Prisma + Postgres, Next.js App Router (web), AdminJS (admin), Vitest (API tests), next-intl (i18n).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-18-instagram-home-feed-design.md` — every decision there is binding.
- **No third-party browser scripts.** Nothing may load from instagram.com/meta in the visitor's browser. Thumbnails are cached and served same-origin via `/v1/files/...`. Only user-initiated outbound links go to Instagram (`target="_blank" rel="noopener noreferrer"`).
- **Fetch is best-effort.** Any fetch/parse/download failure must be caught, logged, and must NOT throw out of the processor or break the page. Last-good rows stay; the page degrades to fallback → empty CTA.
- **Prisma client import:** always `import { prisma } from '@bloomoulu/db';`.
- **Storage:** `import { uploadToS3 } from '<rel>/infra/storage.js';` — `uploadToS3({ key, body, contentType })`. Served via existing `/v1/files/*` route. Use `.js` extensions on all relative imports (NodeNext ESM).
- **Public IG web app id header:** `x-ig-app-id: 936619743392459`. Descriptive UA from `process.env.WEBAPP_USER_AGENT_EMAIL` (fallback `conservation@bloomoulu.fi`).
- **Default handle:** `oulubotgarden`. Config via `SystemSetting` keys `instagram.handle`, `instagram.enabled`, `instagram.lastSyncedAt` (jsonb values).
- **Environment note:** the local sandbox has **no node/pnpm**; Vitest steps below are written correctly for a node-enabled context (CI or local dev). In the sandbox, treat **`docker compose build <svc>`** as the compile/typecheck gate and **`curl`** as the functional gate (see Task 8). Run the Vitest steps wherever node is available.
- **i18n:** add the new `Instagram` namespace to ALL three locale files (en/fi/sv) with identical key sets.
- Frequent commits — one per task minimum.

---

### Task 1: Prisma model `InstagramPost` + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add model near the other content models)
- Create (generated): `packages/db/prisma/migrations/<timestamp>_instagram_post/migration.sql`

**Interfaces:**
- Produces: Prisma model `InstagramPost { id, shortcode, caption, takenAt, mediaType, imageUrl, permalink, displayOrder, isFallback, createdAt, updatedAt }` and the generated client type `InstagramPost`.

- [ ] **Step 1: Add the model to `schema.prisma`**

Append after the existing models (anywhere top-level):

```prisma
/// Cached Instagram posts for the public home-page band. Live rows
/// (isFallback=false) are refreshed by the instagram-sync job; fallback
/// rows (isFallback=true) are curator-managed in /admin and shown only when
/// no live rows exist. `imageUrl` is the same-origin serving path
/// (/v1/files/instagram/<shortcode>.jpg) for live rows, or a curator-entered
/// URL for fallback rows. The full IUCN-style granularity note does not apply.
model InstagramPost {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  shortcode    String?   @unique          // null for fallback rows
  caption      String?
  takenAt      DateTime?
  mediaType    String    @default("image") // image | carousel | video (thumbnail only)
  imageUrl     String
  permalink    String?
  displayOrder Int        @default(0)
  isFallback   Boolean    @default(false)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@index([isFallback, displayOrder])
  @@index([isFallback, takenAt(sort: Desc)])
}
```

- [ ] **Step 2: Create the migration**

Run (from `packages/db/`):
```bash
npm run migrate:dev -- --name instagram_post
```
Expected: a new folder `packages/db/prisma/migrations/<ts>_instagram_post/` with `migration.sql` creating table `InstagramPost`, and the Prisma client regenerated.

- [ ] **Step 3: Verify the client type exists**

Run (from repo root):
```bash
npx prisma generate --schema packages/db/prisma/schema.prisma
```
Expected: no error; `InstagramPost` is now a model on `prisma`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add InstagramPost model + migration"
```

---

### Task 2: API — Instagram fetch + parse source (pure, unit-tested)

**Files:**
- Create: `apps/api/src/modules/instagram/instagram.source.ts`
- Test: `apps/api/test/instagram-source.test.ts`

**Interfaces:**
- Produces:
  - `interface ParsedPost { shortcode: string; caption: string | null; takenAt: string; mediaType: 'image' | 'carousel' | 'video'; displayUrl: string; permalink: string; }`
  - `function parseProfileJson(json: unknown, max?: number): ParsedPost[]`
  - `function fetchInstagramProfile(handle: string, opts?: { fetchImpl?: typeof fetch; max?: number }): Promise<ParsedPost[]>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/instagram-source.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseProfileJson, type ParsedPost } from '../src/modules/instagram/instagram.source.js';

const sample = {
  data: {
    user: {
      edge_owner_to_timeline_media: {
        edges: [
          {
            node: {
              __typename: 'GraphImage',
              shortcode: 'Caaa111',
              display_url: 'https://scontent.cdninstagram.com/a.jpg',
              is_video: false,
              taken_at_timestamp: 1718442720, // 2024-06-15T09:12:00Z
              edge_media_to_caption: { edges: [{ node: { text: 'Spring in the alpine house 🌸' } }] },
            },
          },
          {
            node: {
              __typename: 'GraphSidecar',
              shortcode: 'Cbbb222',
              display_url: 'https://scontent.cdninstagram.com/b.jpg',
              is_video: false,
              taken_at_timestamp: 1718356320,
              edge_media_to_caption: { edges: [] }, // missing caption
            },
          },
          {
            node: {
              __typename: 'GraphVideo',
              shortcode: 'Cccc333',
              display_url: 'https://scontent.cdninstagram.com/c.jpg',
              is_video: true,
              taken_at_timestamp: 1718269920,
              edge_media_to_caption: { edges: [{ node: { text: 'Reel' } }] },
            },
          },
        ],
      },
    },
  },
};

describe('parseProfileJson', () => {
  it('maps edges to ParsedPost with caption, date, media type, permalink', () => {
    const posts = parseProfileJson(sample);
    expect(posts).toHaveLength(3);
    const first = posts[0]!;
    expect(first).toMatchObject<Partial<ParsedPost>>({
      shortcode: 'Caaa111',
      caption: 'Spring in the alpine house 🌸',
      mediaType: 'image',
      displayUrl: 'https://scontent.cdninstagram.com/a.jpg',
      permalink: 'https://www.instagram.com/p/Caaa111/',
    });
    expect(first.takenAt).toBe('2024-06-15T09:12:00.000Z');
    expect(posts[1]!.caption).toBeNull();          // missing caption → null
    expect(posts[1]!.mediaType).toBe('carousel');  // GraphSidecar
    expect(posts[2]!.mediaType).toBe('video');     // GraphVideo
  });

  it('respects max and tolerates malformed input', () => {
    expect(parseProfileJson(sample, 2)).toHaveLength(2);
    expect(parseProfileJson({})).toEqual([]);
    expect(parseProfileJson(null)).toEqual([]);
    expect(parseProfileJson({ data: { user: {} } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/api/test/instagram-source.test.ts`
Expected: FAIL — cannot find module `instagram.source.js`.

- [ ] **Step 3: Implement `instagram.source.ts`**

Create `apps/api/src/modules/instagram/instagram.source.ts`:

```typescript
/**
 * Public Instagram profile fetch + parse. Uses the unauthenticated
 * web_profile_info endpoint with the public web app id header. Unofficial and
 * best-effort: callers must tolerate throws (see instagram-sync.processor).
 * No credentials, server-to-server only, reads public data.
 */

export interface ParsedPost {
  shortcode: string;
  caption: string | null;
  takenAt: string; // ISO 8601
  mediaType: 'image' | 'carousel' | 'video';
  displayUrl: string;
  permalink: string;
}

const IG_APP_ID = '936619743392459'; // public Instagram web app id
const DEFAULT_MAX = 12;

function mediaTypeFor(node: any): ParsedPost['mediaType'] {
  if (node?.is_video || node?.__typename === 'GraphVideo') return 'video';
  if (node?.__typename === 'GraphSidecar') return 'carousel';
  return 'image';
}

/** Parse the web_profile_info JSON into ParsedPost[]. Pure + defensive. */
export function parseProfileJson(json: unknown, max: number = DEFAULT_MAX): ParsedPost[] {
  const edges = (json as any)?.data?.user?.edge_owner_to_timeline_media?.edges;
  if (!Array.isArray(edges)) return [];
  const out: ParsedPost[] = [];
  for (const edge of edges) {
    const node = edge?.node;
    if (!node?.shortcode || !node?.display_url) continue;
    const ts = Number(node.taken_at_timestamp);
    const captionText: string | undefined = node?.edge_media_to_caption?.edges?.[0]?.node?.text;
    out.push({
      shortcode: String(node.shortcode),
      caption: captionText && captionText.trim().length > 0 ? captionText : null,
      takenAt: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date(0).toISOString(),
      mediaType: mediaTypeFor(node),
      displayUrl: String(node.display_url),
      permalink: `https://www.instagram.com/p/${node.shortcode}/`,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Fetch + parse a public profile. Throws on non-200 / network error. */
export async function fetchInstagramProfile(
  handle: string,
  opts: { fetchImpl?: typeof fetch; max?: number } = {},
): Promise<ParsedPost[]> {
  const f = opts.fetchImpl ?? fetch;
  const ua = `BloomOulu/1.0 (+${process.env.WEBAPP_USER_AGENT_EMAIL ?? 'conservation@bloomoulu.fi'})`;
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  const res = await f(url, {
    headers: { 'x-ig-app-id': IG_APP_ID, 'user-agent': ua, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`instagram web_profile_info ${res.status}`);
  const json = await res.json();
  return parseProfileJson(json, opts.max);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/api/test/instagram-source.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/instagram/instagram.source.ts apps/api/test/instagram-source.test.ts
git commit -m "feat(api): Instagram public profile fetch + parser with tests"
```

---

### Task 3: API — config helper + thumbnail cache + sync processor + queue/cron/worker wiring

**Files:**
- Create: `apps/api/src/modules/instagram/instagram.config.ts`
- Create: `apps/api/src/modules/instagram/instagram-cache.ts`
- Create: `apps/api/src/modules/jobs/processors/instagram-sync.processor.ts`
- Modify: `apps/api/src/modules/jobs/queues.ts` (add queue name)
- Modify: `apps/api/src/modules/jobs/enqueue.ts` (add enqueue helper)
- Modify: `apps/api/src/modules/jobs/cron.ts` (register 6h scheduler)
- Modify: `apps/api/src/worker.ts` (register processor)
- Test: `apps/api/test/instagram-sync.test.ts`

**Interfaces:**
- Consumes: `fetchInstagramProfile`, `ParsedPost` (Task 2); `prisma` from `@bloomoulu/db`; `uploadToS3` from infra/storage.
- Produces:
  - `instagram.config.ts`: `async getInstagramConfig(): Promise<{ handle: string; enabled: boolean; lastSyncedAt: string | null }>`, `async setLastSynced(iso: string): Promise<void>`
  - `instagram-cache.ts`: `async cacheThumbnail(displayUrl: string, shortcode: string): Promise<string | null>` (returns `/v1/files/instagram/<shortcode>.jpg` or null)
  - `instagram-sync.processor.ts`: `async function processInstagramSync(job: Job): Promise<{ ok: boolean; synced: number; pruned: number; skipped?: boolean }>`
  - `queues.ts`: `export const QUEUE_INSTAGRAM = 'instagram-sync';`
  - `enqueue.ts`: `export const enqueueInstagramSync = () => q(QUEUE_INSTAGRAM).add('sync', {}, defaultJobOpts);`

- [ ] **Step 1: Implement `instagram.config.ts`**

```typescript
import { prisma } from '@bloomoulu/db';

const DEFAULT_HANDLE = 'oulubotgarden';

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
    SELECT value FROM "SystemSetting" WHERE key = ${key} LIMIT 1`;
  const v = rows[0]?.value;
  return (v === undefined || v === null ? fallback : (v as T));
}

export async function getInstagramConfig(): Promise<{
  handle: string;
  enabled: boolean;
  lastSyncedAt: string | null;
}> {
  const [handle, enabled, lastSyncedAt] = await Promise.all([
    readSetting<string>('instagram.handle', DEFAULT_HANDLE),
    readSetting<boolean>('instagram.enabled', true),
    readSetting<string | null>('instagram.lastSyncedAt', null),
  ]);
  return { handle: handle || DEFAULT_HANDLE, enabled: enabled !== false, lastSyncedAt };
}

export async function setLastSynced(iso: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "SystemSetting" (key, value, updated_at)
    VALUES ('instagram.lastSyncedAt', ${JSON.stringify(iso)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
```

> Note: if the `SystemSetting` table has a NOT NULL column without a default (e.g. `updated_by`), add it to the INSERT column list with `null`. Check `packages/db/prisma/schema.prisma` for the `SystemSetting` model before running.

- [ ] **Step 2: Implement `instagram-cache.ts`**

```typescript
import { uploadToS3 } from '../../infra/storage.js';

const MIN_BYTES = 512;
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Download an Instagram CDN thumbnail and rehost it locally. IG CDN URLs
 * expire + are hotlink-protected, so we must cache. Returns the same-origin
 * serving path, or null on any failure (caller keeps the previous row).
 */
export async function cacheThumbnail(displayUrl: string, shortcode: string): Promise<string | null> {
  try {
    const res = await fetch(displayUrl, {
      headers: { 'user-agent': `BloomOulu/1.0 (+${process.env.WEBAPP_USER_AGENT_EMAIL ?? 'conservation@bloomoulu.fi'})` },
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;
    const key = `instagram/${shortcode}.jpg`;
    await uploadToS3({ key, body: buf, contentType: res.headers.get('content-type') || 'image/jpeg' });
    return `/v1/files/${key}`;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Implement `instagram-sync.processor.ts`**

```typescript
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { fetchInstagramProfile } from '../../instagram/instagram.source.js';
import { cacheThumbnail } from '../../instagram/instagram-cache.js';
import { getInstagramConfig, setLastSynced } from '../../instagram/instagram.config.js';

/**
 * Refresh the cached live Instagram posts. Best-effort: on any failure we
 * log + return { ok:false } and leave the existing rows intact so the public
 * band keeps showing last-good content. Never throws.
 */
export async function processInstagramSync(
  _job: Job,
): Promise<{ ok: boolean; synced: number; pruned: number; skipped?: boolean }> {
  const { handle, enabled } = await getInstagramConfig();
  if (!enabled) return { ok: true, synced: 0, pruned: 0, skipped: true };

  let posts;
  try {
    posts = await fetchInstagramProfile(handle, { max: 12 });
  } catch (err) {
    console.warn(`[instagram-sync] fetch failed for @${handle}: ${(err as Error).message}`);
    return { ok: false, synced: 0, pruned: 0 };
  }

  const keptShortcodes: string[] = [];
  let synced = 0;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i]!;
    const imageUrl = await cacheThumbnail(p.displayUrl, p.shortcode);
    if (!imageUrl) continue; // keep any prior row for this shortcode
    keptShortcodes.push(p.shortcode);
    await prisma.instagramPost.upsert({
      where: { shortcode: p.shortcode },
      create: {
        shortcode: p.shortcode,
        caption: p.caption,
        takenAt: new Date(p.takenAt),
        mediaType: p.mediaType,
        imageUrl,
        permalink: p.permalink,
        displayOrder: i,
        isFallback: false,
      },
      update: {
        caption: p.caption,
        takenAt: new Date(p.takenAt),
        mediaType: p.mediaType,
        imageUrl,
        permalink: p.permalink,
        displayOrder: i,
      },
    });
    synced++;
  }

  // Prune live rows that disappeared from the profile (only if we synced something).
  let pruned = 0;
  if (keptShortcodes.length > 0) {
    const res = await prisma.instagramPost.deleteMany({
      where: { isFallback: false, shortcode: { notIn: keptShortcodes } },
    });
    pruned = res.count;
  }

  await setLastSynced(new Date().toISOString());
  return { ok: true, synced, pruned };
}
```

- [ ] **Step 4: Add the queue name** in `apps/api/src/modules/jobs/queues.ts`

Add alongside the other `QUEUE_*` constants:
```typescript
export const QUEUE_INSTAGRAM = 'instagram-sync';
```

- [ ] **Step 5: Add the enqueue helper** in `apps/api/src/modules/jobs/enqueue.ts`

Add (mirroring the existing helpers; `q` and `defaultJobOpts` are already imported there — add `QUEUE_INSTAGRAM` to the existing `queues.js` import):
```typescript
export const enqueueInstagramSync = () =>
  q(QUEUE_INSTAGRAM).add('sync', {}, { ...defaultJobOpts, removeOnComplete: true });
```

- [ ] **Step 6: Register the 6h cron** in `apps/api/src/modules/jobs/cron.ts`

Inside `registerCronJobs()`, mirroring the retention block (add `QUEUE_INSTAGRAM` to the `queues.js` import at the top):
```typescript
  const instagram = new Queue(QUEUE_INSTAGRAM, { connection });
  if (process.env.INSTAGRAM_CRON_DISABLED !== 'true') {
    await instagram.upsertJobScheduler(
      'every-6h',
      { pattern: '0 */6 * * *' },
      { name: 'sync', data: {}, opts: defaultJobOpts },
    );
  }
```

- [ ] **Step 7: Register the worker** in `apps/api/src/worker.ts`

Add the import near the other processor imports:
```typescript
import { processInstagramSync } from './modules/jobs/processors/instagram-sync.processor.js';
```
Add `QUEUE_INSTAGRAM` to the `queues.js` import, and add an entry to the `QUEUES` array:
```typescript
  { name: QUEUE_INSTAGRAM, concurrency: 1, handler: processInstagramSync },
```

- [ ] **Step 8: Write the processor test** (integration — needs DB + mocked storage/network)

Create `apps/api/test/instagram-sync.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Mock storage so no disk writes; mock the source so no network.
vi.mock('../src/infra/storage.js', () => ({
  uploadToS3: vi.fn(async () => 's3://bloomoulu-assets/instagram/x.jpg'),
}));
vi.mock('../src/modules/instagram/instagram.source.js', () => ({
  fetchInstagramProfile: vi.fn(async () => [
    { shortcode: 'TESTaaa', caption: 'hello', takenAt: '2024-06-15T09:12:00.000Z',
      mediaType: 'image', displayUrl: 'https://scontent/x.jpg',
      permalink: 'https://www.instagram.com/p/TESTaaa/' },
  ]),
}));
// cacheThumbnail does a real fetch of displayUrl — stub global fetch to return bytes.
vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(2048), {
  status: 200, headers: { 'content-type': 'image/jpeg' },
})));

const prisma = new PrismaClient();
beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => {
  await prisma.instagramPost.deleteMany({ where: { shortcode: 'TESTaaa' } });
  await prisma.$disconnect();
});

describe('processInstagramSync', () => {
  it('upserts live posts from the fetched profile', async () => {
    const { processInstagramSync } = await import(
      '../src/modules/jobs/processors/instagram-sync.processor.js'
    );
    const result = await processInstagramSync({ data: {} } as any);
    expect(result.ok).toBe(true);
    expect(result.synced).toBeGreaterThanOrEqual(1);
    const row = await prisma.instagramPost.findUnique({ where: { shortcode: 'TESTaaa' } });
    expect(row?.isFallback).toBe(false);
    expect(row?.imageUrl).toBe('/v1/files/instagram/TESTaaa.jpg');
  });
});
```

- [ ] **Step 9: Run the processor test**

Run: `npx vitest run apps/api/test/instagram-sync.test.ts`
Expected: PASS (requires a reachable Postgres with the Task 1 migration applied; in the sandbox run after `docker compose up -d postgres` and `migrate:deploy`, or defer to CI — see Global Constraints).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/instagram apps/api/src/modules/jobs apps/api/src/worker.ts apps/api/test/instagram-sync.test.ts
git commit -m "feat(api): instagram-sync job — fetch, cache thumbnails, upsert posts"
```

---

### Task 4: API — `GET /v1/instagram` endpoint + module registration

**Files:**
- Create: `apps/api/src/modules/instagram/instagram.controller.ts`
- Create: `apps/api/src/modules/instagram/instagram.module.ts`
- Modify: `apps/api/src/app.module.ts` (import + register `InstagramModule`)
- Test: `apps/api/test/instagram-endpoint.test.ts`

**Interfaces:**
- Consumes: `getInstagramConfig` (Task 3); `prisma`.
- Produces: `GET /v1/instagram` → `{ handle, enabled, source: 'live'|'fallback'|'disabled', lastSyncedAt, posts: Array<{ shortcode, caption, takenAt, permalink, imageUrl, mediaType }> }`.
- Produces (web relies on these exact field names): `source`, `posts[].imageUrl`, `posts[].caption`, `posts[].takenAt`, `posts[].permalink`, `posts[].shortcode`.

- [ ] **Step 1: Implement the controller**

Create `apps/api/src/modules/instagram/instagram.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { getInstagramConfig } from './instagram.config.js';

const MAX = 9;

@ApiTags('Instagram')
@Controller('instagram')
export class InstagramController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Public Instagram feed (live cached posts or curated fallback)' })
  async feed() {
    const { handle, enabled, lastSyncedAt } = await getInstagramConfig();
    if (!enabled) {
      return { handle, enabled: false, source: 'disabled', lastSyncedAt, posts: [] };
    }
    const live = await this.prisma.instagramPost.findMany({
      where: { isFallback: false },
      orderBy: { takenAt: 'desc' },
      take: MAX,
    });
    const rows =
      live.length > 0
        ? { source: 'live' as const, items: live }
        : {
            source: 'fallback' as const,
            items: await this.prisma.instagramPost.findMany({
              where: { isFallback: true },
              orderBy: { displayOrder: 'asc' },
              take: MAX,
            }),
          };
    return {
      handle,
      enabled: true,
      source: rows.source,
      lastSyncedAt,
      posts: rows.items.map((p) => ({
        shortcode: p.shortcode,
        caption: p.caption,
        takenAt: p.takenAt,
        permalink: p.permalink ?? `https://www.instagram.com/${handle}/`,
        imageUrl: p.imageUrl,
        mediaType: p.mediaType,
      })),
    };
  }
}
```

- [ ] **Step 2: Implement the module**

Create `apps/api/src/modules/instagram/instagram.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { InstagramController } from './instagram.controller.js';

@Module({ controllers: [InstagramController] })
export class InstagramModule {}
```

- [ ] **Step 3: Register in `app.module.ts`**

Add the import with the other module imports and add `InstagramModule` to the `imports: [...]` array:
```typescript
import { InstagramModule } from './modules/instagram/instagram.module.js';
// ...in imports array, near StatsModule:
    InstagramModule,
```

- [ ] **Step 4: Write the endpoint test**

Create `apps/api/test/instagram-endpoint.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
beforeAll(async () => {
  await prisma.$connect();
  await prisma.instagramPost.deleteMany({ where: { shortcode: { in: ['EPlive1', null as any] } } });
  await prisma.instagramPost.create({
    data: { shortcode: 'EPlive1', caption: 'c', takenAt: new Date(), mediaType: 'image',
      imageUrl: '/v1/files/instagram/EPlive1.jpg', permalink: 'https://www.instagram.com/p/EPlive1/',
      displayOrder: 0, isFallback: false },
  });
});
afterAll(async () => {
  await prisma.instagramPost.deleteMany({ where: { shortcode: 'EPlive1' } });
  await prisma.$disconnect();
});

describe('GET /v1/instagram selection logic', () => {
  it('returns live posts mapped to the public shape', async () => {
    const { InstagramController } = await import('../src/modules/instagram/instagram.controller.js');
    const ctrl = new InstagramController(prisma as any);
    const res = await ctrl.feed();
    expect(res.source).toBe('live');
    expect(res.posts[0]).toMatchObject({ shortcode: 'EPlive1', imageUrl: '/v1/files/instagram/EPlive1.jpg' });
  });
});
```

- [ ] **Step 5: Run the endpoint test**

Run: `npx vitest run apps/api/test/instagram-endpoint.test.ts`
Expected: PASS (needs DB + migration; see Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/instagram/instagram.controller.ts apps/api/src/modules/instagram/instagram.module.ts apps/api/src/app.module.ts apps/api/test/instagram-endpoint.test.ts
git commit -m "feat(api): GET /v1/instagram feed endpoint (live → fallback)"
```

---

### Task 5: Web — i18n keys for the Instagram section

**Files:**
- Modify: `packages/i18n/messages/en.json`
- Modify: `packages/i18n/messages/fi.json`
- Modify: `packages/i18n/messages/sv.json`

**Interfaces:**
- Produces: `Instagram` namespace with keys `eyebrow, title, subtitle, follow, viewOnInstagram, handle`.

- [ ] **Step 1: Add the `Instagram` namespace to `en.json`**

Add a top-level namespace (sibling of `"Home"`):
```json
  "Instagram": {
    "eyebrow": "Follow along",
    "title": "From our garden, on Instagram",
    "subtitle": "Daily glimpses of the collection — what's flowering, behind the glasshouse glass, and the people who tend it.",
    "follow": "Follow @oulubotgarden",
    "viewOnInstagram": "View on Instagram",
    "handle": "@oulubotgarden"
  },
```

- [ ] **Step 2: Add the same namespace to `fi.json`**

```json
  "Instagram": {
    "eyebrow": "Seuraa meitä",
    "title": "Puutarhamme Instagramissa",
    "subtitle": "Päivittäisiä vilauksia kokoelmasta — mikä kukkii, kasvihuoneen lasin takana ja ihmiset jotka siitä huolehtivat.",
    "follow": "Seuraa @oulubotgarden",
    "viewOnInstagram": "Katso Instagramissa",
    "handle": "@oulubotgarden"
  },
```

- [ ] **Step 3: Add the same namespace to `sv.json`**

```json
  "Instagram": {
    "eyebrow": "Följ oss",
    "title": "Vår trädgård, på Instagram",
    "subtitle": "Dagliga glimtar av samlingen — vad som blommar, bakom växthusets glas och människorna som sköter den.",
    "follow": "Följ @oulubotgarden",
    "viewOnInstagram": "Visa på Instagram",
    "handle": "@oulubotgarden"
  },
```

- [ ] **Step 4: Validate JSON**

Run: `python3 -c "import json; [json.load(open(f)) for f in ['packages/i18n/messages/en.json','packages/i18n/messages/fi.json','packages/i18n/messages/sv.json']]; print('ok')"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/messages/en.json packages/i18n/messages/fi.json packages/i18n/messages/sv.json
git commit -m "feat(i18n): Instagram section strings (en/fi/sv)"
```

---

### Task 6: Web — `InstagramSection` server component + home-page insertion

**Files:**
- Create: `apps/web/src/lib/relative-time.ts`
- Create: `apps/web/src/components/InstagramSection.tsx`
- Modify: `apps/web/src/app/[locale]/page.tsx` (insert section before footer; add fetch)

**Interfaces:**
- Consumes: `GET /v1/instagram` (Task 4) via `internalApiUrl()`; `PlantImage` from `components/PlantImage.client`; i18n `Instagram` namespace (Task 5).
- Produces: `async function InstagramSection({ locale }: { locale: string }): Promise<JSX.Element | null>`; `function relativeTime(iso: string | null, locale: string): string | null`.

- [ ] **Step 1: Implement the relative-time helper** (server-safe, no i18n dependency)

Create `apps/web/src/lib/relative-time.ts`:
```typescript
// Server-safe relative time for the Instagram band. Inline locale strings
// (no next-intl hook) so it works in a server component.
type Locale = 'en' | 'fi' | 'sv';

const STR: Record<Locale, { now: string; d: (n: number) => string; w: (n: number) => string; mo: (n: number) => string; y: (n: number) => string; hr: (n: number) => string }> = {
  en: { now: 'just now', hr: (n) => `${n}h ago`, d: (n) => `${n}d ago`, w: (n) => `${n}w ago`, mo: (n) => `${n}mo ago`, y: (n) => `${n}y ago` },
  fi: { now: 'juuri nyt', hr: (n) => `${n} t sitten`, d: (n) => `${n} pv sitten`, w: (n) => `${n} vk sitten`, mo: (n) => `${n} kk sitten`, y: (n) => `${n} v sitten` },
  sv: { now: 'nyss', hr: (n) => `${n} h sedan`, d: (n) => `${n} d sedan`, w: (n) => `${n} v sedan`, mo: (n) => `${n} mån sedan`, y: (n) => `${n} år sedan` },
};

export function relativeTime(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const s = STR[(['en', 'fi', 'sv'].includes(locale) ? locale : 'en') as Locale];
  const hr = ms / 3.6e6, day = hr / 24, wk = day / 7, mo = day / 30.44, yr = day / 365.25;
  if (hr < 1) return s.now;
  if (hr < 24) return s.hr(Math.round(hr));
  if (day < 7) return s.d(Math.round(day));
  if (wk < 5) return s.w(Math.round(wk));
  if (mo < 12) return s.mo(Math.round(mo));
  return s.y(Math.round(yr));
}
```

- [ ] **Step 2: Implement `InstagramSection.tsx`** (server component)

Create `apps/web/src/components/InstagramSection.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { internalApiUrl } from '../lib/api';
import { PlantImage } from './PlantImage.client';
import { relativeTime } from '../lib/relative-time';

interface IgPost {
  shortcode: string | null;
  caption: string | null;
  takenAt: string | null;
  permalink: string;
  imageUrl: string;
  mediaType: string;
}
interface IgFeed {
  handle: string;
  enabled: boolean;
  source: 'live' | 'fallback' | 'disabled';
  posts: IgPost[];
}

async function fetchFeed(): Promise<IgFeed | null> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/instagram`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as IgFeed;
  } catch {
    return null;
  }
}

export async function InstagramSection({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Instagram' });
  const feed = await fetchFeed();
  if (feed && feed.enabled === false) return null; // admin-disabled
  const profileUrl = `https://www.instagram.com/${feed?.handle ?? 'oulubotgarden'}/`;
  const posts = feed?.posts ?? [];

  return (
    <section style={{ background: 'var(--forest-deep, #18271E)', color: 'var(--cream, #FAF7EE)', padding: '72px 0' }}>
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div>
            <div className="tiny" style={{ color: '#A8C060', letterSpacing: '0.18em', textTransform: 'uppercase' }}>{t('eyebrow')}</div>
            <h2 className="serif" style={{ fontSize: 'clamp(28px, 4vw, 44px)', marginTop: 8 }}>{t('title')}</h2>
            <p style={{ marginTop: 10, maxWidth: 520, color: 'rgba(250,247,238,0.72)' }}>{t('subtitle')}</p>
          </div>
          <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
             style={{ background: '#A8C060', color: '#18271E', whiteSpace: 'nowrap' }}>
            {t('follow')} ↗
          </a>
        </div>

        {posts.length > 0 && (
          <div data-grid-mobile="2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {posts.map((p) => (
              <a key={p.shortcode ?? p.imageUrl} href={p.permalink} target="_blank" rel="noopener noreferrer"
                 aria-label={t('viewOnInstagram')}
                 style={{ display: 'block', borderRadius: 14, overflow: 'hidden', background: 'rgba(250,247,238,0.06)', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ aspectRatio: '1 / 1', position: 'relative', overflow: 'hidden' }}>
                  <PlantImage src={p.imageUrl} alt={p.caption ?? t('handle')} variant="card" />
                </div>
                <div style={{ padding: '12px 14px 14px' }}>
                  {p.caption && (
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.caption}
                    </p>
                  )}
                  <div className="tiny" style={{ marginTop: 8, color: 'rgba(250,247,238,0.55)' }}>
                    {relativeTime(p.takenAt, locale)}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Insert the section before the footer in `page.tsx`**

In `apps/web/src/app/[locale]/page.tsx`, add the import near the other component imports:
```typescript
import { InstagramSection } from '../../components/InstagramSection';
```
Then add the component as the LAST child inside the page's returned fragment — immediately after the closing `</section>` of the "Scan · Ask · Donate · Return" (JOURNEY) section and before the wrapper's closing `</div>`:
```tsx
      </section>
      {/* ── INSTAGRAM ────────────────────────────────────────────── */}
      <InstagramSection locale={locale} />
    </div>
```

- [ ] **Step 4: Typecheck the web app**

Run: `pnpm --filter @bloomoulu/web typecheck`
Expected: no errors. (Sandbox: this is covered by the `docker compose build web` gate in Task 8 — there is no web unit-test runner.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/relative-time.ts apps/web/src/components/InstagramSection.tsx "apps/web/src/app/[locale]/page.tsx"
git commit -m "feat(web): Instagram band on the home page (server component)"
```

---

### Task 7: Admin — `InstagramPost` resource

**Files:**
- Modify: `apps/admin/src/server.ts` (add resource to the `resources` array)

**Interfaces:**
- Consumes: `getModelByName`, `prisma`, `restrictTo`, `CURATOR_OR_ADMIN` (all already in `server.ts`).

- [ ] **Step 1: Add the resource**

In `apps/admin/src/server.ts`, add to the `resources: [...]` array (next to the Plant/PlantImage block):
```typescript
{
  resource: { model: getModelByName('InstagramPost'), client: prisma },
  options: {
    navigation: { name: 'Catalogue', icon: 'Instagram' },
    listProperties: ['imageUrl', 'caption', 'isFallback', 'takenAt', 'displayOrder'],
    editProperties: ['imageUrl', 'caption', 'permalink', 'displayOrder', 'isFallback'],
    showProperties: ['id', 'shortcode', 'imageUrl', 'caption', 'permalink', 'mediaType', 'takenAt', 'displayOrder', 'isFallback', 'createdAt', 'updatedAt'],
    filterProperties: ['isFallback', 'shortcode', 'takenAt'],
    properties: {
      imageUrl: { description: 'For FALLBACK rows: paste an image URL (e.g. a /v1/files/... path or an https URL). Live rows are filled automatically by the instagram-sync job and overwrite themselves.' },
      caption: { description: 'Short caption shown under the image on the home-page band.' },
      permalink: { description: 'Link opened when a visitor clicks the tile. For fallback rows, point at https://www.instagram.com/oulubotgarden/ or a specific post.' },
      displayOrder: { description: 'Order of FALLBACK rows (ascending). Ignored for live rows.' },
      isFallback: { description: 'TRUE = curator-managed fallback (shown only when no live posts exist). FALSE = auto-synced live post — do not edit by hand.' },
      shortcode: { description: 'Instagram post id (auto-set for live rows; leave blank for fallback rows).' },
    },
    sort: { sortBy: 'takenAt', direction: 'desc' as const },
    actions: restrictTo(...CURATOR_OR_ADMIN),
  },
},
```

- [ ] **Step 2: Configure the handle/enabled settings (documentation step)**

In `apps/admin/src/server.ts`, no code change is needed — `instagram.handle`, `instagram.enabled`, and `instagram.lastSyncedAt` are managed through the existing `SystemSetting` resource (Operations → Settings, ADMIN_ONLY). Add a short comment above the new resource noting this so the next reader knows where the handle lives.

- [ ] **Step 3: Typecheck admin**

Run: `pnpm --filter @bloomoulu/admin typecheck`
Expected: no errors. (Sandbox: covered by `docker compose build admin` in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/server.ts
git commit -m "feat(admin): InstagramPost resource (manage fallback posts)"
```

---

### Task 8: Build, migrate, seed fallback, deploy & verify

**Files:** none (ops task).

- [ ] **Step 1: Compile-gate everything via Docker build**

Run (from `production/`):
```bash
docker compose build api api-worker web admin
```
Expected: all four images build (this runs tsc / nest build / next build — the compile + typecheck gate for the sandbox).

- [ ] **Step 2: Apply the migration to the running DB**

Run:
```bash
docker compose run --rm api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```
Expected: `instagram_post` migration applied. (Or run `packages/db` `migrate:deploy` against the DB.)

- [ ] **Step 3: Recreate the services**

Run:
```bash
docker compose up -d api api-worker web admin
```
Expected: all healthy (`docker compose ps`).

- [ ] **Step 4: Trigger one sync and verify the endpoint**

The cron registers a 6h schedule on worker boot; to verify immediately, hit the endpoint (the worker will also populate it on its first scheduled run). Check:
```bash
curl -fsS http://127.0.0.1:4000/v1/instagram | head -c 600
```
Expected JSON with `handle`, `source`, `posts`. If `source` is `live` with posts → the public fetch worked. If `source` is `fallback`/empty → the unofficial endpoint was blocked from this host (expected risk); proceed to seed fallback rows.

- [ ] **Step 5: Seed ~6 curated fallback rows (admin)**

In `/admin` → Catalogue → InstagramPost → New, create ~6 rows with `isFallback=true`, an `imageUrl` (paste an image URL), a short `caption`, `permalink` = `https://www.instagram.com/oulubotgarden/`, and `displayOrder` 0–5. Re-check `curl .../v1/instagram` shows `source: "fallback"` with those rows.

- [ ] **Step 6: Verify the home page renders the band**

Run:
```bash
curl -fsS http://127.0.0.1:3000/en | grep -o "From our garden, on Instagram" | head -1
```
Expected: the title string is present. Visually confirm the band appears before the footer with images + captions + a working "Follow" button.

- [ ] **Step 7: Commit any seed scripts / notes** (if a seed file was added)

```bash
git add -A && git commit -m "chore: seed Instagram fallback posts + deploy notes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Server-side fetch + parse → Task 2. ✔
- Local thumbnail caching → Task 3 (`cacheThumbnail`). ✔
- Cron ~6h + best-effort/last-good/never-throw → Task 3 (cron + processor try/catch). ✔
- `InstagramPost` model + SystemSetting config → Task 1 + Task 3 config helper. ✔
- `GET /v1/instagram` live→fallback→disabled selection → Task 4. ✔
- Web band before footer, tiles = image+caption+date linking to post, empty-safe, Follow CTA, no Meta scripts → Task 6. ✔
- i18n en/fi/sv → Task 5. ✔
- Admin-editable handle + fallback images → Task 7 (resource) + SystemSetting. ✔
- Privacy/GDPR (same-origin images, no browser scripts) → Task 6 uses `/v1/files` + plain `<a>`; verified Task 8. ✔
- Deploy + verify → Task 8. ✔

**Placeholder scan:** No TBD/TODO; every code step contains complete code. Web/admin have no unit-test runner — stated honestly (typecheck + docker build + curl as the gate), not faked.

**Type consistency:** `ParsedPost` fields (Task 2) are consumed unchanged by the processor (Task 3). The processor writes `imageUrl` (matching the model field renamed from the spec's `imageKey` → `imageUrl` in Task 1). The endpoint response field names (`source`, `posts[].imageUrl/caption/takenAt/permalink/shortcode`) match exactly what `InstagramSection` (Task 6) reads. `processInstagramSync` / `fetchInstagramProfile` / `cacheThumbnail` / `getInstagramConfig` / `setLastSynced` signatures are consistent across producer and consumer tasks.

**Note on the spec's `imageKey`:** the plan deliberately uses model field name `imageUrl` (it stores a serving URL/path, not an opaque storage key) — clearer and matches the endpoint/web contract. Functionally identical to the spec.
