import type { AdoptionIntent, ProviderId } from './types.js';

export interface RouterInput {
  donorCountry: string;
  donorPrefers?: 'card' | 'mobilepay' | 'bank' | 'apple_pay' | 'google_pay';
  amountCents: number;
  intent: AdoptionIntent;
  recurring: boolean;
  enabledProviders: ReadonlyArray<ProviderId>;
}

/**
 * Choose the payment provider for a given charge.
 *
 * Priority:
 *   1. Donor explicit preference (if its provider is enabled).
 *   2. Recurring + MobilePay enabled  → MobilePay (native agreement).
 *   3. Corporate (≥ €850 TVL §57)     → bank_transfer or Paytrail invoicing.
 *   4. FI donor + bank_transfer       → bank_transfer (zero fees).
 *   5. Otherwise                       → Paytrail.
 */
export function pickProvider(input: RouterInput): ProviderId {
  const e = new Set<ProviderId>(input.enabledProviders);
  const want = (p: ProviderId) => (e.has(p) ? p : undefined);

  if (input.donorPrefers === 'mobilepay') return want('mobilepay') ?? want('paytrail') ?? 'bank_transfer';
  if (input.donorPrefers === 'card') return want('paytrail') ?? 'bank_transfer';
  if (input.donorPrefers === 'bank') return want('bank_transfer') ?? want('paytrail') ?? 'paytrail';
  if (input.donorPrefers === 'apple_pay' || input.donorPrefers === 'google_pay')
    return want('paytrail') ?? 'bank_transfer';

  if (input.recurring && e.has('mobilepay')) return 'mobilepay';

  if (input.intent === 'corporate') {
    return want('bank_transfer') ?? want('paytrail') ?? 'paytrail';
  }
  if (input.donorCountry === 'FI' && e.has('bank_transfer')) return 'bank_transfer';
  return want('paytrail') ?? want('mobilepay') ?? want('bank_transfer') ?? 'bank_transfer';
}
