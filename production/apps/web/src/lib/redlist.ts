/**
 * Donor/visitor-facing red-list presentation. The public site shows only TWO
 * conservation categories — "Endangered" (the IUCN Threatened set: CR/EN/VU)
 * and "Non-endangered" (everything else) — even though the API stores the full
 * 8-code IUCN scale. The bucketing rule lives in @bloomoulu/constants so the
 * web, API and any future surface agree; this module only adds the localized
 * label + badge class for rendering.
 *
 * Usage at any badge site:
 *   <span className={redListBadgeClass(p.redListStatus)}>
 *     {redListBucketLabel(p.redListStatus, locale)}
 *   </span>
 */
import { endangermentBucket, type EndangermentBucket } from '@bloomoulu/constants';

const LABELS: Record<string, Record<EndangermentBucket, string>> = {
  en: { endangered: 'Endangered', 'non-endangered': 'Non-endangered' },
  // Mirrors the Finnish Red List wording: uhanalainen = threatened.
  fi: { endangered: 'Uhanalainen', 'non-endangered': 'Ei uhanalainen' },
  sv: { endangered: 'Hotad', 'non-endangered': 'Ej hotad' },
};

/** Localized two-bucket label for a stored IUCN code. */
export function redListBucketLabel(status: string | null | undefined, locale: string): string {
  const dict = LABELS[locale] ?? LABELS.en!;
  return dict[endangermentBucket(status)];
}

/** Badge CSS class for a stored IUCN code (collapsed to two buckets). */
export function redListBadgeClass(status: string | null | undefined): string {
  return `badge badge-${endangermentBucket(status)}`;
}
