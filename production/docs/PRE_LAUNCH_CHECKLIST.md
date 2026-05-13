# BloomOulu — Pre-launch Go / No-Go checklist

Owner: garden director + engineering lead. Run end-to-end the week before
launch. Every box must be ticked before flipping production DNS.

## Engineering — must be green

- [ ] `pnpm install && pnpm typecheck && pnpm test` clean on `main`.
- [ ] `pnpm db:migrate:deploy` applied cleanly to the production Postgres.
- [ ] `pnpm db:seed` ran once; seed defaults present on `SystemSetting`,
      `Tier`, `EmailTemplate`, `Translation`, `ContentBlock`, `FeatureFlag`.
- [ ] First production backup successful + the **restore drill** has been
      run on a sibling VPS from that backup (RTO measured ≤ 30 min;
      `docs/runbook/restore-from-backup.md`).
- [ ] `restic check` healthy and snapshot retention policy (30d daily,
      6m weekly, 1y monthly) applied.
- [ ] `pnpm audit` shows no HIGH or CRITICAL.
- [ ] `trivy fs .` clean; `trivy image bloomoulu/{api,web,admin,kiosk}:latest`
      clean of HIGH+.
- [ ] `gitleaks detect` clean (no committed secrets).
- [ ] Every API endpoint that accepts donor input has a `@Throttle`
      decorator with appropriate limits.
- [ ] Caddy CSP shipped; `script-src` does NOT include `'unsafe-inline'`
      unless documented.
- [ ] OTEL traces visible in Tempo for an end-to-end adopt → reconciliation
      → receipt flow.

## Payments — must be green

- [ ] Real **Paytrail merchant** signed; production `PAYTRAIL_MERCHANT_ID`
      + `PAYTRAIL_SECRET` set via Doppler / SOPS. `flag:paymentPaytrail=true`.
- [ ] Webhook URL `https://api.bloomoulu.fi/webhooks/paytrail` registered
      in the Paytrail merchant portal.
- [ ] One real €25 donation completed end-to-end through Paytrail.
      Refunded immediately as a smoke test; refund webhook updates the
      Receipt + Payment correctly.
- [ ] **Vipps MobilePay merchant** signed (or documented as a Phase-2
      launch item if KYC is still in progress).
- [ ] **Real Garden IBAN** configured at `bankTransfer.iban`. The default
      `FI00 0000 0000 0000 00` is gone. `bankTransfer.bic` and
      `bankTransfer.beneficiaryName` confirmed by the Garden's bank.
- [ ] First real €25 bank-transfer donation completed end-to-end. RF
      reference accepted by a real Finnish bank app (Nordea or OP).
- [ ] camt.054 CSV from the real bank uploads cleanly via
      `/admin/pages/reconciliation`.

## Legal — must be green

- [ ] DPIA (`docs/compliance/dpia.md`) reviewed + signed off by the
      University of Oulu DPO. Sign-off table at the bottom filled in.
- [ ] Privacy policy (`legal.privacy` ContentBlock) reviewed by counsel.
      DRAFT banner removed. Controller / DPO email / supervisory
      authority addresses confirmed.
- [ ] Terms (`legal.terms` ContentBlock) reviewed by counsel.
      Cooling-off wording + refund timing confirmed against
      Kuluttajansuojalaki 6:14 §.
- [ ] Accessibility statement (`legal.accessibility` ContentBlock) reviewed
      by counsel. Known-limitations list up-to-date.
- [ ] External **WCAG 2.2 AA audit** (TPGi or Siteimprove) complete.
      Their report at `docs/compliance/wcag-audit-2026-Q3.pdf`. No
      serious unresolved findings.

## Infrastructure — must be green

- [ ] DNS A records configured for `bloomoulu.fi`, `www.bloomoulu.fi`,
      `api.bloomoulu.fi`, `admin.bloomoulu.fi`, `kiosk.bloomoulu.fi`,
      `grafana.bloomoulu.fi`, `errors.bloomoulu.fi`, `ntfy.bloomoulu.fi`.
- [ ] Caddy auto-issued Let's Encrypt certs on first request. SSL
      Labs A+ on `bloomoulu.fi` + `api.bloomoulu.fi`.
- [ ] `https://bloomoulu.fi/healthz` returns 200 from outside the VPS.
- [ ] `/admin` is IP-allowlisted at Caddy. Anonymous public access returns
      403 / closed connection.
- [ ] Postgres + Redis + MinIO volumes have `restic` daily snapshots.
- [ ] ntfy.sh alerts wired to ops + curator phones. Test trip: deliberately
      stop the API container; P0 fires within 60 s.
- [ ] Grafana dashboards (6) load: business, payments, backend, db,
      queues, infra. Each shows live data.

## Security — must be green

- [ ] Pen test by a Finnish security firm complete. No HIGH unresolved.
- [ ] Status page (Uptime Kuma, self-hosted) configured + public.
- [ ] All production secrets in Doppler / SOPS; nothing committed.
- [ ] `AUTH_SECRET` is a fresh `openssl rand -base64 32`, not the dev placeholder.
- [ ] `ADMIN_BOOTSTRAP_PASSWORD_HASH` set once for first admin sign-in,
      then the admin user upgraded to OIDC / magic-link only.
- [ ] Domain SSL cert valid > 60 days.

## Training + handover — must be green

- [ ] Garden staff trained on `/admin` (4-hour session): plant CRUD,
      refunds, reconciliation upload, translation editing, audit log
      review, GDPR queue review.
- [ ] Curator has written ≥ 3 RAG corpus documents per featured plant;
      `pnpm rag:ingest` run; AskTheGarden answers cite correctly.
- [ ] 5 test donors run the full flow end-to-end on staging across
      all three rails (bank, Paytrail, MobilePay if live).
- [ ] `docs/HANDOVER.md` reviewed by garden director + accountant.
- [ ] Engineering retainer contact published in `docs/contacts.md`.

## Day-of launch

- [ ] Final `git pull && docker compose pull && docker compose up -d` on
      the production VPS.
- [ ] Smoke-test all four apps (web, api, admin, kiosk) from outside.
- [ ] Drive one real €25 donation per rail and verify the email arrives.
- [ ] Capture launch screenshot of `/admin/pages/dashboards`.
- [ ] Announce to garden staff; brief them on ntfy.sh alert routing.

When every box is ticked, flip the public DNS and announce. Otherwise
*don't* — the cost of a bad launch (donor email leak, mis-routed
payment, broken receipt) is much higher than a one-week delay.
