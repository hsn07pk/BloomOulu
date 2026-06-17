import type { ProviderId } from './types.js';

export interface RouterInput {
  donorCountry: string;
  donorPrefers?: 'card' | 'mobilepay' | 'bank' | 'apple_pay' | 'google_pay';
  enabledProviders: ReadonlyArray<ProviderId>;
}

/**
 * Choose the payment provider for a one-time donation.
 *
 * Priority:
 *   1. Donor explicit preference (if its provider is enabled).
 *   2. FI donor + bank_transfer enabled → bank_transfer (zero fees).
 *   3. Otherwise → Paytrail (cards + all Finnish online banks), then
 *      MobilePay, then bank_transfer as the last resort.
 */
export function pickProvider(input: RouterInput): ProviderId {
  const e = new Set<ProviderId>(input.enabledProviders);
  const want = (p: ProviderId) => (e.has(p) ? p : undefined);

  if (input.donorPrefers === 'mobilepay') return want('mobilepay') ?? want('paytrail') ?? 'bank_transfer';
  if (input.donorPrefers === 'card') return want('paytrail') ?? 'bank_transfer';
  if (input.donorPrefers === 'bank') return want('bank_transfer') ?? want('paytrail') ?? 'paytrail';
  if (input.donorPrefers === 'apple_pay' || input.donorPrefers === 'google_pay')
    return want('paytrail') ?? 'bank_transfer';

  if (input.donorCountry === 'FI' && e.has('bank_transfer')) return 'bank_transfer';
  return want('paytrail') ?? want('mobilepay') ?? want('bank_transfer') ?? 'bank_transfer';
}
