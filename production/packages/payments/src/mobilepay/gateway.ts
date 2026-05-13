/**
 * Vipps MobilePay direct adapter — Recurring API + ePayment API.
 *
 * Used for native MobilePay UX and for true SCA-once subscription agreements
 * (annual + monthly) that Paytrail cannot model. Paytrail handles one-off
 * MobilePay; this adapter handles recurring + first-party MobilePay flows.
 *
 * Auth model:
 *   * Subscription Key (Ocp-Apim-Subscription-Key header).
 *   * OAuth 2.0 client_credentials → bearer access token (cache 60min).
 *   * Merchant Serial Number (MSN) header.
 *
 * Docs:
 *   * https://developer.vippsmobilepay.com/docs/APIs/recurring-api/
 *   * https://developer.vippsmobilepay.com/docs/APIs/epayment-api/
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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

export interface MobilePayConfig {
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  merchantSerialNumber: string;
  webhookSecret: string;
  apiBaseUrl?: string;
  returnUrl: string;
  callbackPrefix: string;
}

const TEST_BASE = 'https://apitest.vipps.no';
const PROD_BASE = 'https://api.vipps.no';

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class MobilePayGateway implements PaymentGateway {
  readonly id = 'mobilepay' as const;
  private readonly base: string;
  private tokenCache: TokenCache | null = null;

  constructor(private readonly cfg: MobilePayConfig) {
    if (
      !cfg.clientId ||
      !cfg.clientSecret ||
      !cfg.subscriptionKey ||
      !cfg.merchantSerialNumber
    ) {
      throw new Error(
        'MobilePayGateway: clientId, clientSecret, subscriptionKey, merchantSerialNumber are required',
      );
    }
    this.base = cfg.apiBaseUrl ?? TEST_BASE;
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    const res = await request(`${this.base}/accesstoken/get`, {
      method: 'POST',
      headers: {
        'client_id': this.cfg.clientId,
        'client_secret': this.cfg.clientSecret,
        'Ocp-Apim-Subscription-Key': this.cfg.subscriptionKey,
        'Merchant-Serial-Number': this.cfg.merchantSerialNumber,
      },
    });
    if (res.statusCode >= 300) {
      const t = await res.body.text();
      throw new PaymentGatewayError(
        this.id as any,
        `mobilepay.token.${res.statusCode}`,
        t,
        true,
      );
    }
    const json = (await res.body.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }

  private async authedHeaders(idempotencyKey: string): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': this.cfg.subscriptionKey,
      'Merchant-Serial-Number': this.cfg.merchantSerialNumber,
      'Vipps-System-Name': 'bloomoulu',
      'Vipps-System-Version': '1.0.0',
      'Vipps-System-Plugin-Name': 'bloomoulu-api',
      'Vipps-System-Plugin-Version': '1.0.0',
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    };
  }

  /** One-off MobilePay payment via ePayment API. */
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutHandoff> {
    const headers = await this.authedHeaders(input.orderId);
    const totalCents = input.lineItems.reduce((s, li) => s + li.amountCents, 0);
    const body = {
      amount: { currency: 'EUR', value: totalCents },
      paymentMethod: { type: 'WALLET' },
      reference: input.orderId,
      returnUrl: input.successUrl,
      userFlow: 'WEB_REDIRECT',
      paymentDescription: input.lineItems.map((l) => l.description).join('; ').slice(0, 100),
      profile: { scope: 'email name phoneNumber' },
    };
    const res = await request(`${this.base}/epayment/v1/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.statusCode >= 300) {
      const t = await res.body.text();
      throw new PaymentGatewayError(
        this.id as any,
        `mobilepay.payment.${res.statusCode}`,
        t,
        res.statusCode >= 500,
      );
    }
    const json = (await res.body.json()) as { redirectUrl: string; reference: string };
    return {
      provider: this.id as any,
      redirectUrl: json.redirectUrl,
      providerSessionId: json.reference,
    };
  }

  /** Recurring agreement. SCA happens once when the donor accepts in app. */
  async createAgreement(input: CreateAgreementInput): Promise<AgreementHandoff> {
    const headers = await this.authedHeaders(input.orderId);
    const body = {
      pricing: {
        type: 'LEGACY',
        amount: input.amountCents,
        currency: 'EUR',
      },
      interval: {
        unit: input.interval === 'annual' ? 'YEAR' : 'MONTH',
        count: 1,
      },
      merchantRedirectUrl: input.successUrl,
      merchantAgreementUrl: input.successUrl,
      productName: input.productName.slice(0, 45),
      productDescription: input.productDescription.slice(0, 100),
      isApp: false,
      scope: 'name email',
      countryCode: input.donor.countryCode,
    };
    const res = await request(`${this.base}/recurring/v3/agreements`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.statusCode >= 300) {
      const t = await res.body.text();
      throw new PaymentGatewayError(
        this.id as any,
        `mobilepay.agreement.${res.statusCode}`,
        t,
        res.statusCode >= 500,
      );
    }
    const json = (await res.body.json()) as {
      agreementId: string;
      vippsConfirmationUrl: string;
    };
    return {
      provider: this.id as any,
      agreementId: json.agreementId,
      confirmationUrl: json.vippsConfirmationUrl,
    };
  }

  /** Issue a charge against an active agreement (annual/monthly renewal). */
  async chargeAgreement(input: ChargeAgreementInput): Promise<ChargeResult> {
    const headers = await this.authedHeaders(input.orderId);
    const body = {
      amount: input.amountCents,
      transactionType: 'DIRECT_CAPTURE',
      description: input.description.slice(0, 100),
      due: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
      retryDays: 5,
      orderId: input.orderId,
    };
    const res = await request(
      `${this.base}/recurring/v3/agreements/${encodeURIComponent(input.agreementId)}/charges`,
      { method: 'POST', headers, body: JSON.stringify(body) },
    );
    if (res.statusCode >= 300) {
      const t = await res.body.text();
      return {
        ok: false,
        code: `mobilepay.charge.${res.statusCode}`,
        message: t,
      };
    }
    const json = (await res.body.json()) as { chargeId: string; status: string };
    return {
      ok: true,
      chargeId: json.chargeId,
      status: json.status === 'CHARGED' ? 'succeeded' : 'pending',
    };
  }

  async cancelAgreement(input: CancelAgreementInput): Promise<void> {
    const headers = await this.authedHeaders(randomUUID());
    const body = { status: 'STOPPED' };
    const res = await request(
      `${this.base}/recurring/v3/agreements/${encodeURIComponent(input.agreementId)}`,
      { method: 'PATCH', headers, body: JSON.stringify(body) },
    );
    if (res.statusCode >= 300 && res.statusCode !== 404) {
      const t = await res.body.text();
      throw new PaymentGatewayError(
        this.id as any,
        `mobilepay.cancel.${res.statusCode}`,
        t,
        true,
      );
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const headers = await this.authedHeaders(randomUUID());
    const body = { modificationAmount: { currency: 'EUR', value: input.amountCents } };
    const res = await request(
      `${this.base}/epayment/v1/payments/${encodeURIComponent(input.providerPaymentRef)}/refund`,
      { method: 'POST', headers, body: JSON.stringify(body) },
    );
    if (res.statusCode >= 300) {
      const t = await res.body.text();
      return {
        ok: false,
        code: `mobilepay.refund.${res.statusCode}`,
        message: t,
      };
    }
    const json = (await res.body.json()) as { reference: string };
    return { ok: true, refundId: json.reference };
  }

  /**
   * Webhook signature verification — MobilePay sends an `Authorization` header
   * with an HMAC-SHA256 of `{date} + {sha256(body)}` keyed with the webhook
   * secret. We follow https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/
   */
  async parseWebhook(input: ParseWebhookInput): Promise<NormalisedEvent> {
    const headersLower = lowercaseHeaders(input.headers);
    const provided = headersLower['authorization'] ?? '';
    if (!provided.startsWith('HMAC-SHA256 ')) {
      throw new WebhookSignatureError(
        this.id as any,
        'MobilePay webhook missing HMAC-SHA256 header',
      );
    }
    const sig = provided.slice('HMAC-SHA256 '.length);
    const date = headersLower['x-ms-date'] ?? '';
    const sha256 = headersLower['x-ms-content-sha256'] ?? '';
    const stringToSign = `${date}\n${sha256}`;
    const computed = createHmac('sha256', this.cfg.webhookSecret)
      .update(stringToSign)
      .digest('base64');
    if (
      computed.length !== sig.length ||
      !timingSafeEqual(Buffer.from(computed), Buffer.from(sig))
    ) {
      throw new WebhookSignatureError(
        this.id as any,
        'MobilePay webhook signature mismatch',
      );
    }
    const payload = JSON.parse(input.rawBody) as {
      eventId: string;
      eventName: string;
      reference?: string;
      agreementId?: string;
      timestamp?: string;
    };
    const evtId = payload.eventId ?? `${payload.eventName}:${payload.timestamp ?? Date.now()}`;

    switch (payload.eventName) {
      case 'epayment.authorized.v1':
      case 'epayment.captured.v1':
        return {
          kind: 'payment.succeeded',
          provider: this.id as any,
          providerEventId: evtId,
          orderId: payload.reference ?? '',
          providerPaymentRef: payload.reference ?? '',
          amountCents: 0, // filled from the API on enrichment
          currency: 'EUR',
          paidAt: new Date(payload.timestamp ?? Date.now()),
          metadata: {},
        };
      case 'epayment.cancelled.v1':
      case 'epayment.failed.v1':
      case 'epayment.aborted.v1':
        return {
          kind: 'payment.failed',
          provider: this.id as any,
          providerEventId: evtId,
          orderId: payload.reference ?? '',
          providerPaymentRef: payload.reference ?? '',
          failureCode: payload.eventName,
          failureMessage: payload.eventName,
          metadata: {},
        };
      case 'recurring.agreement-activated.v1':
        return {
          kind: 'agreement.activated',
          provider: this.id as any,
          providerEventId: evtId,
          orderId: payload.reference ?? '',
          agreementId: payload.agreementId ?? '',
          metadata: {},
        };
      case 'recurring.agreement-stopped.v1':
      case 'recurring.agreement-expired.v1':
        return {
          kind: 'agreement.cancelled',
          provider: this.id as any,
          providerEventId: evtId,
          orderId: payload.reference ?? '',
          agreementId: payload.agreementId ?? '',
          cancelledAt: new Date(payload.timestamp ?? Date.now()),
          cancelReason: payload.eventName,
          metadata: {},
        };
      default:
        return {
          kind: 'unknown',
          provider: this.id as any,
          providerEventId: evtId,
          raw: payload,
        };
    }
  }
}

function lowercaseHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}
