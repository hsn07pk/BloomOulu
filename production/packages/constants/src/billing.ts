import { z } from 'zod';

/**
 * Billing interval — every donor-facing UI, API DTO, and DB column references
 * this single source of truth. Add a new cadence here and the wizard,
 * /cart/checkout, plant page, settings service, and adoptions DTOs all pick
 * it up.
 */
export const BILLING_INTERVALS = ['monthly', 'annual', 'one_time'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * Display order for the toggle in the wizard step 1 / plant detail sidebar.
 * One-time on the left, monthly on the right; annual sits between when
 * admin has enabled it. Order is a UX decision, not an admin setting, so it
 * lives here rather than in SystemSetting.
 */
export const BILLING_INTERVAL_DISPLAY_ORDER: readonly BillingInterval[] = [
  'one_time',
  'annual',
  'monthly',
] as const;

/** Zod enum for DTOs and validation. */
export const BillingIntervalEnum = z.enum(BILLING_INTERVALS);

/**
 * Production default — admin can enable annual via /admin → SystemSetting →
 * adoption.intervalsEnabled. Hides annual by default to avoid surprising
 * donors with auto-renewal at year boundaries.
 */
export const DEFAULT_INTERVALS_ENABLED: readonly BillingInterval[] = [
  'monthly',
  'one_time',
] as const;

/**
 * Choose the initial billing interval for first-paint UI:
 *   1. honour an explicit preset (e.g. from a plant-page query param) if it's
 *      in the admin allow-list;
 *   2. otherwise prefer one_time so donors aren't quietly enrolled in a
 *      recurring charge;
 *   3. else fall back to the first enabled interval (so a stack that only
 *      enables annual still works).
 */
export function pickInitialInterval(
  preset: BillingInterval | null | undefined,
  enabled: readonly BillingInterval[],
): BillingInterval {
  if (preset && enabled.includes(preset)) return preset;
  if (enabled.includes('one_time')) return 'one_time';
  return enabled[0] ?? 'monthly';
}
