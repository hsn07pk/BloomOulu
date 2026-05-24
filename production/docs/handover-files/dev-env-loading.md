# Local dev — `.env` loading & port allocation

**Audience:** anyone hitting "admin won't start" or "Prisma can't find
`DIRECT_URL`" on a fresh clone. Folds together three independent fixes
applied on 2026-05-24 so the next person debugging similar weirdness has a
map.

> Handoff note: durable parts of this can fold into `system-design.md` once
> someone confirms the patterns have settled.

## TL;DR

Three small things prevented a cold-clone local dev from working end-to-end:

1. **admin had no `.env` loader.** Prisma crashed inside admin because
   `process.env.DATABASE_URL` was `undefined`.
2. **admin and api fought over the same `PORT` env var.** `.env` sets
   `PORT=4000` for the api; admin also read `PORT` and tried to bind 4000.
3. **`pnpm db:*` could not find `.env`.** pnpm cd's into `packages/db/`;
   Prisma searches for `.env` in cwd + schema dir; the only `.env` is at the
   monorepo root.

All three are fixed. Skip to **The fixes** if you just want the diffs.

## Symptoms before the fix

- `pnpm dev` boots **web (3000)**, **api (4000)**, **kiosk (3100)** — but
  **admin (4100) is unreachable**.
- The admin `tsx watch` process is alive (`ps -ef | grep tsx`) yet
  `curl http://localhost:4100` returns nothing.
- Buried in the interleaved `pnpm dev` log:
  ```
  Error: listen EADDRINUSE: address already in use 0.0.0.0:4000
      at Server.setupListenHandle …
  ```
  …coming from admin, which "shouldn't" be on 4000.
- `pnpm db:migrate:dev` fails with
  `Environment variable not found: DIRECT_URL` even though `.env` clearly
  defines it.

## Why each one happens

### 1. admin had no env loader

Each app loads `.env` differently:

| App | How it loads `.env` |
|---|---|
| **web** (Next.js) | Auto-loads from app dir at boot — Next convention. |
| **api** (NestJS) | `ConfigModule.forRoot({ envFilePath: ['.env', '../../.env'] })` in `app.module.ts`. |
| **kiosk** (Next.js) | Auto-loads at boot. |
| **admin** (Fastify + tsx) | **Nothing.** Relied on the shell already having env vars. |

When `pnpm dev` runs `tsx watch src/server.ts` from `apps/admin/`, nothing
in the chain loads `.env`. Result: `process.env.DATABASE_URL` is
`undefined`, Prisma throws on first query, `tsx watch` keeps the process
alive but it never reaches `app.listen()`.

The Docker-first workflow doesn't hit this because
`docker-compose.yml`'s `admin.environment:` block injects everything
explicitly. Host-machine `pnpm dev` is where the gap surfaces.

### 2. PORT collision between admin and api

`production/.env`:

```
PORT=4000              # intended for the api
```

- `apps/api/src/main.ts`:
  ```ts
  const PORT = parseInt(process.env.PORT ?? '4000', 10);
  ```
  → reads `PORT`, gets 4000, binds 4000. Correct.
- `apps/admin/src/server.ts` (around line 2279, pre-fix):
  ```ts
  const port = parseInt(process.env.PORT ?? '4100', 10);
  ```
  → reads the **same** `PORT`, gets 4000, tries to bind 4000.

Whichever app starts first wins; the other crashes with `EADDRINUSE`. In
Turbo's parallel scheduling that's non-deterministic, but admin lost in
practice.

### 3. Prisma can't find `.env` from `packages/db/`

Prisma CLI auto-discovers `.env` from:

1. The current working directory
2. The schema directory (`prisma/`)

`pnpm --filter @bloomoulu/db run migrate:deploy` runs prisma with cwd =
`packages/db/`. Neither `packages/db/.env` nor `packages/db/prisma/.env`
exists, so Prisma never finds the one at `production/.env`.

This is a documented Prisma + monorepo gotcha. Prisma's own docs
recommend [`dotenv-cli`](https://www.prisma.io/docs/orm/more/development-environment/environment-variables/managing-env-files-and-setting-variables)
as the standard workaround.

## The fixes

### Fix 1 — admin loads `.env` via tsx's `--env-file`

`apps/admin/package.json`:

```diff
- "dev": "tsx watch src/server.ts",
+ "dev": "tsx watch --env-file=../../.env src/server.ts",
```

tsx 4.19+ forwards `--env-file` to Node's native flag (available since
Node 20.6). Env is loaded **before any user code runs**, so module-level
`process.env.X` reads see the right values.

Prod (`pnpm start` → `node dist/server.js`) is unchanged — Docker
injects env directly via the compose `environment:` block.

### Fix 2 — admin binds `ADMIN_PORT`, not the shared `PORT`

`apps/admin/src/server.ts`:

```diff
- const port = parseInt(process.env.PORT ?? '4100', 10);
+ // Prefer ADMIN_PORT so we don't collide with API's PORT when both run
+ // from the same monorepo .env in `pnpm dev`. Docker containers don't set
+ // PORT for admin, so the default still holds in prod.
+ const port = parseInt(process.env.ADMIN_PORT ?? '4100', 10);
```

`ADMIN_PORT` is already a known variable in `docker-compose.yml` — it
was used host-side for the port mapping (`"${ADMIN_PORT:-4100}:4100"`).
This just makes the internal binding match. Default `4100` still wins if
nothing is set, so Docker prod is unchanged.

### Fix 3 — every prisma script via `dotenv-cli`

`packages/db/package.json`:

```diff
  "scripts": {
-   "generate": "prisma generate",
-   "migrate:dev": "prisma migrate dev",
-   "migrate:deploy": "prisma migrate deploy",
-   "studio": "prisma studio",
-   "seed": "tsx prisma/seed/index.ts",
+   "generate":      "dotenv -e ../../.env -- prisma generate",
+   "migrate:dev":   "dotenv -e ../../.env -- prisma migrate dev",
+   "migrate:deploy":"dotenv -e ../../.env -- prisma migrate deploy",
+   "studio":        "dotenv -e ../../.env -- prisma studio",
+   "seed":          "dotenv -e ../../.env -- tsx prisma/seed/index.ts",
    ...
  },
  "prisma": {
-   "seed": "tsx prisma/seed/index.ts"
+   "seed": "dotenv -e ../../.env -- tsx prisma/seed/index.ts"
  },
  "devDependencies": {
+   "dotenv-cli": "^7.4.4",
    ...
  }
```

`dotenv-cli` reads `production/.env` (the `-e ../../.env` path is relative
to `packages/db/` cwd), exports the vars into the child process env, then
execs whatever comes after `--`. Existing process env still wins, so
Docker injection in prod is unaffected.

## How to verify

From a fresh shell — **don't pre-source `.env`**:

```bash
cd production

# Confirm the shell has no DATABASE_URL leaking from elsewhere:
echo "${DATABASE_URL:-<unset>}"      # expect: <unset>

# Each of these should work without sourcing .env:
pnpm db:generate
pnpm db:migrate                       # idempotent — applies pending only
pnpm db:studio                        # opens http://localhost:5555
pnpm dev                              # boots all 4 apps in parallel

# Then probe ports:
curl -I http://localhost:3000          # web    → 200 or 307
curl -I http://localhost:4000          # api    → 404 (no `/` route — fine)
curl -I http://localhost:4100/admin    # admin  → 302 (login redirect — fine)
curl -I http://localhost:3100          # kiosk  → 200
```

## Gotchas / future maintenance

- **Path is two levels deep.** Both `--env-file=../../.env` and
  `dotenv -e ../../.env` assume you stay two directories from the
  monorepo root. If you ever move `packages/db/` or `apps/admin/`, update
  those paths.
- **Don't add `PORT=4100` to `.env`** "for clarity." It'll silently break
  the api the moment somebody does. Service-specific ports must use their
  own env vars (`ADMIN_PORT`, future `KIOSK_PORT` etc.) or rely on the
  in-code default.
- **New apps under `apps/*`** need their own env loader — don't assume
  shell sourcing. Next auto-loads; for tsx use `--env-file=../../.env`;
  for Nest use `ConfigModule.forRoot({ envFilePath: ['.env', '../../.env'] })`.
- **Background worker** (`apps/api/src/worker.ts`) currently has no
  dedicated `dev` script. If you wire one up, give it the same
  `--env-file=../../.env` treatment.
