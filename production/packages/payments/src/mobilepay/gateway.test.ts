import { describe, it, expect } from 'vitest';
import { MobilePayGateway } from './gateway.js';
import { createHash, createHmac } from 'node:crypto';

describe('MobilePayGateway.parseWebhook', () => {
  const webhookSecret = 'super-secret-32-chars-min-length-here';
  const gateway = new MobilePayGateway({
    clientId: 'cid', clientSecret: 'csec',
    subscriptionKey: 'subk', merchantSerialNumber: 'msn',
    webhookSecret,
    returnUrl: 'http://localhost:3000/return',
    callbackPrefix: 'http://localhost:4000/webhooks/mobilepay',
  });

  function buildSignedWebhook(payload: object) {
    const body = JSON.stringify(payload);
    const sha256 = createHash('sha256').update(body).digest('base64');
    const date = new Date().toUTCString();
    const stringToSign = `${date}\n${sha256}`;
    const sig = createHmac('sha256', webhookSecret).update(stringToSign).digest('base64');
    return {
      body,
      headers: {
        'authorization': `HMAC-SHA256 ${sig}`,
        'x-ms-date': date,
        'x-ms-content-sha256': sha256,
      },
    };
  }

  it('parses an authorised payment event', async () => {
    const { body, headers } = buildSignedWebhook({
      eventId: 'evt_1',
      eventName: 'epayment.authorized.v1',
      reference: 'order-123',
      timestamp: new Date().toISOString(),
    });
    const event = await gateway.parseWebhook({ rawBody: body, headers });
    expect(event.kind).toBe('payment.succeeded');
  });

  it('parses an agreement activation', async () => {
    const { body, headers } = buildSignedWebhook({
      eventId: 'evt_2',
      eventName: 'recurring.agreement-activated.v1',
      agreementId: 'agr_42',
      reference: 'order-456',
    });
    const event = await gateway.parseWebhook({ rawBody: body, headers });
    expect(event.kind).toBe('agreement.activated');
  });

  it('rejects tampered signature', async () => {
    const { body, headers } = buildSignedWebhook({
      eventId: 'evt_x',
      eventName: 'epayment.authorized.v1',
      reference: 'order-789',
    });
    headers['authorization'] = 'HMAC-SHA256 ' + 'a'.repeat(44);
    await expect(gateway.parseWebhook({ rawBody: body, headers })).rejects.toThrow(
      /signature mismatch/,
    );
  });
});
