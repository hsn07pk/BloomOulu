# BloomOulu — System Design

**Audience:** Engineers, ops, finance, future maintainers at the University.
**Status:** Living document. Edit alongside ADRs.

## 1. System context

```mermaid
flowchart LR
  V[Visitor's phone] -->|HTTPS / RSC| W[Next.js Web]
  K[Greenhouse kiosk] -->|HTTPS / SW| W
  C[Curator / Staff] -->|OIDC| W
  W -->|REST + RSC| A[NestJS API]
  A --> DB[(Postgres + pgvector)]
  A --> R[(Redis)]
  A --> S3[(S3-compatible EU)]
  A -->|HTTPS| Stripe
  A -->|HTTPS| MP[MobilePay / Vipps]
  A -->|HTTPS| LLM[Mistral La Plateforme EU]
  A -->|SMTP| Mail[Postmark EU]
  Stripe -->|webhook| A
  MP -->|webhook| A
  A -->|OTLP| O[Grafana Cloud EU]
  A -->|Sentry| E[Sentry EU]
```

## 2. Service map

| Service | Repo path | Runtime | Region | Scaling |
|---|---|---|---|---|
| **web** | `apps/web` | Next.js 15 on Vercel | fra1 (Frankfurt) | Auto (edge) |
| **api** | `apps/api` | NestJS 10 on Fly.io | arn (Stockholm) primary + hel (Helsinki) failover | 2 → 8 machines |
| **workers** | `apps/api` (same image, `JOBS=true`) | BullMQ workers | arn | 2 machines |
| **kiosk** | `apps/kiosk` | Next.js, served standalone on Fly.io | arn | 1 machine, fronted by HTTP cache |
| **db** | Neon serverless Postgres | fra1 | Neon-managed |
| **redis** | Upstash | fra1 | Upstash-managed |

## 3. Critical sequences

### 3.1 Donor adopts a plant via card (Stripe Checkout)

```mermaid
sequenceDiagram
  participant D as Donor (phone)
  participant W as Web (Next.js)
  participant A as API (NestJS)
  participant S as Stripe
  participant DB as Postgres

  D->>W: GET /en/adopt?plant=puls-pat&tier=vulnerable
  W->>A: GET /plants/puls-pat (RSC)
  W->>A: GET /tiers (RSC, cached 1h)
  A-->>W: data
  W-->>D: SSR page

  D->>W: POST /adopt (form action)
  W->>A: POST /adoptions {plantId, tierId, intent, locale, recurring}
  A->>DB: INSERT Adoption (status=pending, orderId=uuidv7)
  A->>S: POST /v1/checkout/sessions (line_items, metadata{orderId})
  S-->>A: { id, url }
  A->>DB: INSERT Payment(provider=stripe, orderId, sessionId, status=pending)
  A-->>W: 303 → checkout.stripe.com/c/pay/...
  W-->>D: redirect

  D->>S: card details + 3DS challenge
  S-->>D: success page → return_url
  D->>W: GET /en/garden?orderId=...

  S->>A: POST /webhooks/stripe checkout.session.completed
  A->>A: verify Stripe-Signature
  A->>DB: INSERT ProcessedEvent(providerEventId) ON CONFLICT DO NOTHING
  A->>DB: UPDATE Payment status=succeeded, vat...
  A->>DB: UPDATE Adoption status=active, plaqueRequested=...
  A->>DB: INSERT Receipt rows, enqueue PDF job, enqueue email job
  A-->>S: 200 OK
```

Recovery rules:

- Stripe will retry the webhook with exponential backoff for 3 days.
- If `ProcessedEvent` exists, we return 200 immediately (idempotent).
- If we 500, Stripe retries. Our SLO: webhook processing < 500ms P95.

### 3.2 Donor adopts via MobilePay (recurring annual)

```mermaid
sequenceDiagram
  participant D as Donor
  participant W as Web
  participant A as API
  participant V as Vipps MobilePay
  participant DB as Postgres

  D->>W: choose MobilePay, tier=Rooted €75/yr
  W->>A: POST /adoptions {provider=mobilepay, recurring=true}
  A->>V: POST /recurring/v3/agreements (productName, pricing, redirectUrl)
  V-->>A: { agreementId, vippsConfirmationUrl }
  A->>DB: INSERT Adoption(status=pending) + Agreement(...)
  A-->>W: 303 → vippsConfirmationUrl

  D->>V: opens MobilePay app, approves agreement (biometric → SCA satisfied)
  V-->>D: success deep-link → BloomOulu return
  D->>W: GET /en/garden?agreement=...

  V->>A: POST /webhooks/mobilepay agreement.activated
  A->>DB: UPDATE Agreement status=active, nextCharge=now+0
  A->>V: POST /recurring/v3/agreements/{id}/charges (first charge)
  V-->>A: { chargeId, status=PENDING }
  A->>DB: INSERT Payment(status=pending)

  V->>A: POST /webhooks/mobilepay charge.captured
  A->>DB: UPDATE Payment status=succeeded
  A->>A: same downstream jobs as Stripe path (receipt, email, plaque request)
```

Yearly renewal: a cron worker scans `Agreement.nextCharge <= now()` and issues the next charge. Failures (insufficient funds) move the agreement to `failed` and trigger a `dunning` flow (3 retries over 14 days, then cancel + notify).

### 3.3 AskTheGarden question

```mermaid
sequenceDiagram
  participant V as Visitor
  participant W as Web
  participant A as API
  participant E as Mistral Embeddings
  participant R as Cohere Rerank
  participant L as Mistral LLM
  participant DB as Postgres

  V->>W: types "What's blooming in the Romeo greenhouse?"
  W->>A: POST /ask (streaming)
  A->>A: classify intent → on_topic
  A->>E: embed(q_canonical)
  E-->>A: vector[1024]
  A->>DB: top-12 chunks by cosine
  A->>R: rerank(q, chunks) → top-5
  A->>A: score floor 0.72 satisfied? yes
  A->>L: stream(system + context + q) SSE
  L-->>A: tokens (streamed)
  A-->>W: SSE tokens + final citations
  W-->>V: streams to chat, citation chips
  A->>DB: persist AskMessage + AskAnswer + reaction null
```

### 3.4 Kiosk pairing + heartbeat

```mermaid
sequenceDiagram
  participant K as Kiosk
  participant W as Web
  participant A as API
  participant C as Curator

  C->>W: /admin/kiosks/new → generates 8-digit pairing code
  W->>A: POST /kiosks {label, location}
  A-->>W: { kioskId, pairingCode, pairingExpiresAt=+10m }

  K->>W: opens /kiosk/pair → enters code
  W->>A: POST /kiosks/pair {code, deviceFingerprint}
  A->>A: verify code valid + unused
  A-->>W: { kioskId, deviceToken (long-lived JWT) }
  W-->>K: store token in keychain

  loop every 60s
    K->>A: POST /kiosks/heartbeat (deviceToken)
    A->>DB: UPDATE KioskDevice.lastSeen
  end
```

If `lastSeen > now - 5m`, ops gets a Slack alert. The kiosk has a hardware watchdog: if its own healthcheck fails for 3 min, it reboots into a kiosk-locked Chromium.

## 4. Data flow: webhook to receipt

```
Stripe webhook  ── HTTP ──►  /webhooks/stripe  ─┐
                                                 │
MobilePay webhook ─ HTTP ─►  /webhooks/mobilepay ┴►  PaymentEventsHandler
                                                       │
                                                       ▼
                                            UPDATE Payment (txn)
                                                       │
                                                       ▼
                                           enqueue ReceiptJob
                                                       │
                                                       ├──► render PDF (react-pdf)
                                                       ├──► upload S3 EU
                                                       ├──► UPDATE Receipt.pdfUrl
                                                       └──► enqueue EmailJob
                                                                  │
                                                                  ▼
                                                          Postmark → donor
```

## 5. Failure modes

| Failure | Detection | Response |
|---|---|---|
| Stripe webhook flood | `webhook.received` Prom counter > 10× normal | rate limit per-IP, alert ops |
| Stripe outage | Stripe status page subscription | display banner "Bank payments slow"; fall back to MobilePay-only UI |
| MobilePay outage | health probe failure | display "MobilePay temporarily unavailable, try card"; surface kiosk fallback to ticket-hall donations |
| pgvector latency spike | OTEL p95 > 200ms | warm Redis cache, alert; fall back to keyword search |
| Mistral outage | provider 5xx > 3 in 60s | escalation card "We'll get back to you" + queue question |
| Audio asset CDN slow | client-reported error | switch to direct S3 URL with signed token |

## 6. Capacity (year 1)

Pitch targets: 100 adopters by month 12, ~€9k revenue, 30k web visitors annual, 7 plant-page views per visit.

- 30k × 7 = ~210k plant-page views/year ≈ 600/day average, ~10k/day peak on press days.
- 1.5 RPS average, ~30 RPS peak — comfortable on a 2-core Fly.io machine.
- pgvector: ~10k chunks, HNSW index, p95 retrieval < 50ms.
- Storage: audio 24 narrations × 3 langs × ~500KB = 36MB. Plant photos ~30MB. Receipt PDFs (estimated 200/year × 100KB) = 20MB.

We provision for ×10 these numbers and still stay under €120/month total ops cost.

## 7. Open questions (for the University + Garden)

1. **Accession DB** — is there a documented export endpoint, or do we run a Postgres FDW directly into the University DB? (Affects the catalogue sync job.)
2. **Phenology log format** — Markdown in Git? Notion? Airtable? Affects the curator's daily workflow.
3. **Photography release** — every staff/curator photo on the donor dinner page needs a written release. Template in `docs/legal/photo-release.md`.
4. **DPO contact** — published in `/privacy` per GDPR Art. 13. Currently TBD.
