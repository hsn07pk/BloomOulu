import { z } from 'zod';

/**
 * Donation status — must match the `DonationStatus` Prisma enum (packages/db).
 * One-time gifts only: a donation moves pending → completed once its payment
 * settles, or → failed / → refunded.
 */
export const DONATION_STATUSES = ['pending', 'completed', 'failed', 'refunded'] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

/** Zod enum for DTOs and validation. */
export const DonationStatusEnum = z.enum(DONATION_STATUSES);

/**
 * Suggested one-time donation amounts, in cents. The donate form renders
 * these as quick-pick chips alongside a free "custom amount" field. Admins
 * override the list via SystemSetting `donation.suggestedAmountsCents`
 * without a redeploy; this is the boot default.
 *
 * Anchored on the Garden's existing €5 voluntary admission so the smallest
 * chip mirrors what visitors already recognise.
 */
export const DEFAULT_SUGGESTED_AMOUNTS_CENTS: readonly number[] = [500, 1500, 2500, 5000] as const;

/** Amount preselected when the donate form first paints. */
export const DEFAULT_DONATION_AMOUNT_CENTS = 2500;

/**
 * Self-serve floor / ceiling. The floor keeps gifts above the payment
 * providers' minimum chargeable amount; the ceiling routes very large
 * (corporate / major) gifts to a human instead of the public form.
 */
export const MIN_DONATION_CENTS = 100; // €1
export const MAX_DONATION_CENTS = 10_000_00; // €10,000

/** Zod schema for a self-serve donation amount in cents. */
export const DonationAmountCents = z
  .number()
  .int()
  .min(MIN_DONATION_CENTS)
  .max(MAX_DONATION_CENTS);

/** True when `cents` is an acceptable self-serve donation amount. */
export function isValidDonationCents(cents: number): boolean {
  return (
    Number.isInteger(cents) && cents >= MIN_DONATION_CENTS && cents <= MAX_DONATION_CENTS
  );
}

/** Clamp any input to the allowed self-serve donation range. */
export function clampDonationCents(cents: number): number {
  if (!Number.isFinite(cents)) return DEFAULT_DONATION_AMOUNT_CENTS;
  return Math.min(MAX_DONATION_CENTS, Math.max(MIN_DONATION_CENTS, Math.round(cents)));
}
