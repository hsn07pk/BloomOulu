# ADR-0011: Payment provider rails — Paytrail + Vipps MobilePay + manual bank transfer

**Status:** Accepted (supersedes ADR-0004)
**Date:** 2026-05-14
**Deciders:** Team Meraki + University of Oulu Botanical Garden

## Context

ADR-0004 specified Stripe + Vipps MobilePay as the payment rails. Two changes
since then make that obsolete:

1. **Cost.** Stripe's per-transaction EU-card fee (~1.4 % + €0.25) is fine
   for the corporate tier (€1,250) but cuts visibly into seedling (€25)
   and rooted (€75) donations. The Garden wanted a zero-fee option.

2. **Finnish-payment-first.** Stripe's coverage of Finnish online-banking
   buttons (Nordea, OP, S-Pankki, Aktia, Ålandsbanken, POP, Säästöpankki,
   Oma Säästöpankki, Handelsbanken) is via Pay-by-Bank which is gated and
   was not GA in FI for new merchants when this decision was made
   (2026-02). **Paytrail** is the Finnish e-commerce standard — 6,500+ FI
   sites — and bundles every FI bank, all card networks, Apple Pay, Google
   Pay, MobilePay (one-off), Siirto, and Klarna in a single integration.

## Decision

Three payment rails behind one `PaymentGateway` port (`packages/payments/`):

| Rail | Adapter | Use case | Fee structure |
|---|---|---|---|
| **Manual bank transfer** | `BankTransferGateway` | **Default.** Donor pays from their bank app using an **ISO 11649 RF Creditor Reference**. Reconciled daily from camt.054 / Tilisiirto CSV. | **Zero per-transaction fee.** Donor money goes 100 % to plants. |
| **Paytrail** | `PaytrailGateway` | Cards (Visa / MC / Amex), all FI online-banking buttons, Apple Pay, Google Pay, MobilePay (one-off), Siirto, Klarna. | Paytrail merchant agreement — typically ~1.0 % + small fixed fee per card transaction; lower per-transaction for FI online-banking buttons. |
| **Vipps MobilePay** | `MobilePayGateway` | **Recurring** MobilePay agreements via the Vipps Recurring API. Paytrail's MobilePay path is one-off only; the direct adapter unlocks the annual / monthly cadence the tier model needs. | Vipps merchant agreement. |

Paytrail and MobilePay are both **toggleable** from `/admin/pages/settings`
once the Garden signs the respective merchant agreements; the platform ships
with only bank transfer enabled.

### Provider router

```ts
function pickProvider(input): ProviderId {
  if (!enabled('paytrail') && !enabled('mobilepay')) return 'bank_transfer';
  if (input.recurring && enabled('mobilepay') && donorPrefers === 'mobilepay') return 'mobilepay';
  if (donorPrefers === 'bank') return 'bank_transfer';
  if (enabled('paytrail')) return 'paytrail';
  return 'bank_transfer';
}
```

The donor's `preferredProvider` overrides the heuristic as long as the chosen
rail is enabled.

### Idempotency

Unchanged from ADR-0004:

- Every charge has a server-generated **UUIDv7 orderId** that doubles as
  the provider's idempotency key and is stored on the `Payment` row.
- Every inbound webhook event has a `providerEventId` that we insert into
  `ProcessedEvent (provider, providerEventId)` with a UNIQUE constraint.
  Conflict → swallowed; business work runs zero times for duplicates.

### RF Creditor References

We generate ISO 11649 RF references from the orderId:

```
RF<2-digit-check><up-to-21-alphanumeric-body>
```

Body = `orderId.replace('-','').toUpperCase().slice(0, 21)`.
Check digits computed per ISO 7064 mod-97-10.
Whitespace inserted every 4 chars for human readability per Finanssiala
recommendation.

Reverse mapping: reconciliation pulls recent pending bank-transfer Payments
and matches by `orderId.replace('-','').toUpperCase().startsWith(rfBody)`. At
year-1 traffic (~50/month) the in-memory match is trivial; if volume grows
we add a generated-column index on the normalised orderId.

### EPC069-12 SEPA QR

The bank-transfer instructions page renders a scannable EPC069-12 QR with
the IBAN + BIC + amount + RF reference pre-filled. Nordea, OP, S-Pankki,
Aktia, and Ålandsbanken banking apps recognise it natively — the donor
scans, confirms, done.

### Dunning state machine

Failed recurring charges (Paytrail tokenised or MobilePay agreement) trigger
the dunning ladder (see `apps/api/src/modules/jobs/processors/payment-retry.processor.ts`):

```
payment.failed → adoption.paused
  + retry-1 +3d → retry-2 +7d → retry-3 +14d
  + final failure: 21d grace → cancellation
```

Idempotent (BullMQ jobId `dunning-<adoptionId>-<attempt>`). Donor can rescue
any time by updating payment method in `My Garden`.

## Consequences

**Positive**

- The most-common rail (bank transfer) costs the Garden zero per-transaction.
- Paytrail is the right hammer for Finnish e-commerce; no merchant fights
  with Stripe over Pay-by-Bank enrolment.
- MobilePay recurring works the way Finnish donors expect.
- Adding a new rail (Visma Pay, Stripe, etc.) is one adapter under the same
  port. ~600 lines, two weeks.

**Negative**

- We operate three integrations instead of one. We pin SDKs + dependabot
  weekly.
- MobilePay sandbox onboarding requires KYC (~2 weeks). We treat it as a
  Phase 2 launch item; bank transfer + Paytrail is the day-1 launch
  surface.

## Supersedes

- ADR-0004 Payment Provider Abstraction (Stripe + MobilePay).

## See also

- `packages/payments/src/types.ts` — the port + normalised event shape.
- `packages/payments/src/banktransfer/gateway.ts` — RF + EPC + reconciliation.
- `packages/payments/src/paytrail/gateway.ts` — HMAC-SHA256 over canonical
  `checkout-*` headers.
- `packages/payments/src/mobilepay/gateway.ts` — Vipps Recurring API.
- `docs/runbook/paytrail-go-live.md` — production handoff steps.
- `docs/runbook/mobilepay-go-live.md` — production handoff steps.
