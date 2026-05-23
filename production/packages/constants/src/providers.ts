import { z } from 'zod';

/**
 * Every payment provider the backend supports. Matches the `PaymentProvider`
 * Prisma enum and the existing `ProviderId` in @bloomoulu/payments — both
 * re-export from here.
 */
export const PAYMENT_PROVIDERS = ['paytrail', 'mobilepay', 'bank_transfer'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PaymentProviderEnum = z.enum(PAYMENT_PROVIDERS);

/**
 * Donor-facing providers shown in the wizard step 4 picker.
 * `bank_transfer` is intentionally omitted: the donor never picks it
 * directly — the router falls back to it during admin reconciliation when
 * Paytrail / MobilePay are unavailable.
 */
export const DONOR_FACING_PROVIDERS = ['paytrail', 'mobilepay'] as const;
export type DonorFacingProvider = (typeof DONOR_FACING_PROVIDERS)[number];

export const DonorFacingProviderEnum = z.enum(DONOR_FACING_PROVIDERS);
