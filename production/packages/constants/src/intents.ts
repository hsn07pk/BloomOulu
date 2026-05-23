import { z } from 'zod';

/**
 * Adoption intent — single source of truth for the four donor-facing intents
 * plus the corporate variant the API accepts (kept off the donor-facing
 * radio group for now).
 */
export const ADOPTION_INTENTS = ['for_self', 'gift', 'memorial', 'class', 'corporate'] as const;
export type AdoptionIntent = (typeof ADOPTION_INTENTS)[number];

/** Zod enum for DTOs. */
export const AdoptionIntentEnum = z.enum(ADOPTION_INTENTS);

/**
 * Intents the wizard's step 3 radio group exposes. Excludes 'corporate'
 * because the corporate flow is initiated via admin / sales, not the
 * self-serve wizard.
 */
export const PUBLIC_INTENTS = ['for_self', 'gift', 'memorial', 'class'] as const;
export type PublicIntent = (typeof PUBLIC_INTENTS)[number];

export function isPublicIntent(value: string): value is PublicIntent {
  return (PUBLIC_INTENTS as readonly string[]).includes(value);
}

/** Map any raw input (URL param, form value) to a valid PublicIntent. */
export function normaliseIntent(raw: string | undefined | null): PublicIntent {
  if (!raw) return 'for_self';
  if (raw === 'self' || raw === 'for_self') return 'for_self';
  return isPublicIntent(raw) ? raw : 'for_self';
}
