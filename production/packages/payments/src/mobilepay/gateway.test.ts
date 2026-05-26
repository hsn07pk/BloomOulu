import { describe, it, expect } from 'vitest';
import { MobilePayGateway } from './gateway.js';
import { createHash, createHmac } from 'node:crypto';

describe('MobilePayGateway.parseWebhook (Vipps spec)', () => {
  const webhookSecret = 'super-secret-32-chars-min-length-here';
  const host = 'api.bloomoulu.fi';
  const path = '/webhooks/mobilepay';
  const gateway = new MobilePayGateway({
    clientId: 'cid', clientSecret: 'csec',
    subscriptionKey: 'subk', merchantSerialNumber: 'msn',
    webhookSecret,
    returnUrl: 'http://localhost:3000/return',
    callbackPrefix: 'http://localhost:4000/webhooks/mobilepay',
  });

  /**
   * Build a webhook signed per the Vipps spec
   * https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication/
   *
   *   stringToSign = `${METHOD}\n${PATH}\n${date};${host};${content-sha256}`
   *   Authorization = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=<base64>`
   */
  function buildSignedWebhook(payload: object, opts: { method?: string; path?: string } = {}) {
    const body = JSON.stringify(payload);
    const sha256 = createHash('sha256').update(body).digest('base64');
    const date = new Date().toUTCString();
    const method = (opts.method ?? 'POST').toUpperCase();
    const reqPath = opts.path ?? path;
    const stringToSign = `${method}\n${reqPath}\n${date};${host};${sha256}`;
    const sig = createHmac('sha256', webhookSecret).update(stringToSign).digest('base64');
    return {
      body,
      headers: {
        'authorization': `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`,
        'x-ms-date': date,
        'x-ms-content-sha256': sha256,
        'host': host,
      },
      metadata: { 'http.method': method, 'http.path': reqPath },
    };
  }

  it('parses an authorised payment event with full Vipps signature', async () => {
    const { body, headers, metadata } = buildSignedWebhook({
      eventId: 'evt_1',
      eventName: 'epayment.authorized.v1',
      reference: 'order-123',
      timestamp: new Date().toISOString(),
    });
    const event = await gateway.parseWebhook({ rawBody: body, headers, metadata });
    expect(event.kind).toBe('payment.succeeded');
  });

  it('parses an agreement activation', async () => {
    const { body, headers, metadata } = buildSignedWebhook({
      eventId: 'evt_2',
      eventName: 'recurring.agreement-activated.v1',
      agreementId: 'agr_42',
      reference: 'order-456',
    });
    const event = await gateway.parseWebhook({ rawBody: body, headers, metadata });
    expect(event.kind).toBe('agreement.activated');
  });

  it('rejects a signature signed for the wrong path (replay across endpoints)', async () => {
    const { body, headers, metadata } = buildSignedWebhook(
      { eventId: 'evt_x', eventName: 'epayment.authorized.v1', reference: 'order-1' },
      { path: '/webhooks/different' },
    );
    // The api will report the actual request path which doesn't match what was signed.
    metadata['http.path'] = '/webhooks/mobilepay';
    await expect(gateway.parseWebhook({ rawBody: body, headers, metadata })).rejects.toThrow(
      /signature mismatch/,
    );
  });

  it('rejects a tampered body (content-sha256 mismatch)', async () => {
    const { body, headers, metadata } = buildSignedWebhook({
      eventId: 'evt_x',
      eventName: 'epayment.authorized.v1',
      reference: 'order-y',
    });
    const tamperedBody = body.replace('order-y', 'order-attacker');
    await expect(
      gateway.parseWebhook({ rawBody: tamperedBody, headers, metadata }),
    ).rejects.toThrow(/content-sha256 mismatch/);
  });

  it('rejects a tampered signature', async () => {
    const { body, headers, metadata } = buildSignedWebhook({
      eventId: 'evt_x',
      eventName: 'epayment.authorized.v1',
      reference: 'order-789',
    });
    headers['authorization'] =
      `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${'a'.repeat(44)}`;
    await expect(
      gateway.parseWebhook({ rawBody: body, headers, metadata }),
    ).rejects.toThrow(/signature mismatch/);
  });

  it('rejects a malformed Authorization header', async () => {
    const { body, headers, metadata } = buildSignedWebhook({
      eventId: 'evt_x',
      eventName: 'epayment.authorized.v1',
      reference: 'order-z',
    });
    headers['authorization'] = 'HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256';
    await expect(
      gateway.parseWebhook({ rawBody: body, headers, metadata }),
    ).rejects.toThrow(/malformed/);
  });

  it('accepts the legacy short-form signature for backwards-compat', async () => {
    const body = JSON.stringify({
      eventId: 'evt_legacy',
      eventName: 'epayment.authorized.v1',
      reference: 'order-legacy',
    });
    const sha256 = createHash('sha256').update(body).digest('base64');
    const date = new Date().toUTCString();
    const legacyStringToSign = `${date}\n${sha256}`;
    const sig = createHmac('sha256', webhookSecret).update(legacyStringToSign).digest('base64');
    const event = await gateway.parseWebhook({
      rawBody: body,
      headers: {
        'authorization': `HMAC-SHA256 ${sig}`,
        'x-ms-date': date,
        'x-ms-content-sha256': sha256,
      },
    });
    expect(event.kind).toBe('payment.succeeded');
  });
});
