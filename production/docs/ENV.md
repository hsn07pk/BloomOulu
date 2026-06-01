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

### Tier pricing (annual / monthly cents)

| Var | Default | Tier |
|---|---|---|
| `TIER_SEEDLING_ANNUAL_CENTS` / `..._MONTHLY_CENTS` | 2500 / 300 | Seedling |
| `TIER_ROOTED_ANNUAL_CENTS` / `..._MONTHLY_CENTS` | 7500 / 800 | Rooted |
| `TIER_VULNERABLE_ANNUAL_CENTS` / `..._MONTHLY_CENTS` | 25000 / 2500 | Vulnerable |
| `TIER_ENDANGERED_ANNUAL_CENTS` / `..._MONTHLY_CENTS` | 75000 / 7500 | Endangered |
| `TIER_CORPORATE_ANNUAL_CENTS` | 250000 (monthly disabled) | Corporate |

Prices in the running DB always win; the env vars only set the **seed** value
on first boot. After deploy, edit per-tier prices in /admin → Tier.

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

### Adoption flow

| Var | Default | Notes |
|---|---|---|
| `ADOPTION_GIFT_WRAP_CENTS` | `400` | €4 linen-card add-on |
| `ADOPTION_DONATION_SHARE_BP` | `7200` | 72% donation / 28% benefits (donor disclosure box) |
| `ADOPTION_PLAQUE_ELIGIBLE_TIERS` | `endangered,corporate` | comma-separated tier IDs |
| `ADOPTION_DEDICATION_MAX_CHARS` | `240` | nickname / dedication length limit |
| `ADOPTION_CO_ADOPTER_MAX` | `10` | max split-the-gift co-adopters |
| `ADOPTION_FUNDS_FLOW_URL` | `/about#funds-flow` | link from disclosure box |

### VAT, receipts, GDPR

| Var | Default | Notes |
|---|---|---|
| `VAT_DONATION_RATE_BP` | `0` | Finnish yleishyödyllinen yhteisö = VAT exempt |
| `VAT_PERK_RATE_BP` | `2400` | 24% on physical perks (gift-wrap etc.) |
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

## Verifying your config

```bash
# Show what the api saw at startup
docker compose exec api printenv | grep -E '^(GARDEN|ASK|TIER|ADOPTION|PAYMENT|VAT|RECEIPT|GDPR|KIOSK)' | sort

# Show what /v1/settings/public returns (admin overrides + seed defaults)
curl -s http://localhost:4000/v1/settings/public | python3 -m json.tool
```

If both match, your prod-flip is correct: every place in the code that
needs a value reads from `process.env` (and SystemSetting at runtime).
