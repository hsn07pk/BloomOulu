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
  /**
   * Refund callback URL on our api (e.g.
   * `https://api.bloomoulu.fi/webhooks/paytrail`). Paytrail posts the
   * async `refund.processed` event here. Required for refunds — without
   * a reachable URL the refund still happens at Paytrail but the
   * reconciliation cron has to detect it 24h later.
   */
  refundCallbackUrl?: string;
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

  /**
   * Internal helper — build the standard set of Paytrail HMAC-signed
   * request headers for outbound calls. Pass `method='GET'` for GETs
   * (Paytrail still signs them); pass `transactionId` to scope the
   * signature to a specific transaction (refunds, token-charges).
   */
  private buildOutboundHeaders(
    bodyStr: string,
    extra: { method?: 'POST' | 'GET'; transactionId?: string } = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'checkout-account': this.cfg.merchantId,
      'checkout-algorithm': 'sha256',
      'checkout-method': extra.method ?? 'POST',
      'checkout-nonce': randomUUID(),
      'checkout-timestamp': new Date().toISOString(),
      'content-type': 'application/json; charset=utf-8',
      'platform-name': 'bloomoulu',
    };
    if (extra.transactionId) headers['checkout-transaction-id'] = extra.transactionId;
    headers['signature'] = paytrailSignature(this.cfg.secret, headers, bodyStr);
    return headers;
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
   * Recurring via Paytrail tokenisation. We use the standard two-step
   * flow per the OpenAPI spec
   * (https://github.com/paytrail/api-documentation):
   *
   *   1. POST /tokenization/addcard-form          — render add-card form
   *   2. donor returns with checkout-tokenization-id
   *   3. POST /tokenization/{checkout-tokenization-id}  — exchange for token
   *   4. POST /payments/token/mit/charge          — first + future charges
   *
   * `createAgreement` performs step 1. Step 2 lands in `parseWebhook`,
   * which exchanges and emits `agreement.activated` with the long-lived
   * `token` as the agreement id. The orchestrator persists it in
   * `Payment.providerCustomerId` and immediately enqueues the first
   * `chargeAgreement` (step 4) — the dunning ladder takes over on
   * failure.
   *
   * Note: the addcard-form endpoint expects checkout-* params in the
   * **body** (NOT the request headers like other Paytrail endpoints),
   * per AddCardFormRequest schema in the OpenAPI doc.
   */
  async createAgreement(input: CreateAgreementInput): Promise<AgreementHandoff> {
    if (this.cfg.mockMode) {
      // Mock the hosted-checkout step. The paytrail-mock page signs a
      // return URL with this.cfg.secret AND embeds a synthetic
      // tokenization-id so the exchange path is exercised in dev.
      const base = (this.cfg.webBaseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
      const url = new URL(`${base}/${input.donor.locale}/donate/paytrail-test`);
      url.searchParams.set('orderId', input.orderId);
      url.searchParams.set('amount', String(input.amountCents));
      url.searchParams.set('description', input.productDescription);
      url.searchParams.set('success', input.successUrl);
      url.searchParams.set('cancel', input.cancelUrl);
      url.searchParams.set('tokenize', '1');
      return {
        provider: this.id as any,
        agreementId: '',
        confirmationUrl: url.toString(),
      };
    }

    // addcard-form has no "stamp" field that survives the callback, so
    // we encode our orderId in the redirect URL ourselves. Paytrail
    // appends `checkout-tokenization-id` + `signature` and bounces the
    // donor back; /donate/complete forwards the full query to
    // /webhooks/paytrail where parseWebhook reads `orderId` alongside
    // the verified `checkout-tokenization-id`.
    const withOrderId = (raw: string) => {
      const u = new URL(raw);
      u.searchParams.set('orderId', input.orderId);
      return u.toString();
    };
    const successWithOrder = withOrderId(input.successUrl);
    const cancelWithOrder = withOrderId(input.cancelUrl);

    // The AddCardFormRequest body carries the checkout-* signing fields
    // as JSON properties. The signature itself goes inside the body
    // under "signature" too — not as a header, unlike other endpoints.
    const bodyBase: Record<string, string | number> = {
      'checkout-account': parseInt(this.cfg.merchantId, 10),
      'checkout-algorithm': 'sha256',
      'checkout-method': 'POST',
      'checkout-nonce': randomUUID(),
      'checkout-timestamp': new Date().toISOString(),
      'checkout-redirect-success-url': successWithOrder,
      'checkout-redirect-cancel-url': cancelWithOrder,
      'checkout-callback-success-url': input.metadata['callbackSuccess'] ?? successWithOrder,
      'checkout-callback-cancel-url': input.metadata['callbackCancel'] ?? cancelWithOrder,
      language: input.donor.locale.toUpperCase(),
    };
    // Signature spans all checkout-* fields (sorted) joined as
    // "key:value\n" — same algorithm as the request-header form, just
    // with the body keys as input. Body is empty for this endpoint.
    const sigInput: Record<string, string> = {};
    for (const [k, v] of Object.entries(bodyBase)) {
      if (k.toLowerCase().startsWith('checkout-')) sigInput[k] = String(v);
    }
    const signature = paytrailSignature(this.cfg.secret, sigInput, '');
    const body = { ...bodyBase, signature };
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'platform-name': 'bloomoulu',
    };

    const res = await request(`${this.base}/tokenization/addcard-form`, {
      method: 'POST',
      headers,
      body: bodyStr,
    });
    // The endpoint returns 302 with Location pointing at the
    // card-addition form. The undici request follows redirects by
    // default for some methods but not POST — we read the location
    // header.
    if (res.statusCode === 302 || res.statusCode === 303) {
      const loc = res.headers['location'];
      if (!loc) {
        throw new PaymentGatewayError(
          this.id as any,
          'paytrail.addcard.no_location',
          'Paytrail addcard-form returned 302 without Location header',
          true,
        );
      }
      return {
        provider: this.id as any,
        agreementId: '',
        confirmationUrl: Array.isArray(loc) ? loc[0]! : loc,
      };
    }
    const text = await res.body.text();
    throw new PaymentGatewayError(
      this.id as any,
      `paytrail.addcard.${res.statusCode}`,
      text,
      res.statusCode >= 500,
    );
  }

  /**
   * Merchant-initiated charge against a stored Paytrail card token.
   * Used for monthly/annual renewals and for dunning re-attempts.
   *
   * Endpoint: POST /payments/token/mit/charge (NB: slash, not hyphen —
   * the popular "mit-charge" form is folklore; the OpenAPI spec is
   * /payments/token/mit/charge).
   *
   * Required fields per TokenPaymentRequest schema:
   *   stamp, reference, amount, currency, language, customer, items,
   *   redirectUrls, token.
   *
   * Response 201: { transactionId: "uuid" }
   *
   * Docs: https://github.com/paytrail/api-documentation/blob/main/docs/paytrail-api.yaml
   */
  async chargeAgreement(input: ChargeAgreementInput): Promise<ChargeResult> {
    const callback =
      this.cfg.refundCallbackUrl ?? 'https://api.example.invalid/webhooks/paytrail';
    const body = {
      stamp: input.orderId,
      reference: input.orderId.replace(/-/g, '').slice(0, 20),
      amount: input.amountCents,
      currency: 'EUR',
      language: 'EN',
      token: input.agreementId,
      items: [
        {
          unitPrice: input.amountCents,
          units: 1,
          vatPercentage: 0,
          productCode: 'adoption-renewal',
          description: input.description.slice(0, 100),
        },
      ],
      customer: { email: 'noreply+mit@bloomoulu.fi' },
      // redirectUrls + callbackUrls are required by TokenPaymentRequest
      // even for MIT charges where no donor redirect happens. They're
      // used if Paytrail needs to fire any async result callback.
      redirectUrls: { success: callback, cancel: callback },
      callbackUrls: { success: callback, cancel: callback },
    };
    const bodyStr = JSON.stringify(body);
    const headers = this.buildOutboundHeaders(bodyStr);

    const res = await request(
      `${this.base}/payments/token/mit/charge`,
      { method: 'POST', headers, body: bodyStr },
    );
    const text = await res.body.text();
    if (res.statusCode >= 300) {
      return {
        ok: false,
        code: `paytrail.charge.${res.statusCode}`,
        message: text,
      };
    }
    const json = JSON.parse(text) as {
      transactionId: string;
    };
    // Paytrail's MIT response only returns transactionId on 201
    // (success). Settlement comes via the regular payment-status
    // webhook later. Treat the 201 as "pending" (authorised) until the
    // webhook flips it to succeeded.
    return {
      ok: true,
      chargeId: json.transactionId,
      status: 'pending',
    };
  }

  /**
   * Cancel a Paytrail token (donor unsubscribes / removes payment
   * method). Paytrail's API doesn't have an explicit "revoke token"
   * endpoint — once we stop charging it, it expires naturally with
   * the card. For audit completeness we still mark the local Adoption
   * as cancelled.
   */
  async cancelAgreement(_: CancelAgreementInput): Promise<void> {
    return;
  }

  /**
   * Exchange a `checkout-tokenization-id` for the long-lived `token`.
   *
   * Endpoint: POST /tokenization/{checkout-tokenization-id}
   * Required header: checkout-tokenization-id (also in path).
   * Required body: GetTokenRequest = { "checkout-tokenization-id": "uuid" }
   * Response: TokenizationRequestResponse = { token, customer?, card? }
   *
   * Per the OpenAPI spec, the tokenization-id appears in BOTH the URL
   * path AND the `checkout-tokenization-id` header AND the request
   * body — Paytrail's signature includes the header so all three must
   * line up.
   */
  async exchangeTokenizationId(
    tokenizationId: string,
  ): Promise<{ token: string; cardSummary: string }> {
    const body = { 'checkout-tokenization-id': tokenizationId };
    const bodyStr = JSON.stringify(body);
    // Build signing headers; the spec includes checkout-tokenization-id
    // among them. Our buildOutboundHeaders only adds checkout-transaction-id
    // explicitly, so we pass tokenizationId via that slot — but the
    // canonicalised list-of-headers logic in paytrailSignature only
    // picks up keys starting with "checkout-", which both qualify.
    const baseHeaders: Record<string, string> = {
      'checkout-account': this.cfg.merchantId,
      'checkout-algorithm': 'sha256',
      'checkout-method': 'POST',
      'checkout-nonce': randomUUID(),
      'checkout-timestamp': new Date().toISOString(),
      'checkout-tokenization-id': tokenizationId,
      'content-type': 'application/json; charset=utf-8',
      'platform-name': 'bloomoulu',
    };
    baseHeaders['signature'] = paytrailSignature(this.cfg.secret, baseHeaders, bodyStr);

    const res = await request(
      `${this.base}/tokenization/${encodeURIComponent(tokenizationId)}`,
      { method: 'POST', headers: baseHeaders, body: bodyStr },
    );
    const text = await res.body.text();
    if (res.statusCode >= 300) {
      throw new PaymentGatewayError(
        this.id as any,
        `paytrail.tokenization.${res.statusCode}`,
        text,
        res.statusCode >= 500,
      );
    }
    const json = JSON.parse(text) as {
      token: string;
      card?: { type?: string; partial_pan?: string; expire_month?: string; expire_year?: string };
    };
    const cardSummary = json.card
      ? `${json.card.type ?? 'card'} ****${json.card.partial_pan ?? '****'}`
      : '';
    return { token: json.token, cardSummary };
  }

  /** Refund — Paytrail Refund API. */
  async refund(input: RefundInput): Promise<RefundResult> {
    // Paytrail posts the async `refund.processed` event to these URLs.
    // Both point at our /webhooks/paytrail; the same signature-verify +
    // dedupe path that handles payments handles refunds. Without a
    // reachable URL the refund still happens but the reconciliation
    // cron catches it 24h later.
    const callback =
      this.cfg.refundCallbackUrl ?? 'https://api.example.invalid/webhooks/paytrail';
    const body = {
      refundStamp: input.orderId + '-refund-' + randomUUID().slice(0, 8),
      refundReference: input.orderId.replace(/-/g, '').slice(0, 20),
      amount: input.amountCents,
      callbackUrls: { success: callback, cancel: callback },
    };
    const bodyStr = JSON.stringify(body);
    const headers = this.buildOutboundHeaders(bodyStr, {
      transactionId: input.providerPaymentRef,
    });

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
    const stamp = headers['checkout-stamp']; // ← our orderId (regular payment)
    const orderIdParam = headers['orderid']; // ← our orderId (addcard-form return)
    const transactionId = headers['checkout-transaction-id'];
    const status = headers['checkout-status']; // ok | fail | pending | delayed
    const amount = parseInt(headers['checkout-amount'] ?? '0', 10);
    // Paytrail appends `checkout-tokenization-id` on the return URL
    // when the donor consented to tokenisation. With the addcard-form
    // flow this is the ONLY meaningful Paytrail field on the return.
    const tokenizationId = headers['checkout-tokenization-id'];

    // Addcard-form return: tokenization-id present, no checkout-status
    // (no payment was processed in this leg). Exchange for token and
    // emit `agreement.activated`. orderId comes from our own redirect
    // URL — see createAgreement for the binding rationale.
    if (tokenizationId && !status && !stamp) {
      const exchange = await this.exchangeTokenizationId(tokenizationId);
      return {
        kind: 'agreement.activated',
        provider: this.id as any,
        providerEventId: `addcard:${tokenizationId}`,
        orderId: orderIdParam ?? '',
        agreementId: exchange.token,
        metadata: { cardSummary: exchange.cardSummary },
      };
    }

    const providerEventId = `${transactionId}:${status}:${headers['checkout-timestamp']}`;

    if (status === 'ok') {
      // Exchange the tokenization-id for a long-lived token if present
      // (Pay+Tokenize combined flow). Failures here don't block payment
      // activation — the charge already succeeded; we just won't have a
      // token for future MIT charges. The reconciliation processor
      // surfaces this gap.
      let agreementId: string | undefined;
      if (tokenizationId) {
        try {
          const exchange = await this.exchangeTokenizationId(tokenizationId);
          agreementId = exchange.token;
        } catch {
          // Swallow — see comment above. The orchestrator still marks
          // the payment succeeded; providerCustomerId stays null.
        }
      }
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
        ...(agreementId ? { agreementId } : {}),
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
