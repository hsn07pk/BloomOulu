/**
 * Paytrail Payment API adapter.
 *
 * Paytrail (paytrail.com, docs.paytrail.com) is Finland's dominant payment
 * service provider — 6,500+ Finnish sites use it. One integration gives us:
 *
 *   * All Finnish online-banking buttons (Nordea, OP, Danske, S-Pankki,
 *     Aktia, Ålandsbanken, POP Pankki, Säästöpankki, Oma Säästöpankki,
 *     Handelsbanken).
 *   * Cards (Visa, Mastercard, Amex) with 3D Secure / SCA.
 *   * MobilePay (one-off only — recurring uses Vipps direct).
 *   * Apple Pay, Google Pay.
 *   * Siirto (instant FI account-to-account).
 *   * BNPL: Klarna, Walley.
 *
 * Auth model: HMAC-SHA256 signed requests. The merchant ID + secret come from
 * the Paytrail merchant portal. The signature covers the canonicalised headers
 * + body. We use the same secret to verify inbound callbacks.
 *
 * Docs: https://docs.paytrail.com/
 */

import { createHmac, randomUUID } from 'node:crypto';
import { request } from 'undici';
import { PaymentGatewayError, WebhookSignatureError } from '../types.js';
import type {
  PaymentGateway,
  CreateCheckoutInput,
  CheckoutHandoff,
  CreateAgreementInput,
  AgreementHandoff,
  ChargeAgreementInput,
  ChargeResult,
  CancelAgreementInput,
  RefundInput,
  RefundResult,
  ParseWebhookInput,
  NormalisedEvent,
} from '../types.js';

export interface PaytrailConfig {
  /** Merchant account id from Paytrail portal (e.g. "375917"). */
  merchantId: string;
  /** Secret key from Paytrail portal. NEVER log this. */
  secret: string;
  /** API base — production: https://services.paytrail.com */
  apiBaseUrl?: string;
  /** Webhook secret if Paytrail issues a separate one; usually same as `secret` */
  webhookSecret?: string;
  /**
   * When true, `createCheckout` skips Paytrail's real /payments API
   * (which mandates HTTPS callback URLs and so can't be tested from
   * localhost) and returns a redirect to our local mock checkout. The
   * mock then signs a return URL with the REAL merchant secret and
   * lands the donor on `successUrl?checkout-status=ok&signature=...`,
   * so the verification + activation path is exercised exactly as in
   * production — only the "pick your bank" UI is mocked.
   */
  mockMode?: boolean;
  /** Public-facing web URL — used to compose the mock checkout link. */
  webBaseUrl?: string;
}

const DEFAULT_BASE = 'https://services.paytrail.com';

/**
 * Internal: build the HMAC-SHA256 signature over canonicalised Paytrail
 * `checkout-*` headers + raw body, per
 * https://docs.paytrail.com/#/?id=signature
 */
function paytrailSignature(
  secret: string,
  headers: Record<string, string>,
  body: string,
): string {
  const lines: string[] = [];
  const checkoutKeys = Object.keys(headers)
    .filter((k) => k.toLowerCase().startsWith('checkout-'))
    .sort();
  for (const k of checkoutKeys) {
    lines.push(`${k.toLowerCase()}:${headers[k]}`);
  }
  const payload = `${lines.join('\n')}\n${body}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export class PaytrailGateway implements PaymentGateway {
  readonly id = 'paytrail' as const;
  private readonly base: string;

  constructor(private readonly cfg: PaytrailConfig) {
    if (!cfg.merchantId || !cfg.secret) {
      throw new Error('PaytrailGateway: merchantId and secret are required');
    }
    this.base = cfg.apiBaseUrl ?? DEFAULT_BASE;
  }

  /**
   * Compute the signature for an arbitrary set of `checkout-*` params
   * (and empty body). Exposed so the api can mint return-URL signatures
   * in mock mode without re-deriving the canonicalisation.
   */
  signReturnParams(params: Record<string, string>): string {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      headers[k.toLowerCase()] = v;
    }
    return paytrailSignature(this.cfg.secret, headers, '');
  }

  /** Initiate a Paytrail payment (one-off). */
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutHandoff> {
    if (this.cfg.mockMode) {
      // Mock the hosted-checkout step. The mock page in /donate/paytrail-test
      // renders a Paytrail-styled UI; on "Pay" it hits an api endpoint that
      // signs the return URL with this.cfg.secret and 302s to successUrl.
      const amount = input.lineItems.reduce((s, li) => s + li.amountCents, 0);
      const base = (this.cfg.webBaseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
      const url = new URL(`${base}/${input.donor.locale}/donate/paytrail-test`);
      url.searchParams.set('orderId', input.orderId);
      url.searchParams.set('amount', String(amount));
      url.searchParams.set('description', input.lineItems[0]?.description ?? 'Adoption');
      url.searchParams.set('success', input.successUrl);
      url.searchParams.set('cancel', input.cancelUrl);
      return {
        provider: this.id as any,
        redirectUrl: url.toString(),
        providerSessionId: input.orderId,
      };
    }
    // Body shape per https://docs.paytrail.com/#/?id=create
    const body = {
      stamp: input.orderId,
      reference: input.orderId.replace(/-/g, '').slice(0, 20),
      amount: input.lineItems.reduce((s, li) => s + li.amountCents, 0),
      currency: 'EUR',
      language: input.donor.locale.toUpperCase(), // EN | FI | SV
      items: input.lineItems.map((li, idx) => ({
        unitPrice: li.amountCents,
        units: 1,
        vatPercentage: li.vatRateBp / 100,
        productCode: li.metadata?.['productCode'] ?? `item-${idx}`,
        description: li.description.slice(0, 100),
      })),
      customer: {
        email: input.donor.email,
        firstName: input.donor.name?.split(' ')[0],
        lastName: input.donor.name?.split(' ').slice(1).join(' ') || undefined,
      },
      redirectUrls: {
        success: input.successUrl,
        cancel: input.cancelUrl,
      },
      callbackUrls: {
        success: input.metadata['callbackSuccess'] ?? input.successUrl,
        cancel: input.metadata['callbackCancel'] ?? input.cancelUrl,
      },
    };
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      'checkout-account': this.cfg.merchantId,
      'checkout-algorithm': 'sha256',
      'checkout-method': 'POST',
      'checkout-nonce': randomUUID(),
      'checkout-timestamp': new Date().toISOString(),
      'content-type': 'application/json; charset=utf-8',
      'platform-name': 'bloomoulu',
    };
    headers['signature'] = paytrailSignature(this.cfg.secret, headers, bodyStr);

    const res = await request(`${this.base}/payments`, {
      method: 'POST',
      headers,
      body: bodyStr,
    });
    const text = await res.body.text();
    if (res.statusCode >= 300) {
      throw new PaymentGatewayError(
        this.id as any,
        `paytrail.create.${res.statusCode}`,
        text,
        res.statusCode >= 500,
      );
    }
    const json = JSON.parse(text) as {
      transactionId: string;
      href: string;
      reference: string;
    };
    return {
      provider: this.id as any,
      redirectUrl: json.href,
      providerSessionId: json.transactionId,
    };
  }

  /**
   * Paytrail does not have a first-class "agreement" concept like MobilePay.
   * Recurring with Paytrail is implemented via "tokenization": the donor's
   * first charge captures a card token; subsequent merchant-initiated charges
   * use that token. For BloomOulu we deliberately route TRUE recurring
   * (donor-confirmed multi-period agreement, SCA satisfied once) through
   * MobilePay-direct; Paytrail is used for one-off charges that may then be
   * re-attempted manually using the stored token.
   */
  async createAgreement(_: CreateAgreementInput): Promise<AgreementHandoff> {
    throw new PaymentGatewayError(
      this.id as any,
      'paytrail.recurring.unsupported',
      'Paytrail recurring via tokenisation: use createCheckout with saveCard flag, then chargeAgreement with the token. For true SCA-once agreements, use the MobilePay direct adapter.',
      false,
    );
  }

  async chargeAgreement(_: ChargeAgreementInput): Promise<ChargeResult> {
    // TODO: implement once Garden enables Paytrail tokenised recurring;
    // see https://docs.paytrail.com/#/?id=tokenization-features
    return {
      ok: false,
      code: 'paytrail.charge_agreement.not_implemented',
      message:
        'Paytrail tokenised charging requires merchant enablement; route recurring via MobilePay direct.',
    };
  }

  async cancelAgreement(_: CancelAgreementInput): Promise<void> {
    return;
  }

  /** Refund — Paytrail Refund API. */
  async refund(input: RefundInput): Promise<RefundResult> {
    const body = {
      refundStamp: input.orderId + '-refund-' + randomUUID().slice(0, 8),
      refundReference: input.orderId.replace(/-/g, '').slice(0, 20),
      amount: input.amountCents,
      email: input.reason ? undefined : undefined,
      callbackUrls: {
        success: 'https://invalid/refund-success',
        cancel: 'https://invalid/refund-cancel',
      },
    };
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      'checkout-account': this.cfg.merchantId,
      'checkout-algorithm': 'sha256',
      'checkout-method': 'POST',
      'checkout-nonce': randomUUID(),
      'checkout-timestamp': new Date().toISOString(),
      'checkout-transaction-id': input.providerPaymentRef,
      'content-type': 'application/json; charset=utf-8',
      'platform-name': 'bloomoulu',
    };
    headers['signature'] = paytrailSignature(this.cfg.secret, headers, bodyStr);

    const res = await request(
      `${this.base}/payments/${encodeURIComponent(input.providerPaymentRef)}/refund`,
      { method: 'POST', headers, body: bodyStr },
    );
    const text = await res.body.text();
    if (res.statusCode >= 300) {
      return {
        ok: false,
        code: `paytrail.refund.${res.statusCode}`,
        message: text,
      };
    }
    const json = JSON.parse(text);
    return { ok: true, refundId: json.transactionId ?? json.refundStamp };
  }

  /** Verify inbound callback signature + normalise event. */
  async parseWebhook(input: ParseWebhookInput): Promise<NormalisedEvent> {
    // Paytrail callbacks are GET redirects in the simple case but also POST
    // server-to-server callbacks containing the same `checkout-*` headers.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.headers)) {
      headers[k.toLowerCase()] = v;
    }
    const expected = paytrailSignature(
      this.cfg.webhookSecret ?? this.cfg.secret,
      headers,
      input.rawBody,
    );
    const provided = headers['signature'];
    if (
      !provided ||
      !constantTimeEqual(Buffer.from(expected), Buffer.from(provided))
    ) {
      throw new WebhookSignatureError(
        this.id as any,
        'Paytrail callback signature mismatch',
      );
    }
    const stamp = headers['checkout-stamp']; // ← our orderId
    const transactionId = headers['checkout-transaction-id'];
    const status = headers['checkout-status']; // ok | fail | pending | delayed
    const amount = parseInt(headers['checkout-amount'] ?? '0', 10);
    const providerEventId = `${transactionId}:${status}:${headers['checkout-timestamp']}`;

    if (status === 'ok') {
      return {
        kind: 'checkout.completed',
        provider: this.id as any,
        providerEventId,
        orderId: stamp ?? '',
        providerPaymentRef: transactionId ?? '',
        providerSessionId: transactionId ?? '',
        amountCents: amount,
        currency: 'EUR',
        paidAt: new Date(),
        metadata: {},
      };
    }
    if (status === 'fail') {
      return {
        kind: 'payment.failed',
        provider: this.id as any,
        providerEventId,
        orderId: stamp ?? '',
        providerPaymentRef: transactionId ?? '',
        failureCode: 'paytrail.declined',
        failureMessage: 'Paytrail reported status=fail',
        metadata: {},
      };
    }
    return {
      kind: 'unknown',
      provider: this.id as any,
      providerEventId,
      raw: headers,
    };
  }
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
