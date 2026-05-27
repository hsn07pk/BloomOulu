/**
 * Tier benefit catalog — declarative source of truth for what every
 * adopter is entitled to. The static shape lives here (not in the DB)
 * so a deploy is the only step needed to add/change benefits; the per-
 * adoption fulfillment row in `AdoptionBenefit` tracks delivery state.
 *
 * Categories drive the admin UI grouping + worker scheduling:
 *
 *   digital   — system can fulfil automatically (download URL, donor
 *               wall listing, etc.); status flips to 'fulfilled' the
 *               moment the artefact is generated.
 *   physical  — needs a human + a shipping address; admin workflow
 *               drives status through pending → in_progress → fulfilled.
 *   event     — needs scheduling + RSVP; uses eventName/eventDate +
 *               rsvpStatus columns.
 *   recurring — repeats on a cadence (quarterly notes, annual seed
 *               packet); worker re-enqueues based on `nextDueAt`.
 *
 * `autoFulfill` true = the system flips to 'fulfilled' on its own once
 * the underlying artefact exists (e.g. digital certificate is always
 * available the moment the Adoption activates).
 */

export type BenefitCategory = 'digital' | 'physical' | 'event' | 'recurring';

export interface BenefitDefinition {
  /** Stable machine id — never rename without a migration. */
  key: string;
  category: BenefitCategory;
  /** Short ops-facing label shown in the admin list. */
  label: string;
  /** Optional copy for the donor-facing My Garden view. */
  donorLabel?: string;
  /** True if no manual fulfilment step is needed (e.g. a download URL). */
  autoFulfill?: boolean;
  /** True if delivery requires a postal address on the donor. */
  requiresAddress?: boolean;
  /** Optional cadence hint for `recurring` items (used by future workers). */
  cadenceMonths?: number;
}

const DIGITAL_CERTIFICATE: BenefitDefinition = {
  key: 'digital.certificate',
  category: 'digital',
  label: 'Digital adoption certificate',
  donorLabel: 'Digital certificate (download)',
  autoFulfill: true,
};

const STORY_PAGE: BenefitDefinition = {
  key: 'digital.story_page',
  category: 'digital',
  label: 'Public plant story page',
  donorLabel: 'Story page with your dedication',
  autoFulfill: true,
};

const HOME_REGION_PLANT: BenefitDefinition = {
  key: 'digital.home_region_plant',
  category: 'digital',
  label: 'I@H · plant from donor’s home region',
  donorLabel: 'Home-region pairing recorded',
  autoFulfill: true,
};

const QUARTERLY_NOTES: BenefitDefinition = {
  key: 'recurring.quarterly_notes',
  category: 'recurring',
  label: 'Quarterly grower’s notes (email)',
  donorLabel: 'Quarterly grower’s notes',
  cadenceMonths: 3,
};

const SEEDLING: BenefitDefinition[] = [
  DIGITAL_CERTIFICATE,
  STORY_PAGE,
  HOME_REGION_PLANT,
  QUARTERLY_NOTES,
];

const ROOTED_ADDITIONS: BenefitDefinition[] = [
  {
    key: 'physical.printed_certificate',
    category: 'physical',
    label: 'Print + mail certificate',
    donorLabel: 'Printed certificate (mailed)',
    requiresAddress: true,
  },
  {
    key: 'physical.home_region_postcard',
    category: 'physical',
    label: 'Mail home-region postcard',
    donorLabel: 'I@H postcard from your plant’s region',
    requiresAddress: true,
  },
  {
    key: 'recurring.seasonal_photos',
    category: 'recurring',
    label: 'Seasonal photo email of donor’s plant',
    donorLabel: 'Seasonal photos of YOUR plant',
    cadenceMonths: 3,
  },
  {
    key: 'event.open_day_invite',
    category: 'event',
    label: 'Adopters’ Open Day invitation',
    donorLabel: 'Adopters’ Open Day invite',
  },
];
const ROOTED: BenefitDefinition[] = [...SEEDLING, ...ROOTED_ADDITIONS];

const VULNERABLE_ADDITIONS: BenefitDefinition[] = [
  {
    key: 'physical.signed_art_print',
    category: 'physical',
    label: 'Signed botanical art print',
    donorLabel: 'Signed botanical art print',
    requiresAddress: true,
  },
  {
    key: 'event.garden_walk',
    category: 'event',
    label: 'Themed garden walk — 1 admission',
    donorLabel: 'Themed garden walk',
  },
  {
    key: 'event.open_day_plus_one',
    category: 'event',
    label: 'Adopters’ Open Day +1 guest',
    donorLabel: 'Open Day + 1 guest',
  },
  {
    key: 'digital.donor_wall_listing',
    category: 'digital',
    label: 'Donor wall listing (web)',
    donorLabel: 'Donor wall listing',
    autoFulfill: true,
  },
  {
    key: 'physical.shared_plaque',
    category: 'physical',
    label: 'Engrave name on shared adopters’ plaque',
    donorLabel: 'Name on shared adopters’ plaque',
  },
];
const VULNERABLE: BenefitDefinition[] = [...ROOTED, ...VULNERABLE_ADDITIONS];

const ENDANGERED_ADDITIONS: BenefitDefinition[] = [
  {
    key: 'physical.limited_art_print',
    category: 'physical',
    label: 'Limited-edition signed art print',
    donorLabel: 'Limited-edition signed art print',
    requiresAddress: true,
  },
  {
    key: 'physical.botany_book',
    category: 'physical',
    label: 'Curated botany book',
    donorLabel: 'Curated botany book',
    requiresAddress: true,
  },
  {
    key: 'event.donor_dinner',
    category: 'event',
    label: 'Donor dinner + seed-bank visit',
    donorLabel: 'Donor dinner + seed-bank visit',
  },
  {
    key: 'physical.personal_plaque',
    category: 'physical',
    label: 'Engrave + install plaque next to plant',
    donorLabel: 'Engraved plaque next to YOUR plant',
  },
  {
    key: 'recurring.annual_seed_packet',
    category: 'recurring',
    label: 'Annual seed packet shipment',
    donorLabel: 'Annual seed packet',
    requiresAddress: true,
    cadenceMonths: 12,
  },
];
const ENDANGERED: BenefitDefinition[] = [...VULNERABLE, ...ENDANGERED_ADDITIONS];

const CORPORATE_ADDITIONS: BenefitDefinition[] = [
  {
    key: 'digital.csr_quarterly_report',
    category: 'recurring',
    label: 'CSR-ready quarterly impact report (PDF)',
    donorLabel: 'CSR quarterly impact report',
    cadenceMonths: 3,
  },
  {
    key: 'physical.logo_signage',
    category: 'physical',
    label: 'Install corporate logo on greenhouse signage',
    donorLabel: 'Logo placement on greenhouse signage',
  },
  {
    key: 'event.private_event',
    category: 'event',
    label: 'Private event slot — up to 20 guests',
    donorLabel: 'Private garden event (up to 20)',
  },
];
const CORPORATE: BenefitDefinition[] = [...ENDANGERED, ...CORPORATE_ADDITIONS];

/**
 * Map from TierId (Prisma enum value) to the benefit list. Lower tiers
 * are subsumed by higher ones via spread above so adding a Rooted-tier
 * benefit automatically propagates to Vulnerable / Endangered / Corporate.
 */
export const TIER_BENEFITS: Record<string, BenefitDefinition[]> = {
  seedling: SEEDLING,
  rooted: ROOTED,
  vulnerable: VULNERABLE,
  endangered: ENDANGERED,
  corporate: CORPORATE,
};

export function benefitsForTier(tierId: string): BenefitDefinition[] {
  return TIER_BENEFITS[tierId] ?? SEEDLING;
}
