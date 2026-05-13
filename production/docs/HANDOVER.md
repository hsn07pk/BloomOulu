# BloomOulu — Handover guide for non-technical operators

This document is written for the Garden staff who will operate the platform
after engineering handover.

## Who does what

- **Admin** (≈ Garden director / IT lead): full access. Manages users, settings, payments.
- **Curator** (≈ Anna Liisa, Tuomas, biology team): plants, photos, audio, RAG corpus.
- **Finance** (≈ Garden accountant): payments, refunds, tax certificates, reconciliation.

## Daily work

### Add a plant
1. Go to `/admin` and sign in.
2. **Catalogue → Plants → New**.
3. Fill in slug (short URL ID), names in FI/SV/EN, Red List status, story in all three languages.
4. Upload an image under **Catalogue → Plant images → New** (attach to the plant).
5. Save. New plants start `hidden`; flip to `active` when ready.

### Edit a price
**Pricing → Tiers → click the tier → Edit**. Save. The change is live within
60 seconds and applies to all *new* adoptions; existing donors are unaffected.

### Refund a payment
**Finance → Payments → click the payment → Actions → Refund**. The receipt
is reversed automatically and a credit note PDF is emailed to the donor.

### Reconcile bank transfers (zero-fee path)
1. Download your daily CSV / camt.054 from Nordea / OP / your bank.
2. Go to **Reconciliation → Upload**.
3. Drop the file in. The system parses RF references, matches them to
   pending Payments, and marks them succeeded. A summary report shows what
   matched, what didn't, and why.

### Edit any text on the website
**Translations**. Search by key (e.g. `Home.heroTitle`), edit the FI / SV / EN
columns, save. The site updates within a minute.

### Trigger a backup
**Backups → Run now**. Takes ~3 minutes.

## Once a month

- Check **Audit & GDPR → Audit log** for anything unexpected.
- Check **Finance → Reconciliation → Exceptions** for unresolved mismatches.
- Review the **System → Health** dashboard. Green = good.

## Alerts on your phone

You'll get push notifications via the **ntfy** app (Android / iOS, free).
Subscribe to the topic the admin gives you. Three tiers:

- 🔴 **P0** wakes you up — payment outage, DB down. Open the runbook in `docs/runbook/`.
- 🟡 **P1** — acknowledge before close of business.
- 🔵 **P2** — review next ops meeting.

## If you're stuck

- The runbook (`docs/runbook/`) covers the top scenarios.
- The Grafana dashboard always shows current system health.
- The audit log shows exactly who changed what, when.
- Engineering retainer contact: see `docs/contacts.md`.

## Important: never share

- Your admin password / magic-link emails.
- The `.env` file or any value from it.
- Any signing secret (Paytrail, MobilePay, AUTH_SECRET).

## Donor privacy (GDPR)

- A donor can request their data → **Audit & GDPR → Data Export → New**.
- A donor can request erasure → **Audit & GDPR → Data Erasure → New**.
  - We pseudonymise PII (email, name, address) but **keep financial records
    for 6 years** as Finnish accounting law requires. The donor will be told
    this in the confirmation email.
- The audit log of all such requests is permanent and read-only.
