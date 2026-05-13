import { describe, it, expect } from 'vitest';
import { pickProvider } from './router.js';

describe('pickProvider', () => {
  const enabledAll = ['paytrail', 'mobilepay', 'bank_transfer'] as const;

  it('routes Finnish donor preferring MobilePay → MobilePay', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        donorPrefers: 'mobilepay',
        amountCents: 2500,
        intent: 'for_self',
        recurring: false,
        enabledProviders: enabledAll,
      }),
    ).toBe('mobilepay');
  });

  it('routes corporate donors to bank transfer when enabled', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        amountCents: 250_000_00,
        intent: 'corporate',
        recurring: false,
        enabledProviders: enabledAll,
      }),
    ).toBe('bank_transfer');
  });

  it('falls back to Paytrail if bank transfer disabled for corporate', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        amountCents: 250_000_00,
        intent: 'corporate',
        recurring: false,
        enabledProviders: ['paytrail', 'mobilepay'],
      }),
    ).toBe('paytrail');
  });

  it('non-FI donor → Paytrail (cards)', () => {
    expect(
      pickProvider({
        donorCountry: 'DE',
        amountCents: 7500,
        intent: 'for_self',
        recurring: false,
        enabledProviders: enabledAll,
      }),
    ).toBe('paytrail');
  });

  it('recurring + MobilePay enabled → MobilePay (native agreement)', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        amountCents: 2500,
        intent: 'for_self',
        recurring: true,
        enabledProviders: enabledAll,
      }),
    ).toBe('mobilepay');
  });

  it('explicit "card" preference → Paytrail', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        donorPrefers: 'card',
        amountCents: 2500,
        intent: 'for_self',
        recurring: false,
        enabledProviders: enabledAll,
      }),
    ).toBe('paytrail');
  });

  it('only bank_transfer enabled → always bank_transfer', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        amountCents: 2500,
        intent: 'for_self',
        recurring: true,
        enabledProviders: ['bank_transfer'],
      }),
    ).toBe('bank_transfer');
  });
});
