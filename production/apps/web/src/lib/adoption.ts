/**
 * Adoption eligibility helpers — one place that decides which plants
 * can be adopted. Used by every UI surface that lets a donor start an
 * adoption flow (plant detail page CTAs, "Add to cart" button, /cart
 * checkout, /adopt wizard) so the rule is enforced consistently.
 *
 * The API enforces the same rule independently in
 * apps/api/src/modules/adoptions/adoptions.service.ts — defence in
 * depth, since a determined client could still POST directly.
 */

/**
 * IUCN-style red-list status codes that block adoption. Currently just
 * EX (Extinct): you can't sponsor the conservation of a species that
 * has already been lost. Display surfaces (plant detail, cart, browse)
 * keep showing these plants — they're still part of the historical
 * collection — they just don't get an "Adopt" button.
 *
 * Add codes here if the policy ever expands (e.g. EW = Extinct in the
 * Wild). Don't extend it to NA / DD — those are "not assessed", not
 * "extinct", and the gardens do legitimately want donor support for
 * cultivated specimens.
 */
const NON_ADOPTABLE_STATUSES = new Set(['EX']);

export function isAdoptable(redListStatus: string | null | undefined): boolean {
  if (!redListStatus) return true;
  return !NON_ADOPTABLE_STATUSES.has(redListStatus.toUpperCase());
}

/**
 * Locale-aware user-facing copy for *why* a plant can't be adopted.
 * Used by the plant detail page's replacement card and by cart-page
 * notices. Single source of truth so the language stays consistent
 * even if we add more reasons later (e.g. "retired", "not yet ready
 * for adoption").
 */
export function nonAdoptableReason(
  redListStatus: string | null | undefined,
  locale: string,
): string | null {
  if (!redListStatus) return null;
  if (redListStatus.toUpperCase() !== 'EX') return null;
  if (locale === 'fi') {
    return 'Tämä laji on luokiteltu hävinneeksi (EX), eikä sitä voida adoptoida. Lajia ei voi enää suojella, mutta sen historiaa säilytetään kokoelmassamme.';
  }
  if (locale === 'sv') {
    return 'Denna art är klassificerad som utdöd (EX) och kan inte adopteras. Arten kan inte längre bevaras, men dess historia finns kvar i vår samling.';
  }
  return "This species is classified Extinct (EX) and cannot be adopted. The conservation window for this plant has closed, but its history is preserved in our collection.";
}
