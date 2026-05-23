import { z } from 'zod';

/**
 * Adoption tier IDs — must match the `TierId` Prisma enum (packages/db) and
 * the tier rows seeded from env vars (packages/db/prisma/seed/tiers.ts).
 */
export const TIER_IDS = ['seedling', 'rooted', 'vulnerable', 'endangered', 'corporate'] as const;
export type TierId = (typeof TIER_IDS)[number];

/** Zod enum for DTOs and validation. */
export const TierIdEnum = z.enum(TIER_IDS);

/**
 * Public-facing tier display order — corporate is rendered separately as a
 * "for companies" strip, not inline with the consumer tiers, so it's omitted
 * here. Used by the wizard step 1 grid and the per-item dropdowns.
 */
export const PUBLIC_TIER_ORDER: readonly TierId[] = [
  'seedling',
  'rooted',
  'vulnerable',
  'endangered',
] as const;

/** Full ordered list including corporate, for admin / API contexts. */
export const ALL_TIER_ORDER: readonly TierId[] = [...PUBLIC_TIER_ORDER, 'corporate'] as const;

/**
 * Tiers eligible to receive a physical plaque next to the plant. Defaults to
 * endangered + corporate; admin can override via SystemSetting.
 */
export const DEFAULT_PLAQUE_ELIGIBLE_TIERS: readonly TierId[] = [
  'endangered',
  'corporate',
] as const;
