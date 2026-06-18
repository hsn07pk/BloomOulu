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

/**
 * Donor/visitor-facing simplification. The public web + kiosk surfaces
 * collapse the full 8-code IUCN scale into TWO buckets:
 *
 *   "endangered"      — the IUCN "Threatened" categories CR, EN, VU. This is
 *                       exactly the set the Finnish Red List 2019 counts as
 *                       *uhanalainen* (threatened); NT (near threatened),
 *                       LC, DD, EX and NA are explicitly not threatened.
 *   "non-endangered"  — everything else (NT, LC, DD, EX, NA).
 *
 * The full granular `Plant.redListStatus` is still STORED and curated in
 * /admin — this is purely a presentation-layer grouping, so the public site
 * stays simple while the database keeps the precise category.
 */
export const ENDANGERED_STATUSES: readonly RedListStatus[] = ['CR', 'EN', 'VU'] as const;

export type EndangermentBucket = 'endangered' | 'non-endangered';

/** True when the code is one of the IUCN "Threatened" categories (CR/EN/VU). */
export function isEndangered(status: string | null | undefined): boolean {
  if (!status) return false;
  return (ENDANGERED_STATUSES as readonly string[]).includes(status.toUpperCase());
}

/** Collapse an IUCN code to the donor-facing two-bucket model. */
export function endangermentBucket(status: string | null | undefined): EndangermentBucket {
  return isEndangered(status) ? 'endangered' : 'non-endangered';
}
