/**
 * Payment provider port — shared types for Stripe and MobilePay adapters.
 *
 * Design notes:
 *   * Money is always cents (Int). Currency is an ISO 4217 string ("EUR").
 *   * Every operation is keyed by `orderId`, a server-generated UUIDv7 that
 *     doubles as the provider idempotency key. Re-running with the same orderId
 *     MUST return the same outcome.
 *   * Adapters never persist; they call the provider and return a normalised
 *     result. Persistence is the orchestrator's job (so the same DB transaction
 *     can wrap both rows).
 *   * Adapters NEVER throw on application-level failures (declined card, expired
 *     agreement, etc.) — those are returned as typed results. They throw only on
 *     real exceptional conditions (network down, malformed config).
 */

import { z } from 'zod';

export type Cents = number;
export type CurrencyCode = 'EUR'; // expand when we add USD donations

export const ProviderId = z.enum(['paytrail', 'mobilepay', 'bank_transfer']);
export type ProviderId = z.infer<typeof ProviderId>;

export const AdoptionIntent = z.enum([
  'for_self',
  'gift',
  'memorial',
  'class',
  'corporate',
]);
export type AdoptionIntent = z.infer<typeof AdoptionIntent>;

export const BillingInterval = z.enum(['one_time', 'monthly', 'annual']);
export type BillingInterval = z.infer<typeof BillingInterval>;

export const Locale = z.enum(['en', 'fi', 'sv']);
export type Locale = z.infer<typeof Locale>;

// ─── Inputs ─────────────────────────────────────────────────────────────────

export const DonorInput = z.object({
  donorId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  locale: Locale,
  countryCode: z.string().length(2).default('FI'),
});
export type DonorInput = z.infer<typeof DonorInput>;

export const LineItemInput = z.object({
  description: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.literal('EUR'),
  vatRateBp: z.number().int().min(0).max(10000).default(0),
  metadata: z.record(z.string()).optional(),
});
export type LineItemInput = z.infer<typeof LineItemInput>;

export const CreateCheckoutInput = z.object({
  orderId: z.string().uuid(),
  donor: DonorInput,
  lineItems: z.array(LineItemInput).min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  metadata: z.record(z.string()).default({}),
  intent: AdoptionIntent,
});
export type CreateCheckoutInput = z.infer<typeof CreateCheckoutInput>;

export const CreateAgreementInput = z.object({
  orderId: z.string().uuid(),
  donor: DonorInput,
  productName: z.string(),
  productDescription: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.literal('EUR'),
  interval: z.enum(['monthly', 'annual']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  metadata: z.record(z.string()).default({}),
});
export type CreateAgreementInput = z.infer<typeof CreateAgreementInput>;

export const ChargeAgreementInput = z.object({
  orderId: z.string().uuid(),
  agreementId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.literal('EUR'),
  description: z.string(),
});
export type ChargeAgreementInput = z.infer<typeof ChargeAgreementInput>;

export const CancelAgreementInput = z.object({
  agreementId: z.string(),
  reason: z.string().optional(),
});
export type CancelAgreementInput = z.infer<typeof CancelAgreementInput>;

export const RefundInput = z.object({
  orderId: z.string().uuid(),
  providerPaymentRef: z.string(),
  amountCents: z.number().int().positive(),
  reason: z.string().optional(),
});
export type RefundInput = z.infer<typeof RefundInput>;

export const ParseWebhookInput = z.object({
  rawBody: z.string(),
  headers: z.record(z.string()),
});
export type ParseWebhookInput = z.infer<typeof ParseWebhookInput>;

// ─── Outputs ────────────────────────────────────────────────────────────────

export interface CheckoutHandoff {
  provider: ProviderId;
  /** URL to redirect the donor to */
  redirectUrl: string;
  /** Provider's id for this attempt (Stripe checkout session, MobilePay redirect) */
  providerSessionId: string;
}

export interface AgreementHandoff {
  provider: ProviderId;
  agreementId: string;
  /** URL to redirect donor to in order to confirm the agreement in their app */
  confirmationUrl: string;
}

export type ChargeResult =
  | { ok: true; chargeId: string; status: 'pending' | 'succeeded' }
  | { ok: false; code: string; message: string };

export type RefundResult =
  | { ok: true; refundId: string }
  | { ok: false; code: string; message: string };

// Normalised event the orchestrator persists/handles
export type NormalisedEvent =
  | {
      kind: 'checkout.completed';
      provider: ProviderId;
      providerEventId: string;
      orderId: string;
      providerPaymentRef: string;
      providerSessionId: string;
      amountCents: number;
      currency: 'EUR';
      paidAt: Date;
      metadata: Record<string, string>;
    }
  | {
      kind: 'payment.succeeded';
      provider: ProviderId;
      providerEventId: string;
      orderId: string;
      providerPaymentRef: string;
      amountCents: number;
      currency: 'EUR';
      paidAt: Date;
      metadata: Record<string, string>;
    }
  | {
      kind: 'payment.failed';
      provider: ProviderId;
      providerEventId: string;
      orderId: string;
      providerPaymentRef: string;
      failureCode: string;
      failureMessage: string;
      metadata: Record<string, string>;
    }
  | {
      kind: 'agreement.activated';
      provider: ProviderId;
      providerEventId: string;
      orderId: string;
      agreementId: string;
      metadata: Record<string, string>;
    }
  | {
      kind: 'agreement.cancelled';
      provider: ProviderId;
      providerEventId: string;
      orderId: string;
      agreementId: string;
      cancelledAt: Date;
      cancelReason: string;
      metadata: Record<string, string>;
    }
  | {
      kind: 'refund.processed';
      provider: ProviderId;
      providerEventId: string;
      orderId: string;
      providerPaymentRef: string;
      refundCents: number;
      refundedAt: Date;
      metadata: Record<string, string>;
    }
  | {
      kind: 'unknown';
      provider: ProviderId;
      providerEventId: string;
      raw: unknown;
    };

// ─── Port ────────────────────────────────────────────────────────────────────

export interface PaymentGateway {
  readonly id: ProviderId;

  createCheckout(input: CreateCheckoutInput): Promise<CheckoutHandoff>;

  createAgreement(input: CreateAgreementInput): Promise<AgreementHandoff>;

  chargeAgreement(input: ChargeAgreementInput): Promise<ChargeResult>;

  cancelAgreement(input: CancelAgreementInput): Promise<void>;

  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Verify signature + parse the body. MUST be called with the *raw* HTTP body,
   * not parsed JSON, so the signature digest matches byte-for-byte.
   */
  parseWebhook(input: ParseWebhookInput): Promise<NormalisedEvent>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class PaymentGatewayError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

export class WebhookSignatureError extends Error {
  constructor(
    public readonly provider: ProviderId,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
