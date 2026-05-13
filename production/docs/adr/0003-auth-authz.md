# ADR-0003: Authentication and authorisation

**Status:** Accepted
**Date:** 2026-05-13

## Context

We have three distinct caller populations:

1. **Donors** (public) — buy adoptions, view receipts, manage own data.
2. **Staff** (curator / finance / admin) — content + payments + audit.
3. **Kiosk devices** (machine-to-machine) — read feed + heartbeat.

We want zero password storage. Universities run an Identity Provider; donors don't want yet another login.

## Decision

### Donors — email magic links

- Auth.js v5 (NextAuth beta) with the `Credentials` provider.
- `POST /v1/auth/magic-link` (rate-limited, OWASP-compliant: doesn't reveal whether an address exists) inserts a `VerificationToken` row with a 15-minute TTL.
- Email containing a deep link `https://bloomoulu.fi/sign-in/verify?token=…` is queued via the email worker.
- On click, Next.js Credentials provider verifies via `POST /v1/auth/verify-magic-link`, deletes the token, upserts the `User` row, and Auth.js writes a session cookie.
- Session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, signed with `AUTH_SECRET`.

### Staff — University of Oulu OIDC

- Auth.js OIDC provider configured against `https://login.oulu.fi/.well-known/openid-configuration`.
- Returning `User.ouluUid = sub` so we can map back from claims.
- Staff `role` is set by an admin in the admin panel; OIDC only proves identity, not authority.

### Kiosk devices

- One-time 8-char pairing code issued from the admin panel, valid 10 minutes.
- Kiosk client posts code + device fingerprint to `POST /v1/kiosks/pair`; receives a long-lived `deviceToken` (random 256-bit, hashed at rest).
- Subsequent calls (`/heartbeat`, `/feed`) include the token in the `Authorization: Bearer` header.

### Authorisation

We use **role-based access control** with three staff roles + the implicit donor role:

| Role | Surface |
|---|---|
| `donor` | own data only (`/v1/users/:id` checks `req.user.id === id`) |
| `curator` | Plant / Accession / Citation / Narration / RagDocument read+write |
| `finance` | Payment / Receipt / TaxCertificate / Reconciliation read+write; refund action |
| `admin` | everything, including Settings + Translations + role assignment |

RBAC is enforced at three layers:

1. **NestJS guard** (`@RolesAllowed('curator', 'admin')`) on every controller method that needs it.
2. **Prisma middleware** — for `User` and `Adoption`, a row-level check that `actor === resource.donorId` or `actor.role === admin`.
3. **AdminJS resource visibility** — `isAccessible` callback consults `currentAdmin.role`.

### Audit

Every authentication event is recorded in `AuditLog`:

- `auth.magic-link.issued` (success-only; failure not audited to avoid log spam)
- `auth.magic-link.verified` (with userId + ip + ua)
- `auth.oidc.sign-in` (with claims subset)
- `auth.session.created`
- `auth.session.revoked`

## Consequences

**Positive**

- No password storage → no password leaks.
- Auth.js handles the cookie + CSRF tokens, the parts where homemade auth bugs live.
- Magic-link UX is well-understood by Finnish donors (it's what Posti, Nordea Open Banking, etc. use).

**Negative**

- Magic-link email deliverability is its own ops concern; we mitigate by self-hosting Postal + warming the IP + SPF/DKIM/DMARC verified.
- OIDC against `login.oulu.fi` requires registering an OAuth client with the University IT — adds one human handover step.

## Open questions

- Are staff allowed to sign in via magic link as a fallback if OIDC is down? Default: no. Override per ADR amendment if needed.
- Do we offer Passkeys (WebAuthn) for donors? Phase 2 once Auth.js stabilises its Passkey adapter.
