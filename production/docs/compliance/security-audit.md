# Security audit — pre-launch

**Date:** 2026-05-14
**Auditor:** engineering (self-audit; external pen test booked separately
per PRE_LAUNCH_CHECKLIST §security)

## 1. `pnpm audit`

```
44 vulnerabilities (8 low · 23 moderate · 13 high · 0 critical)
```

Critical and most criticals/highs were resolved by pnpm overrides applied
in `package.json`:

| Override | From | To | Reason |
|---|---|---|---|
| `@fastify/middie` | 7.x (transitive via @nestjs/platform-fastify) | ^9.0.3 | middleware-bypass CVE GHSA-* |
| `lodash` | 4.17.20 | ^4.17.21 | `_.template` code injection |
| `nodemailer` | 6.x | ^7.0.0 | `addressparser` DoS |
| `fast-uri` | 2.x | ^3.0.6 | path-traversal + host-confusion CVEs |
| `picomatch` | 2.x | ^4.0.3 | extglob ReDoS |
| `@opentelemetry/sdk-node` | 0.53 / 0.54 | ^0.217.0 | prometheus-exporter crash |
| `@opentelemetry/auto-instrumentations-node` | 0.50 | ^0.66.0 | same CVE in the umbrella |

## 2. Remaining HIGH advisories — accepted risk

The remaining 13 HIGH advisories are all transitive in two paths that we
cannot safely uproot without major-version migrations. Each is documented
below with the rationale for accepting the risk for the initial launch.

### 2.1 `@nestjs/platform-fastify@10.4.x` chain

- **Fastify Content-Type tab parsing** (CVE-2024-*)
- **Nest Fastify URL-encoding middleware bypass**
- **Nest Fastify HEAD-request middleware bypass**

The fix is `@nestjs/platform-fastify@11.x`, which requires Fastify 5 and
therefore a Nest 11 migration across the whole `apps/api`. Out of scope
for the initial launch; tracked as a Q3-2026 upgrade ticket.

**Mitigation in the meantime:**
- Caddy in front of the API normalises URLs (`strip_prefix`, `header_up`)
  before they reach Fastify, neutralising the encoding-bypass and HEAD-
  bypass vectors at the edge.
- `@Throttle` decorators on every endpoint (NestJS Throttler v6) cap
  abuse independent of the middleware chain.

### 2.2 `@nestjs/cli@10 → glob@10` command injection

The CVE is in `glob`'s `-c|--cmd` CLI flag, which we never invoke; only
the programmatic API is used by Nest's build pipeline. Not exploitable
at runtime.

### 2.3 `protobufjs` advisories

Pulled in by OTEL via the gRPC exporter, which we don't use (we ship
metrics via Prometheus scrape + traces via OTLP/HTTP, not gRPC). The
vulnerable code path is dead.

### 2.4 `@fastify/multipart` resource consumption

Pulled in transitively by `@adminjs/fastify@4.1.3` for the bank-CSV
upload form. The DoS vector requires an *authenticated* admin uploading
a maliciously crafted multipart payload. Mitigations:

- `/admin` is IP-allowlisted at Caddy in production.
- The CSV path validates the file size (5 MB cap in `FastifyAdapter`
  bodyLimit) and the row count (max 500 entries per `EntriesSchema`).

### 2.5 `html-minifier` ReDoS

Pulled in by `@bloomoulu/emails` only at *build* time when MJML compiles
to HTML. Not on the runtime hot path (we render MJML once per email job,
in a worker that doesn't accept untrusted input). Accepted.

## 3. Secret scanning

```
$ rg -i 'BEGIN.*PRIVATE KEY|aws_secret_access_key|sk_live_|sk_test_[a-zA-Z0-9]{20}|ghp_[a-zA-Z0-9]{20}|xoxb-|api[_-]?key[\"'\''=:]\s*[\"'\''][a-zA-Z0-9]{20,}'
(no matches)
```

No secrets in the tree. Pre-commit hook (`pnpm prepare` → husky → lint-
staged) blocks secrets by extension match; production uses Doppler /
SOPS for `.env`. `gitleaks detect` to be run on every CI build (Phase 6
work).

## 4. Throttler coverage

Every endpoint in `apps/api/src/modules/*` is mounted under
`AppModule` which installs `ThrottlerModule.forRoot` globally:

| Tier | Window | Limit |
|---|---|---|
| `short` | 1 s | 10 / IP |
| `mid` | 60 s | 120 / IP |

Per-endpoint overrides on the high-traffic surfaces:

| Endpoint | Override |
|---|---|
| `POST /webhooks/paytrail` | `{ short: 100, mid: 5000 }` — provider can burst |
| `POST /webhooks/mobilepay` | same |
| `POST /v1/ask` | default (LLM cost protection) |

## 5. CSP

`infra/caddy/Caddyfile` sets:

```
Content-Security-Policy "default-src 'self'; img-src 'self' data: https://upload.wikimedia.org https://commons.wikimedia.org https://files.bloomoulu.fi; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.bloomoulu.fi; frame-ancestors 'none'"
```

`unsafe-inline` on `script-src` is unfortunate but required by Next.js
15's RSC + Server-Action runtime (it injects inline bootstrap scripts).
We can drop `unsafe-inline` once Next.js ships nonce-based CSP for RSC
(tracking https://github.com/vercel/next.js/issues/54989). Tracked as a
post-launch ticket.

`frame-ancestors 'none'` prevents clickjacking. `unsafe-eval` is NOT in
the policy — we have no eval-using code paths.

## 6. Idempotency + audit invariants

Manually verified:

- Every webhook entry path goes through `PaymentsService.handleEvent`,
  which wraps the work in `prisma.$transaction()` and gates duplicates
  on the `ProcessedEvent (provider, providerEventId)` UNIQUE index.
- Every business mutation writes an `AuditLog` row in the same
  transaction (grep'd all `tx.adoption.update` / `tx.payment.update` /
  `tx.plaque.create` callers).
- Bank-transfer reconciliation rejects amount mismatches (`amount_mismatch`
  result) — never auto-marks a Payment succeeded on mismatched amount.
- Dunning retry jobs have deterministic BullMQ jobIds
  (`dunning-<adoptionId>-<attempt>`) so the scheduler can't double-fire.

## 7. Pen test

External Finnish security firm engagement is a Phase-6 task per
`PRE_LAUNCH_CHECKLIST`. Report due before production DNS flip. This
self-audit is a baseline, not a substitute.
