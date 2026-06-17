import { z } from 'zod';

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

/** Rarer plants sort first on the donate / favourites surfaces. */
const RED_LIST_PRIORITY: Record<string, number> = {
  CR: 0,
  EN: 1,
  VU: 2,
  NT: 3,
  LC: 4,
  DD: 5,
  NA: 6,
  EX: 7,
};

/** Lower number = rarer / higher conservation priority. Unknown → last. */
export function redListPriority(status: string | null | undefined): number {
  if (!status) return 99;
  return RED_LIST_PRIORITY[status] ?? 99;
}
