# ADR-0004: Payment Provider Abstraction (Stripe + MobilePay)

**Status:** Accepted
**Date:** 2026-05-13

## Context

The Finnish donor will reach for **MobilePay** by reflex for one-off donations, and **card** for international gifts. Recurring annual / monthly support needs SCA-compliant subscription rails. Corporate donors (TVL §57 deductible, €850–€250,000) will pay by SEPA bank transfer.

We need:

- **One-off** and **recurring** flows on **both** rails.
- Strict idempotency end-to-end (webhook retries are the norm, not the exception).
- Refund + chargeback paths that update the receipt + tax certificate.
- A clean port so that adding Paytrail or Visma Pay later is a one-week project, not a quarter.

## Decision

Define a `PaymentGateway` port with a small surface, and adapt to Stripe + Vipps MobilePay behind it. Live in `packages/payments/`.

```ts
// packages/payments/src/ports/PaymentGateway.ts
export interface PaymentGateway {
  readonly id: 'stripe' | 'mobilepay';

  // Initiate a charge. Returns a redirect URL (or a Stripe client secret for
  // PaymentElement). All inputs are idempotency-keyed by `orderId`.
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutHandoff>;

  // Initiate or renew a recurring agreement.
  createAgreement(input: CreateAgreementInput): Promise<AgreementHandoff>;
  chargeAgreement(input: ChargeAgreementInput): Promise<ChargeResult>;
  cancelAgreement(input: CancelAgreementInput): Promise<void>;

  // Issue a refund, partial or full.
  refund(input: RefundInput): Promise<RefundResult>;

  // Verify+parse an inbound webhook. Implementations:
  //   - read raw body
  //   - constant-time signature compare
  //   - throw on tampered / replayed events
  parseWebhook(input: ParseWebhookInput): Promise<NormalisedEvent>;
}
```

The orchestrator (`AdoptionsService`) only knows about the port. The HTTP webhook controllers call `gateway.parseWebhook()` and forward normalised events into a single `PaymentEventsHandler` that updates the `Payment` row in a transaction.

### Provider routing

A small router decides which provider gets the charge:

```ts
function pickProvider(donor: Donor, intent: AdoptionIntent, amount: Cents): Provider {
  if (donor.countryCode === 'FI' && amount <= 50_000_00 && intent !== 'corporate') {
    return donor.prefers === 'card' ? 'stripe' : 'mobilepay';
  }
  if (intent === 'corporate') {
    return 'stripe'; // SEPA invoicing via Stripe Invoicing
  }
  return 'stripe'; // safe default for non-FI cards
}
```

### Idempotency

Every charge has a server-generated `orderId` (UUIDv7) that we pass as the idempotency key on the outbound call and store on the `Payment` row.

Every inbound webhook event has a `providerEventId` we record with a `UNIQUE` index. The handler is:

```ts
await db.$transaction(async (tx) => {
  // INSERT … ON CONFLICT DO NOTHING -- if it conflicts, we've seen this event.
  const seen = await tx.processedEvent.create({
    data: { providerEventId: evt.id, provider: evt.provider },
  }).catch(() => null);
  if (!seen) return;
  // ... business work ...
});
```

The `ProcessedEvent` table is the single source of truth for "did we run this?".

### SCA + recurring

For Stripe Subscriptions we use **off-session** PaymentIntents with `setup_future_usage: 'off_session'` so SCA happens once. Failed off-session charges trigger Stripe's `requires_action` flow, which we surface in `My Garden → Renewals`.

For MobilePay, the Recurring API issues an **agreement** that the donor accepts in the app once. Every subsequent monthly/annual charge is merchant-initiated against that agreement; SCA is implicit in the customer's biometric unlock on first acceptance.

### Refunds + tax cert reversal

Refund webhooks reverse the `Payment.status` and trigger a job that:

1. Issues a credit note PDF.
2. Recomputes the donor's current-year `TaxCertificate`.
3. Notifies the donor + finance staff.

## Consequences

**Positive**

- One business-logic path (the orchestrator) regardless of provider.
- Webhook idempotency is enforced at the DB layer — no double receipts even under provider misbehaviour.
- Adding Paytrail later means writing one adapter, ~600 lines.

**Negative**

- Two SDKs to keep current; we pin versions and dependabot-track them weekly.
- MobilePay's sandbox flakier than Stripe's; we maintain a "contract fixture" set under `packages/payments/test/fixtures/mobilepay/` to test against without hitting their sandbox.
