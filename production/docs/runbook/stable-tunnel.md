# Runbook — stable public tunnel (same URL every `docker compose up -d`)

**Goal:** one fixed HTTPS URL that survives restarts, so Paytrail / Vipps
webhooks + redirects always hit the same place. This is the permanent
replacement for the throwaway `trycloudflare.com` quick tunnel (whose URL
changes on every run).

**Provider:** ngrok free tier — gives one reserved static domain per
account at no cost, no domain of your own required.

**Time budget:** ~3 minutes one-time setup. After that it's automatic.

---

## One-time setup

### 1. Create a free ngrok account
<https://dashboard.ngrok.com/signup> — email + password, no card.

### 2. Grab your authtoken
Dashboard → **Your Authtoken** (<https://dashboard.ngrok.com/get-started/your-authtoken>).
Copy it.

### 3. Claim your free static domain
Dashboard → **Domains** → **Create Domain**. You get one free domain that
looks like:
```
bloomoulu.ngrok-free.app
```
(the prefix is partly chosen for you on the free tier — note the exact
value).

### 4. Put both into `.env`
Open `production/.env` and set:
```ini
NGROK_AUTHTOKEN=<the authtoken from step 2>
NGROK_DOMAIN=<your domain from step 3, e.g. bloomoulu.ngrok-free.app>
```

### 5. Point the stack at the domain (one command)
```bash
cd production
bash scripts/use-ngrok-domain.sh bloomoulu.ngrok-free.app
```
This rewrites `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_API_URL`,
`PAYTRAIL_RETURN_URL`, `PAYTRAIL_CALLBACK_URL` to your domain and sets
`COMPOSE_PROFILES=tunnel` so the tunnel is part of `docker compose up -d`.

### 6. First boot
```bash
docker compose up -d --build
```
The `--build` is needed **once** because the donor-facing URL
(`NEXT_PUBLIC_*`) is baked into the web image at build time. Since the
domain never changes, you only ever build once.

---

## Day-to-day

```bash
docker compose up -d      # same URL, no rebuild, tunnel comes up too
docker compose down       # stops everything including the tunnel
```

Your stack is permanently at:
```
https://bloomoulu.ngrok-free.app                      ← donor site
https://bloomoulu.ngrok-free.app/admin                ← admin
https://bloomoulu.ngrok-free.app/webhooks/paytrail    ← Paytrail webhook
https://bloomoulu.ngrok-free.app/en/donate/complete   ← Paytrail return
```

Register `https://bloomoulu.ngrok-free.app/webhooks/paytrail` once in the
Paytrail (and `/webhooks/mobilepay` in the Vipps) portal — it never
changes again.

---

## How it works

```
ngrok edge ──TLS──> ngrok container ──http──> web:3000
                                                 │
                              Next.js rewrites (next.config.mjs):
                                 /v1/*       ─────────> api:4000
                                 /webhooks/* ─────────> api:4000
```

A single hostname serves the whole flow: donor pages from web, and
`/v1/*` + `/webhooks/*` proxied to the api by `API_REWRITE_TARGET=http://api:4000`
(set on the web service in docker-compose.yml). Same-origin → no CORS, no
DNS lag, no second subdomain.

The `ngrok` service lives in the `tunnel` compose profile, so it only runs
when `COMPOSE_PROFILES=tunnel` is set (which `use-ngrok-domain.sh` does).
Local-only dev without a tunnel still works with a plain `docker compose
up -d` and no profile.

---

## Caveats (free tier)

- **Interstitial page:** the first browser visit per session shows an
  ngrok "You are about to visit…" warning — click through once; ngrok
  sets a cookie and won't show it again that session. **Webhook POSTs
  from Paytrail are server-to-server and never see it**, so payment
  confirmation is unaffected.
- **1 GB/month transfer + rate limits** — ample for testing, not for
  production traffic. For real production use the VPS + Caddy path
  (`docs/runbook/dns-and-tls.md`) on your own domain.

---

## Going to a real domain later

When you have `bloomoulu.fi` delegated, switch off the tunnel and use the
Caddy reverse proxy that's already in docker-compose.yml:
```bash
# .env
COMPOSE_PROFILES=          # (empty — drop the tunnel)
NEXT_PUBLIC_WEB_URL=https://bloomoulu.fi
NEXT_PUBLIC_API_URL=https://bloomoulu.fi
PAYTRAIL_CALLBACK_URL=https://api.bloomoulu.fi/webhooks/paytrail
```
Then follow `docs/runbook/dns-and-tls.md`. No code changes — only env.
