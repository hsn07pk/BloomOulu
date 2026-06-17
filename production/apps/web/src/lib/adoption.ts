/**
 * Donation-eligibility helpers — one place that decides which plants can
 * be the designated beneficiary of a directed gift. Used by the plant
 * detail page CTA so the rule is enforced consistently.
 *
 * The API enforces the same rule independently in
 * apps/api/src/modules/donations/donations.service.ts — defence in depth,
 * since a determined client could still POST directly.
 */

/**
 * IUCN-style red-list status codes that block a directed gift. Currently
 * just EX (Extinct): you can't fund the conservation of a species that
 * has already been lost. Display surfaces (plant detail, browse) keep
 * showing these plants — they're still part of the historical collection
 * — they just don't get a "Donate to this plant" button (a general gift
 * to the Garden is always available instead).
 *
 * Add codes here if the policy ever expands (e.g. EW = Extinct in the
 * Wild). Don't extend it to NA / DD — those are "not assessed", not
 * "extinct", and the Garden does legitimately want support for cultivated
 * specimens.
 */
const NON_ADOPTABLE_STATUSES = new Set(['EX']);

export function isAdoptable(redListStatus: string | null | undefined): boolean {
  if (!redListStatus) return true;
  return !NON_ADOPTABLE_STATUSES.has(redListStatus.toUpperCase());
}

/**
 * Locale-aware user-facing copy for *why* a plant can't receive a directed
 * gift. Shown on the plant detail page in place of the "Donate to this
 * plant" CTA. Single source of truth so the language stays consistent.
 */
export function nonAdoptableReason(
  redListStatus: string | null | undefined,
  locale: string,
): string | null {
  if (!redListStatus) return null;
  if (redListStatus.toUpperCase() !== 'EX') return null;
  if (locale === 'fi') {
    return 'Tämä laji on luokiteltu hävinneeksi (EX), joten lahjoitusta ei voi kohdistaa sille. Voit silti tukea puutarhan suojelutyötä yleisellä lahjoituksella.';
  }
  if (locale === 'sv') {
    return 'Denna art är klassificerad som utdöd (EX), så en gåva kan inte riktas till den. Du kan ändå stödja trädgårdens bevarandearbete med en allmän donation.';
  }
  return "This species is classified Extinct (EX), so a gift can't be directed to it. You can still support the Garden's conservation work with a general donation.";
}
