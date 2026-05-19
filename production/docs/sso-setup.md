# University of Oulu SSO setup (production)

The code in `apps/web/src/app/[locale]/auth/oulu/route.ts` and
`.../auth/oulu/callback/route.ts` implements a standard OpenID Connect
client. It uses `jose` for JWKS-verified id_token validation and signs
its own session cookie (HS256 + `AUTH_SECRET`). No third-party SDK.

Once you have the three env values from University IT, set them in
`.env` (gitignored) and `docker compose up -d` and the "Sign in with
University of Oulu" button starts working.

```
AUTH_OULU_OIDC_ISSUER=https://login.oulu.fi
AUTH_OULU_OIDC_CLIENT_ID=<get from oulu IT>
AUTH_OULU_OIDC_CLIENT_SECRET=<get from oulu IT>
```

## What to ask the University IT helpdesk for

Send the following request to the University's identity team
(`it.helpdesk@oulu.fi` or via the IT service desk):

```
Subject: Request: OIDC relying-party registration for BloomOulu

We're rolling out BloomOulu — the donor + visitor platform for the
University of Oulu Botanical Garden (https://bloomoulu.fi). The site
needs single sign-on for garden staff (curators) and students using
their existing Oulu credentials.

Could you please register an OIDC relying party for us with the
following details?

  Application name:     BloomOulu
  Redirect URI (prod):  https://bloomoulu.fi/en/auth/oulu/callback
                        https://bloomoulu.fi/fi/auth/oulu/callback
                        https://bloomoulu.fi/sv/auth/oulu/callback
  Logout URI (prod):    https://bloomoulu.fi/en/sign-out
  Scopes:               openid email profile
  Token endpoint auth:  client_secret_basic
  Response type:        code
  Grant types:          authorization_code, refresh_token (optional)
  Groups claim:         we map IdP groups containing "garden",
                        "botani", or "curator" to the curator role,
                        and groups containing "admin" to the admin
                        role. Default for everyone else: donor.

We'll need the resulting client_id, client_secret, and the OIDC
discovery document URL (typically the issuer's
.well-known/openid-configuration).

For the local dev environment we also want a separate test
registration with redirect URI http://localhost:3000/en/auth/oulu/callback
so we can test the integration without using production secrets.

Thank you,
BloomOulu team
```

## Local-dev testing without University IT

If you want to test the OIDC flow without waiting on the helpdesk,
register a free test client with any other OIDC provider that lets
you control the issuer URL — `Auth0` free tier and `Keycloak` (run
locally) both work. Then point the three env vars at that provider.

Auth0 dev:
```
AUTH_OULU_OIDC_ISSUER=https://<your-tenant>.eu.auth0.com
AUTH_OULU_OIDC_CLIENT_ID=<auth0 client id>
AUTH_OULU_OIDC_CLIENT_SECRET=<auth0 client secret>
```
Auth0's discovery doc is at `https://<tenant>.eu.auth0.com/.well-known/openid-configuration`,
which matches the format the code expects.

## What happens after the env values are set

1. `docker compose up -d --force-recreate web` so Next.js picks up
   the new env at server boot.
2. The `/sign-in` page detects that `AUTH_OULU_OIDC_CLIENT_ID` is
   non-empty and shows the "Sign in with University of Oulu" button
   again (it's hidden when the env is empty so visitors don't click
   a button that no-ops).
3. The button posts to `/[locale]/auth/oulu`, which:
   - Reads the OIDC discovery doc from
     `${AUTH_OULU_OIDC_ISSUER}/.well-known/openid-configuration`.
   - Generates a random state token, stores it in an HttpOnly cookie.
   - Redirects the browser to the IdP's `authorization_endpoint`.
4. After the user authenticates, the IdP redirects back to
   `/[locale]/auth/oulu/callback` with `code` and `state`. The
   callback handler exchanges the code for an `id_token`, verifies
   the signature against the IdP's published JWKS, then POSTs to
   `/v1/auth/oidc-upsert` (protected by `AUTH_SECRET`) to create or
   update the User row and assign a role.
5. The web layer signs a session JWT and sets the
   `bloomoulu.session` cookie, then redirects to `/garden`.

## Production checklist

- [ ] Env vars set in production secrets store (not committed)
- [ ] `AUTH_URL` set to `https://bloomoulu.fi` (HTTPS, public)
- [ ] `AUTH_SECRET` rotated to a fresh 32+ char value
- [ ] All three redirect URIs registered at the IdP (en/fi/sv)
- [ ] Discovery doc returns 200 from your prod box
- [ ] `bloomoulu.session` cookie marked `secure: true` (automatic when
      `NODE_ENV=production`)
- [ ] Group-to-role mapping reviewed with the IT contact (which
      group names should become `curator` vs `admin`)
- [ ] Magic-link sign-up still works for donors who aren't in Oulu
      SSO (anyone with any email address)
