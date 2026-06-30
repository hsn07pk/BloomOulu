# Environment variables — the full matrix

This is the single source of truth for every env var BloomOulu reads.
Defaults make `docker compose up -d` work on localhost; production
flip is `.env` only — no code changes.

## How the layers stack

1. **docker-compose.yml** declares every variable with `${NAME:-default}`.
2. **`.env`** in the repo root overrides any default. This file is
   git-ignored — paste your production values here.
3. **`/admin → SystemSetting`** wins at runtime for the subset that maps
   to `BloomOuluSettings` (see `apps/api/src/modules/settings/settings.service.ts`).
4. Code never reads literal values — everything funnels through
   `process.env` (api) or `process.env.NEXT_PUBLIC_*` (web build args).

## Switching to production

Set these in `.env` and run `docker compose up -d --build`:

```bash
# ─── Domain & URLs ───────────────────────────────────────────────
NEXT_PUBLIC_WEB_URL=https://bloomoulu.fi
NEXT_PUBLIC_API_URL=https://api.bloomoulu.fi
NEXT_PUBLIC_ADMIN_URL=https://admin.bloomoulu.fi
NEXT_PUBLIC_KIOSK_URL=https://kiosk.bloomoulu.fi

# ─── Garden identity ─────────────────────────────────────────────
GARDEN_IBAN=FI21 1234 5600 0007 85
GARDEN_BIC=OKOYFIHH
GARDEN_ORG_NAME=Oulun yliopiston kasvitieteellinen puutarha
GARDEN_ORG_VAT_ID=0245259-2
GARDEN_ADDRESS=Linnanmaa, 90014 Oulun yliopisto
GARDEN_DONATE_URL=https://bloomoulu.fi/en/donate/pay

# ─── Contact emails ──────────────────────────────────────────────
NEXT_PUBLIC_CURATOR_EMAIL=curator@bloomoulu.fi
NEXT_PUBLIC_SUPPORT_EMAIL=donate@bloomoulu.fi
ASK_CURATOR_EMAIL=curator@bloomoulu.fi
ASK_CURATOR_NAME=Anna Liisa Ruotsalainen
WEBAPP_USER_AGENT_EMAIL=conservation@bloomoulu.fi
EMAIL_FROM="BloomOulu <noreply@bloomoulu.fi>"
EMAIL_REPLY_TO=donate@bloomoulu.fi

# ─── SMTP (Gmail App Password or transactional provider) ─────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your.real@gmail.com
SMTP_PASS=xxxxxxxxxxxxxxxx

# ─── Auth ────────────────────────────────────────────────────────
AUTH_SECRET=<32+ char random string>
AUTH_OULU_OIDC_ISSUER=https://login.oulu.fi/...        # set when University IT registers you
AUTH_OULU_OIDC_CLIENT_ID=...
AUTH_OULU_OIDC_CLIENT_SECRET=...
ADMIN_BOOTSTRAP_EMAIL=ops@bloomoulu.fi
ADMIN_BOOTSTRAP_PASSWORD_HASH=$2a$10$...                # bcrypt; escape the $ as $$

# ─── Paytrail (real merchant) ─────────────────────────────────────
PAYTRAIL_MOCK=false                                     # ← key switch
PAYTRAIL_MERCHANT_ID=<your merchant id>
PAYTRAIL_SECRET=<your secret>
PAYTRAIL_WEBHOOK_SECRET=<your webhook secret>
PAYTRAIL_API_URL=https://services.paytrail.com
PAYTRAIL_CALLBACK_URL=https://api.bloomoulu.fi/webhooks/paytrail
PAYTRAIL_RETURN_URL=https://bloomoulu.fi/en/donate/complete
PAYMENTS_PAYTRAIL_ENABLED=true

# ─── MobilePay (after registering at developer.vippsmobilepay.com) ─
MOBILEPAY_CLIENT_ID=...
MOBILEPAY_CLIENT_SECRET=...
MOBILEPAY_SUBSCRIPTION_KEY=...
MOBILEPAY_MERCHANT_SERIAL_NUMBER=...
MOBILEPAY_WEBHOOK_SECRET=...
MOBILEPAY_API_URL=https://api.vipps.no                 # production
MOBILEPAY_RETURN_URL=https://bloomoulu.fi/en/garden
MOBILEPAY_CALLBACK_URL=https://api.bloomoulu.fi/webhooks/mobilepay
PAYMENTS_MOBILEPAY_ENABLED=true

# ─── S3 / MinIO (real S3 in prod) ────────────────────────────────
S3_REGION=eu-north-1
S3_BUCKET=bloomoulu-assets
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# S3_ENDPOINT is unset to use AWS S3 directly; in compose dev it points to MinIO

# ─── Database (managed Postgres in prod) ─────────────────────────
POSTGRES_HOST=...
POSTGRES_USER=bloomoulu
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=bloomoulu
```

## Full variable reference

### Garden identity

| Var | Default | Where used |
|---|---|---|
| `GARDEN_IBAN` | `FI00 0000 0000 0000 00` | settings.service, /donate/pay |
| `GARDEN_BIC` | `NDEAFIHH` | settings.service, /donate/pay |
| `GARDEN_ORG_NAME` | `Oulun yliopiston kasvitieteellinen puutarha` | settings.service, receipts |
| `GARDEN_ORG_NAME_EN/FI/SV` | (locale-specific names) | web `lib/contact.ts`, kiosk |
| `GARDEN_ORG_VAT_ID` | `FI02452579` | tax certificates, PDF receipts |
| `GARDEN_ADDRESS` | `Linnanmaa, 90014 Oulun yliopisto` | PDF receipts, tax certs |
| `GARDEN_DONATE_URL` | derived from `NEXT_PUBLIC_WEB_URL` | bank-transfer instructionsUrl |

### Contact & support

| Var | Default | Where used |
|---|---|---|
| `NEXT_PUBLIC_CURATOR_EMAIL` | `curator@bloomoulu.fi` | web `lib/contact.ts`, donate-complete, garden GDPR banner |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `donate@bloomoulu.fi` | web `lib/contact.ts` |
| `ASK_CURATOR_EMAIL` | `curator@bloomoulu.fi` | api escalation inbox |
| `ASK_CURATOR_NAME` | `Anna Liisa Ruotsalainen` | RAG response footer |
| `ASK_CURATOR_REPLY_SLA_DAYS` | `2` | RAG response footer |
| `WEBAPP_USER_AGENT_EMAIL` | `conservation@bloomoulu.fi` | `User-Agent` for web-search fallback |

### Payments

| Var | Default | Notes |
|---|---|---|
| `PAYMENTS_BANK_TRANSFER_ENABLED` | `true` | router falls back here for FI donors |
| `PAYMENTS_PAYTRAIL_ENABLED` | `true` | required for Card method |
| `PAYMENTS_MOBILEPAY_ENABLED` | `false` | enable after Vipps registration |
| `PAYTRAIL_MOCK` | `true` (localhost) / `false` (prod) | mocks hosted checkout, real signing |
| `PAYTRAIL_MERCHANT_ID` | `375917` (public test) | replace with your real merchant id |
| `PAYTRAIL_SECRET` | `SAIPPUAKAUPPIAS` (public test) | replace with your real secret |
| `MOBILEPAY_*` | empty | see Vipps developer portal |

### Donation flow

Donations are one-time gifts (no tiers, perks, or recurring billing). The
donate form reads these via `/v1/settings/public`; admins can also edit them
live in /admin → Donations. Env vars set the boot defaults.

| Var | Default | Notes |
|---|---|---|
| `DONATION_SUGGESTED_AMOUNTS_CENTS` | `500,1500,2500,5000` | comma-separated cents — the quick-pick chips |
| `DONATION_DEFAULT_AMOUNT_CENTS` | `2500` | preselected amount (donate form + kiosk fallback) |
| `DONATION_ALLOW_CUSTOM_AMOUNT` | `true` | allow a free custom amount in addition to the chips |
| `DONATION_MIN_CENTS` | `100` | self-serve floor (€1) |
| `DONATION_MAX_CENTS` | `1000000` | self-serve ceiling (€10,000); larger gifts go to a human |
| `DONATION_DEDICATION_MAX_CHARS` | `240` | public dedication length limit |
| `DONATION_FUNDS_FLOW_URL` | `/about#funds-flow` | "where your gift goes" link |

### VAT, receipts, GDPR

| Var | Default | Notes |
|---|---|---|
| `VAT_DONATION_RATE_BP` | `0` | Finnish yleishyödyllinen yhteisö = VAT exempt |
| `VAT_PERK_RATE_BP` | `2400` | 24% standard rate (reserved; donations are exempt) |
| `RECEIPT_PREFIX` | `BLO` | renders as `BLO-2026-000001` |
| `RECEIPT_YEAR_RESET` | `true` | counter resets on Jan 1 |
| `GDPR_AUDIT_RETENTION_DAYS` | `2190` (6 years) | Finnish Kirjanpitolaki 2:5 §. Non-financial AuditLog pruned by the daily retention sweep past this window |
| `GDPR_PSEUDONYMISE_AFTER_DAYS` | `2190` | inactive donor Users pseudonymised by the retention sweep past this window |
| `GDPR_ASK_MESSAGE_RETENTION_DAYS` | `365` | AskTheGarden transcript text pseudonymised after this window (policy: 12 months) |
| `GDPR_ANALYTICS_RETENTION_DAYS` | `90` | PlantScan / KioskEvent / ObservabilityEvent deleted after this window (policy: 90 days) |
| `RETENTION_CRON_DISABLED` | `false` | set `true` to skip registering the daily 03:45 UTC GDPR retention sweep |
| `KIOSK_DEFAULT_AMOUNT_CENTS` | `2500` | preset when QR doesn't carry amount |

### AskTheGarden (RAG)

| Var | Default | Notes |
|---|---|---|
| `ASK_CONFIDENCE_THRESHOLD_BP` | `1000` | 0.10 cosine similarity floor |
| `ASK_AUDIT_ERROR_TARGET` | `0.05` | shown on RAG right rail (5% threshold) |
| `ASK_OUT_OF_DOMAIN_BGCI` | `https://tools.bgci.org/plant_search.php` | "not in collection" callout |
| `ASK_OUT_OF_DOMAIN_GBIF` | `https://www.gbif.org/species/search` | |
| `ASK_OUT_OF_DOMAIN_PLANTNET` | `https://identify.plantnet.org/` | image ID fallback |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | reach host's Ollama from inside docker |
| `OLLAMA_LLM_MODEL` | `gemma3:4b` | swap to bigger model for prod |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | 1024-dim multilingual |

### SMTP / email

| Var | Default | Notes |
|---|---|---|
| `SMTP_HOST` | `mailhog` (compose) | use `smtp.gmail.com` / SendGrid / etc. in prod |
| `SMTP_PORT` | `1025` | `465` for Gmail SSL, `587` for STARTTLS |
| `SMTP_SECURE` | `false` | `true` for 465 |
| `SMTP_USER` / `SMTP_PASS` | empty | required for real SMTP |
| `EMAIL_FROM` | `BloomOulu <noreply@bloomoulu.localhost>` | shown to recipients |
| `EMAIL_REPLY_TO` | empty | recipients reply here instead of `noreply` |

### Auth

| Var | Default | Notes |
|---|---|---|
| `AUTH_SECRET` | (must be set) | HMAC key for session JWTs; rotate to invalidate all sessions |
| `AUTH_OULU_OIDC_*` | empty | University of Oulu SSO; awaiting IT registration |
| `ADMIN_BOOTSTRAP_EMAIL` / `_PASSWORD_HASH` | `admin@admin.com` / bcrypt | admin user seeded on first boot |

### Instagram feed ("From our garden, on Instagram")

The homepage band pulls live posts for the handle in `SystemSetting instagram.handle`
(default `oulubotgarden`) via a **tiered, best-effort provider chain** — the first tier
that succeeds wins, and the public scraper is the guaranteed fallback. **All vars are
optional**: with none set, the scraper alone runs (no credentials needed — the account
is public). Resolution order per 6-hourly `instagram-sync` cron: **Graph API → credential
login → scraper**; a tier is skipped if unconfigured and falls through on error, so the
band always keeps last-good content.

| Var | Default | Notes |
|---|---|---|
| `IG_GRAPH_ACCESS_TOKEN` | empty | **Tier 1 — official Instagram Graph API** (recommended). Long-lived token. |
| `IG_GRAPH_USER_ID` | `me` | IG Business user id for the Graph API; `me` resolves from the token. |
| `IG_USERNAME` | empty | **Tier 2 — credential login** (unofficial private endpoint). Login handle. |
| `IG_PASSWORD` | empty | Login password. Username **and** password must both be set to enable this tier. |

**Tier 1 — Graph API (official, ToS-compliant, robust — recommended).** Needs the account
to be a **Business/Creator** account linked to a **Facebook Page**, plus a **Meta app**
(developer.facebook.com) with `instagram_basic`. Generate a **long-lived access token**
(Graph API Explorer → exchange for a 60-day token, then refresh), then
`echo 'IG_GRAPH_ACCESS_TOKEN=<token>' >> .env` (optionally `IG_GRAPH_USER_ID=<id>`) and
`docker compose -f docker-compose.yml -f docker-compose.csc.yml up -d --force-recreate api-worker`.

**Tier 2 — credential login (account username/password).** Drives Instagram's private web
login — **outside Instagram's official API terms**; the first login from a new server IP
may trigger a "suspicious login" email to confirm on the account. The session is cached
(`SystemSetting instagram.session`) so it doesn't re-login every sync. Enable with
`echo 'IG_PASSWORD=<password>' >> .env` (username already set) + recreate `api-worker`.
If Instagram rejects the login it falls back to the scraper.

**Tier 3 — scraper (default, no setup).** Unauthenticated `web_profile_info` via curl
(Instagram TLS-fingerprints + 429s Node's `fetch`, so every tier uses curl). Works for any
public account.

## Verifying your config

```bash
# Show what the api saw at startup
docker compose exec api printenv | grep -E '^(GARDEN|ASK|DONATION|PAYMENT|VAT|RECEIPT|GDPR|KIOSK)' | sort

# Show what /v1/settings/public returns (admin overrides + seed defaults)
curl -s http://localhost:4000/v1/settings/public | python3 -m json.tool
```

If both match, your prod-flip is correct: every place in the code that
needs a value reads from `process.env` (and SystemSetting at runtime).
