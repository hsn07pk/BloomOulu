# Runbook — University of Oulu SSO (staff sign-in)

**Owner:** engineering lead + University IT identity team
**Time budget:** 1 hour after the University IdP registration is granted

The donor side uses Auth.js v5 magic links (email-only, no password).
**Staff** — curators, finance, admin — sign in through the University's
OIDC IdP so their identity is governed by the same lifecycle as the rest
of their University access (offboarding revokes BloomOulu access
automatically).

## 0. Pre-requisites

- A registered OAuth/OIDC client at the University of Oulu IdP.
- The IdP issuer URL (likely `https://login.oulu.fi/auth/realms/oulu` or
  similar — confirm with University IT).
- A list of permitted redirect URIs:
  - `https://bloomoulu.fi/api/auth/callback/oulu`
  - For dev/staging: `https://staging.bloomoulu.fi/api/auth/callback/oulu`

## 1. Register the OAuth client

Send to the University IT identity team:

> Subject: OIDC client registration — BloomOulu
>
> We'd like to register an OIDC client for the University of Oulu
> Botanical Garden's BloomOulu platform.
>
> - **Client name:** BloomOulu
> - **Client type:** confidential (we hold the secret server-side)
> - **Redirect URIs:**
>   - https://bloomoulu.fi/api/auth/callback/oulu
>   - https://staging.bloomoulu.fi/api/auth/callback/oulu
> - **Post-logout URIs:**
>   - https://bloomoulu.fi/fi
> - **Grant type:** authorization_code with PKCE
> - **Requested scopes:** openid, profile, email
> - **PII used:** subject id (stored as `User.ouluUid`), email, name
> - **DPO contact:** dpo@oulu.fi
>
> Audit-log of every staff sign-in is retained 6 years per Finnish
> accounting law.

The team will return:

```
AUTH_OULU_OIDC_ISSUER=<the .well-known/openid-configuration base URL>
AUTH_OULU_OIDC_CLIENT_ID=<client_id>
AUTH_OULU_OIDC_CLIENT_SECRET=<client_secret>
```

Treat the client_secret as **top secret**.

## 2. Configure BloomOulu

Production env via Doppler:

```
AUTH_OULU_OIDC_ISSUER=https://login.oulu.fi
AUTH_OULU_OIDC_CLIENT_ID=<from step 1>
AUTH_OULU_OIDC_CLIENT_SECRET=<from step 1>
```

Auth.js v5 picks these up via `apps/web/src/lib/auth.ts`. The provider
config lives there and is gated on the env vars being present — without
them the OIDC button doesn't render.

## 3. Verify on staging

1. Visit `https://staging.bloomoulu.fi/fi/sign-in`. The page should show
   the magic-link form **and** a new "Sign in with University of Oulu"
   button.
2. Click the OIDC button. You should be redirected to the University
   IdP, sign in with your verkkopankki / Microsoft account / whatever
   the IdP uses, and be returned to BloomOulu.
3. Verify in the database:
   ```bash
   docker compose exec postgres psql -U bloomoulu -d bloomoulu \
     -c 'SELECT id, email, "ouluUid", role FROM "User" ORDER BY "createdAt" DESC LIMIT 5;'
   ```
   Your row should have `ouluUid` populated. **`role` defaults to
   `donor`** — an existing admin must promote you to `curator`,
   `finance`, or `admin` from `/admin/resources/User`.

## 4. Role assignment

The IdP provides identity, not authorisation. Staff promotions happen in
BloomOulu's own admin panel:

- A garden director (existing `admin` role) opens `/admin/resources/User`,
  filters to the new staff person, edits their `role` to one of:
  - `curator` — full plant CRUD + RAG corpus
  - `finance` — refunds, reconciliation, receipts, tax certs
  - `admin` — everything
- The change writes an `AuditLog` entry.

## 5. Offboarding

When a staff member leaves the University:

- The IdP disables their account → next sign-in fails at the IdP, they
  can't reach BloomOulu.
- For belt-and-braces, the garden director sets their `role = donor`
  from `/admin/resources/User` so even an interactive token couldn't
  reach a staff-only resource.
- Their adoptions / receipts / tax certs survive — they continue as a
  donor at the Garden, just no longer as staff.

## 6. Optional: SAML

Some University IdPs prefer SAML over OIDC. If that turns out to be the
case for Oulu, we add `next-auth/providers/saml-jwt` (Auth.js v5
supports it) and re-do step 2 with SAML XML metadata. The data model
(`User.ouluUid`) stays the same.

## Rollback

If the OIDC button breaks (IdP change, secret rotation):

1. Unset `AUTH_OULU_OIDC_CLIENT_ID` in Doppler → the button disappears.
2. Staff fall back to magic-link sign-in (email only) until the OIDC
   issue is fixed.
3. Existing `ouluUid` rows are untouched; reconnecting later requires
   one fresh OIDC dance per user.
