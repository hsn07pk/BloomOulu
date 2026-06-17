import { describe, it, expect } from 'vitest';
import { pickProvider } from './router.js';

describe('pickProvider', () => {
  const enabledAll = ['paytrail', 'mobilepay', 'bank_transfer'] as const;

  it('routes a donor preferring MobilePay → MobilePay', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        donorPrefers: 'mobilepay',
        enabledProviders: enabledAll,
      }),
    ).toBe('mobilepay');
  });

  it('FI donor with no preference → bank_transfer (zero fees)', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        enabledProviders: enabledAll,
      }),
    ).toBe('bank_transfer');
  });

  it('FI donor → Paytrail when bank transfer disabled', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        enabledProviders: ['paytrail', 'mobilepay'],
      }),
    ).toBe('paytrail');
  });

  it('non-FI donor → Paytrail (cards)', () => {
    expect(
      pickProvider({
        donorCountry: 'DE',
        enabledProviders: enabledAll,
      }),
    ).toBe('paytrail');
  });

  it('explicit "card" preference → Paytrail', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        donorPrefers: 'card',
        enabledProviders: enabledAll,
      }),
    ).toBe('paytrail');
  });

  it('only bank_transfer enabled → always bank_transfer', () => {
    expect(
      pickProvider({
        donorCountry: 'FI',
        enabledProviders: ['bank_transfer'],
      }),
    ).toBe('bank_transfer');
  });
});
