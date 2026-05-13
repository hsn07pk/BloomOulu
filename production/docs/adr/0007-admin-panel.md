# ADR-0007: Admin Panel (AdminJS + custom resources)

**Status:** Accepted
**Date:** 2026-05-13

## Context

After handover, the Garden will be operated by curators, an admin assistant, and a finance officer — none of whom are developers. They must be able to:

- Add a plant, upload photos + audio, choose a Red-List status, set the funding target.
- Edit a price for a tier, today.
- Change the wording of the homepage hero in three languages.
- Refund a payment.
- See yesterday's adoptions and total revenue.
- Toggle MobilePay on/off after their merchant agreement is signed.
- Re-send a receipt email.
- Manage the RAG corpus (upload a curator note PDF, re-index).
- See every audit-log line.
- Trigger a fresh backup.

This is wider than a CMS — it's "operations console for a small SaaS". The constraint is also "no recurring SaaS cost" → no Forest Admin.

## Comparison

| Tool | Why considered | Why not picked / why picked |
|---|---|---|
| **AdminJS** ✅ | Mature, FOSS (MIT), drop-in Prisma adapter, RBAC, file uploads, custom React components, hooks (before/after on every action). | **Picked.** Lowest friction over an existing Prisma schema. |
| Payload CMS | TypeScript-first, beautiful UI, code-first content modelling, Next.js native. | Owns its own DB layer + migration story — would force a Prisma-vs-Payload schema duplication or a full rewrite. |
| Directus | Database-first, mature, multi-DB. | Wraps SQL well but its custom-resource story (e.g. translation editor) is heavier. |
| Strapi | Mature plugin ecosystem. | Less natural over an existing Prisma schema; bigger footprint. |
| Refine | Headless admin framework — we build the UI ourselves. | Higher build cost; AdminJS gives 80% of the UI for free. |
| react-admin | Mature, FOSS. | Express-based (we're on NestJS); plumbing JWT auth + RBAC harder than AdminJS. |

## Decision

We mount AdminJS at `/admin` on a small dedicated NestJS module (`AdminModule`). It uses:

- **`@adminjs/prisma`** adapter for automatic CRUD over every Prisma model.
- **Auth.js session cookie** via shared cookie domain; the AdminJS authentication hook checks `user.role ∈ {admin, curator, finance}`.
- **RBAC** — per-resource and per-action visibility. Finance sees Payment/Receipt/Tax. Curator sees Plant/Citation/Narration/RAG. Admin sees everything.
- **Audit middleware** — every AdminJS write fires through the same `AuditLogService` as the API, so the audit log is unified.
- **Custom resources** for:
  - **Translation editor** (`/admin/translations`) — table with locale columns, instant edit, search, "missing" filter, CSV import/export.
  - **Pricing editor** (`/admin/pricing`) — slider/input for each tier price, "Apply effective date" so historical receipts stay correct.
  - **Email template editor** (`/admin/emails`) — MJML editor + live preview + test-send.
  - **Content blocks** (`/admin/content`) — hero, "Where your money goes" modal, donor wall config.
  - **Feature flags** (`/admin/flags`) — boolean toggles for `featureMobilePay`, `featureStripe`, `featureRag`, `featureKiosk`, `featureCorporateTier`.
  - **System settings** (`/admin/settings`) — VAT rate, receipt prefix, backup schedule, GDPR retention window, kiosk pairing TTL.
  - **Webhook log** (`/admin/webhooks`) — paged list of `ProcessedEvent` with payload + retry button.
  - **Reconciliation** (`/admin/reconciliation`) — upload a bank CSV (camt.054 or Tilisiirto), AdminJS matches RF-references to `Payment` rows.
  - **System health** (`/admin/health`) — Grafana dashboard iframe + live "All systems green" indicator.
  - **Backups** (`/admin/backups`) — list of restic snapshots + "trigger backup now" button.

All custom resources are plain React components inside `apps/admin/src/components/`.

## Implementation notes

- AdminJS is *not* visible at all from the public web (it's behind `/admin` + Auth.js role gate + optional VPN whitelist).
- File uploads go to MinIO via a NestJS controller; AdminJS just shows the resulting URL.
- A "Restore default" button on every settings resource resets to the seeded default value with a confirmation modal.
- Every settings value has a `description` shown inline so non-technical staff understand what the toggle does.

## Consequences

**Positive**

- Day-one capability for curators to add plants without engineering involvement.
- Pricing changes are an admin action, not a deploy.
- Single source of truth: `SystemSetting` table is read by both web and API — no config-file drift.

**Negative**

- AdminJS' UI is functional, not beautiful. We accept this; the donor-facing UI is the polished one.

## Future

- Phase 2: replace the AdminJS surface with a custom Refine/Next-admin app for design polish, once the Garden has hired one front-end contractor for a week.
