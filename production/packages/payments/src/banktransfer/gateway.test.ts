import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { BankTransferGateway, rfCreditorReference, isValidRfReference } from './gateway.js';

describe('RF Creditor Reference (ISO 11649)', () => {
  it('generates a valid reference for a UUIDv7 orderId', () => {
    const orderId = '0190a3b1-c842-7d8f-9abc-def012345678';
    const ref = rfCreditorReference(orderId);
    expect(ref).toMatch(/^RF\d{2}/);
    expect(isValidRfReference(ref)).toBe(true);
  });

  it('rejects tampered references', () => {
    const ref = rfCreditorReference('0190a3b1-c842-7d8f-9abc-def012345678');
    const tampered = ref.replace('A', 'B').replace('1', '2');
    expect(isValidRfReference(tampered)).toBe(false);
  });

  it('round-trips known fixture from finanssiala', () => {
    // From https://www.finanssiala.fi guidance examples:
    expect(isValidRfReference('RF18 5390 0754 7034')).toBe(true);
    expect(isValidRfReference('RF18539007547034')).toBe(true);
  });

  it('is deterministic for a given orderId', () => {
    const a = rfCreditorReference('019085b0-1111-7000-8000-aaaaaaaaaaaa');
    const b = rfCreditorReference('019085b0-1111-7000-8000-aaaaaaaaaaaa');
    expect(a).toBe(b);
  });
});

describe('BankTransferGateway.parseWebhook auth', () => {
  const cfg = {
    iban: 'FI21 1234 5600 0007 85',
    bic: 'OKOYFIHH',
    beneficiaryName: 'BloomOulu',
    instructionsUrl: 'https://example.test/donate/pay',
  };
  const validPayload = {
    reference: rfCreditorReference('019085b0-1111-7000-8000-aaaaaaaaaaaa'),
    amountCents: 2500,
    paidAt: new Date().toISOString(),
    bankRef: 'bank-ref-1',
  };
  const body = JSON.stringify(validPayload);

  it('accepts unsigned requests when no secret is configured', async () => {
    const gw = new BankTransferGateway(cfg);
    const event = await gw.parseWebhook({ rawBody: body, headers: {} });
    expect(event.kind).toBe('checkout.completed');
  });

  it('rejects unsigned requests when secret is configured', async () => {
    const gw = new BankTransferGateway({ ...cfg, webhookSecret: 'top-secret' });
    await expect(gw.parseWebhook({ rawBody: body, headers: {} })).rejects.toThrow(
      /missing HMAC-SHA256/,
    );
  });

  it('rejects mismatched signatures', async () => {
    const gw = new BankTransferGateway({ ...cfg, webhookSecret: 'top-secret' });
    const headers = { authorization: `HMAC-SHA256 ${'a'.repeat(64)}` };
    await expect(gw.parseWebhook({ rawBody: body, headers })).rejects.toThrow(
      /signature mismatch/,
    );
  });

  it('accepts a correctly signed request', async () => {
    const secret = 'top-secret';
    const gw = new BankTransferGateway({ ...cfg, webhookSecret: secret });
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    const headers = { authorization: `HMAC-SHA256 ${sig}` };
    const event = await gw.parseWebhook({ rawBody: body, headers });
    expect(event.kind).toBe('checkout.completed');
  });

  it('refuses an unsolicited Authorization header in dev mode (fail-closed)', async () => {
    const gw = new BankTransferGateway(cfg); // no secret
    const headers = { authorization: 'HMAC-SHA256 anything' };
    await expect(gw.parseWebhook({ rawBody: body, headers })).rejects.toThrow(
      /not configured/,
    );
  });
});
