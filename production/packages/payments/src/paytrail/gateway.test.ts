import { describe, it, expect } from 'vitest';
import { PaytrailGateway } from './gateway.js';
import { createHmac } from 'node:crypto';

describe('PaytrailGateway.parseWebhook', () => {
  const secret = 'SAIPPUAKAUPPIAS';
  const gateway = new PaytrailGateway({
    merchantId: '375917',
    secret,
    webhookSecret: secret,
  });

  function buildSignedCallback(status: 'ok' | 'fail', stamp: string, transactionId: string, amount: number) {
    const headers: Record<string, string> = {
      'checkout-account': '375917',
      'checkout-algorithm': 'sha256',
      'checkout-amount': String(amount),
      'checkout-stamp': stamp,
      'checkout-status': status,
      'checkout-transaction-id': transactionId,
      'checkout-timestamp': new Date().toISOString(),
    };
    const ordered = Object.keys(headers)
      .filter((k) => k.toLowerCase().startsWith('checkout-'))
      .sort();
    const payload = ordered.map((k) => `${k.toLowerCase()}:${headers[k]}`).join('\n') + '\n';
    headers['signature'] = createHmac('sha256', secret).update(payload).digest('hex');
    return headers;
  }

  it('parses a successful callback', async () => {
    const stamp = '0190a3b1-c842-7d8f-9abc-def012345678';
    const headers = buildSignedCallback('ok', stamp, 'tx_123', 2500);
    const event = await gateway.parseWebhook({ rawBody: '', headers });
    expect(event.kind).toBe('checkout.completed');
    if (event.kind === 'checkout.completed') {
      expect(event.orderId).toBe(stamp);
      expect(event.providerPaymentRef).toBe('tx_123');
      expect(event.amountCents).toBe(2500);
    }
  });

  it('parses a failed callback', async () => {
    const stamp = '0190a3b1-c842-7d8f-9abc-def012345678';
    const headers = buildSignedCallback('fail', stamp, 'tx_999', 2500);
    const event = await gateway.parseWebhook({ rawBody: '', headers });
    expect(event.kind).toBe('payment.failed');
  });

  it('rejects tampered signature', async () => {
    const stamp = '0190a3b1-c842-7d8f-9abc-def012345678';
    const headers = buildSignedCallback('ok', stamp, 'tx_123', 2500);
    headers['signature'] = 'a'.repeat(64);
    await expect(gateway.parseWebhook({ rawBody: '', headers })).rejects.toThrow(
      /signature mismatch/,
    );
  });
});
