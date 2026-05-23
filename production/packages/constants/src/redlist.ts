import { z } from 'zod';
import type { TierId } from './tiers.js';

/**
 * IUCN Red List status codes — full set as stored in Plant.redListStatus.
 * Matches the `RedListStatus` Prisma enum.
 *
 *   CR — Critically Endangered
 *   EN — Endangered
 *   VU — Vulnerable
 *   NT — Near Threatened
 *   LC — Least Concern
 *   DD — Data Deficient
 *   EX — Extinct
 *   NA — Not Assessed (used when the species isn't on a list)
 */
export const RED_LIST_STATUSES = ['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'EX', 'NA'] as const;
export type RedListStatus = (typeof RED_LIST_STATUSES)[number];

export const RedListStatusEnum = z.enum(RED_LIST_STATUSES);

/** Subset shown in donor-facing filters (extinct and not-assessed hidden). */
export const PUBLIC_RED_LIST_FILTER: readonly RedListStatus[] = [
  'CR',
  'EN',
  'VU',
  'NT',
  'LC',
] as const;

/**
 * Suggest the adoption tier that best matches a plant's Red List status.
 * Rarer plants get the higher tier, so a donor browsing an Endangered
 * plant is gently nudged toward the matching donation level.
 */
export function suggestedTierId(status: string | null | undefined): TierId {
  if (status === 'CR' || status === 'EN') return 'endangered';
  if (status === 'VU') return 'vulnerable';
  return 'rooted';
}
