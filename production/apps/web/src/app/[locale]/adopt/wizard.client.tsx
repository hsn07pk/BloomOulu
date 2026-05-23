'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  BILLING_INTERVAL_DISPLAY_ORDER,
  HOME_REGIONS,
  PUBLIC_TIER_ORDER,
  getBrowserApiUrl,
  pickInitialInterval,
  type BillingInterval,
  type DonorFacingProvider,
  type PublicIntent,
  type TierId,
} from '@bloomoulu/constants';
import { adoptAction, adoptBundleAction } from './actions';
import { useCart, type CartItem } from '../../../lib/cart.client';

// ─── Types ────────────────────────────────────────────────────────────────
export type AdoptIntent = PublicIntent;
export type AdoptProvider = DonorFacingProvider;

/** Admin-editable adopt-wizard knobs, fetched from /v1/settings/public. */
export interface AdoptSettings {
  giftWrapCents: number;
  donationShareBp: number;
  plaqueEligibleTiers: Array<'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate'>;
  dedicationMaxChars: number;
  coAdopterMax: number;
  fundsFlowUrl: string;
  /** Whitelist of billing intervals donors see. Production default is
   *  ['monthly','one_time']; admin enables 'annual' in /admin →
   *  SystemSetting → adoption.intervalsEnabled. */
  intervalsEnabled: Array<'monthly' | 'annual' | 'one_time'>;
}

/** A perk entry from the admin-editable Tier.perks JSON. Either a short
 *  key from the built-in vocabulary (mapped to localised strings below)
 *  or an object with inline locale labels — admins can add new perks
 *  without touching the code dictionary. */
export type PerkEntry =
  | string
  | {
      labelKey?: string;
      label?: string;
      labelEn?: string;
      labelFi?: string;
      labelSv?: string;
    };

export interface AdoptTier {
  id: 'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate';
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
  monthlyPriceCents?: number | null;
  blurbEn: string;
  blurbFi: string;
  blurbSv: string;
  perks: PerkEntry[] | null;
  color: string;
  bg: string;
  tagEn?: string | null;
  tagFi?: string | null;
  tagSv?: string | null;
  sortOrder?: number;
}

export interface AdoptPlant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  bloomSeason?: string;
  bloomWindow?: string | null;
  adopterCount?: number;
  fundedCents?: number;
  targetCents?: number;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
  taxon?: { latinName: string; family?: string } | null;
}

interface CoAdopter {
  name: string;
  email: string;
}

const ACCENT_PALETTE = ['#E8EEDE', '#F1E6CB', '#F0DCD0', '#D6EBE3'];
const TIER_ORDER = PUBLIC_TIER_ORDER;

const PERK_LABELS_EN: Record<string, string> = {
  nickname_your_plant: 'Nickname your plant',
  i_at_h_home_region_plant: 'I@H · plant from your home region',
  i_at_h_postcard: "I@H postcard from plant's region",
  digital_certificate: 'Digital certificate & story page',
  quarterly_growers_notes: "Quarterly grower's notes",
  printed_certificate_mailed: 'Printed certificate · mailed',
  seasonal_photos_your_plant: 'Seasonal photos of YOUR plant',
  adopters_open_day_invite: "Adopters' Open Day invite",
  signed_botanical_art: 'Signed botanical art print',
  themed_garden_walk: 'Themed garden walk · 1 admission',
  adopters_open_day_plus_one: "Adopters' Open Day + 1 guest",
  donor_wall_listing: 'Donor-wall listing',
  shared_plaque: "Name on shared adopters' plaque",
  limited_edition_art_print: 'Limited-edition signed art print',
  curated_botany_book: 'Curated botany book',
  donor_dinner_seed_bank_visit: 'Donor dinner + seed-bank visit',
  plaque_next_to_your_plant: 'Plaque next to YOUR plant',
  annual_seed_packet: 'Annual seed packet',
  logo_on_greenhouse_signage: 'Logo on greenhouse signage',
  csr_impact_report: 'CSR-ready impact report',
  private_event_slot_20_guests: 'Private event slot · 20 guests',
};

const PERK_LABELS_FI: Record<string, string> = {
  nickname_your_plant: 'Anna kasville lempinimi',
  i_at_h_home_region_plant: 'I@H · kasvi kotiseudultasi',
  i_at_h_postcard: 'I@H-postikortti kasvin alueelta',
  digital_certificate: 'Digitaalinen sertifikaatti & tarinasivu',
  quarterly_growers_notes: 'Neljännesvuosittaiset päivitykset',
  printed_certificate_mailed: 'Painettu sertifikaatti · postitettu',
  seasonal_photos_your_plant: 'Kausittaiset valokuvat juuri sinun kasvistasi',
  adopters_open_day_invite: 'Adoptoijien avoin päivä',
  signed_botanical_art: 'Allekirjoitettu kasvitaide',
  themed_garden_walk: 'Teemakierros · 1 sisäänpääsy',
  adopters_open_day_plus_one: 'Adoptoijien avoin päivä + 1 vieras',
  donor_wall_listing: 'Lahjoittajaseinä',
  shared_plaque: 'Nimi yhteislaatassa',
  limited_edition_art_print: 'Rajoitettu painos allekirjoitettua taidetta',
  curated_botany_book: 'Kuratoitu kasvitieteen kirja',
  donor_dinner_seed_bank_visit: 'Lahjoittajien illallinen + siemenpankki',
  plaque_next_to_your_plant: 'Laatta juuri sinun kasvisi viereen',
  annual_seed_packet: 'Vuosittainen siemenpaketti',
  logo_on_greenhouse_signage: 'Logo kasvihuoneiden opasteissa',
  csr_impact_report: 'CSR-vaikuttavuusraportti',
  private_event_slot_20_guests: 'Yksityinen tapahtuma · 20 vierasta',
};

const PERK_LABELS_SV: Record<string, string> = {
  nickname_your_plant: 'Ge din växt ett smeknamn',
  i_at_h_home_region_plant: 'I@H · växt från din hembygd',
  i_at_h_postcard: 'I@H-vykort från växtens region',
  digital_certificate: 'Digitalt diplom & berättelsesida',
  quarterly_growers_notes: 'Kvartalsvisa odlaranteckningar',
  printed_certificate_mailed: 'Tryckt diplom · postat',
  seasonal_photos_your_plant: 'Säsongsbilder av just din växt',
  adopters_open_day_invite: 'Inbjudan till Adoptanternas dag',
  signed_botanical_art: 'Signerad botanisk konst',
  themed_garden_walk: 'Temarundvandring · 1 inträde',
  adopters_open_day_plus_one: 'Adoptanternas dag + 1 gäst',
  donor_wall_listing: 'Donatorvägg',
  shared_plaque: 'Namn på gemensam plakett',
  limited_edition_art_print: 'Limiterad utgåva signerat tryck',
  curated_botany_book: 'Kurerad botanikbok',
  donor_dinner_seed_bank_visit: 'Donatormiddag + fröbanksbesök',
  plaque_next_to_your_plant: 'Plakett bredvid din växt',
  annual_seed_packet: 'Årligt fröpaket',
  logo_on_greenhouse_signage: 'Logo på växthusskyltar',
  csr_impact_report: 'CSR-effektrapport',
  private_event_slot_20_guests: 'Privat evenemang · 20 gäster',
};

function pickPerkLabel(perk: PerkEntry, locale: string): string {
  // 1. Inline locale label wins — lets admins add new perks from /admin
  //    without touching the code dictionary.
  if (typeof perk === 'object' && perk !== null) {
    if (locale === 'fi' && perk.labelFi) return perk.labelFi;
    if (locale === 'sv' && perk.labelSv) return perk.labelSv;
    if (perk.labelEn) return perk.labelEn;
    if (perk.label) return perk.label;
  }
  // 2. Falls back to the built-in key vocabulary in this file.
  const key = typeof perk === 'string' ? perk : perk.labelKey ?? '';
  const dict = locale === 'fi' ? PERK_LABELS_FI : locale === 'sv' ? PERK_LABELS_SV : PERK_LABELS_EN;
  return dict[key] ?? key;
}

function tierName(t: AdoptTier, locale: string): string {
  if (locale === 'fi') return t.nameFi || t.name;
  if (locale === 'sv') return t.nameSv || t.name;
  return t.name;
}
function tierBlurb(t: AdoptTier, locale: string): string {
  if (locale === 'fi') return t.blurbFi || t.blurbEn;
  if (locale === 'sv') return t.blurbSv || t.blurbEn;
  return t.blurbEn;
}
function tierTag(t: AdoptTier, locale: string): string | null {
  if (locale === 'fi') return t.tagFi ?? t.tagEn ?? null;
  if (locale === 'sv') return t.tagSv ?? t.tagEn ?? null;
  return t.tagEn ?? null;
}
function plantName(p: AdoptPlant, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}
function plantAccent(id: string): string {
  const key = id.replace(/-/g, '').slice(-1);
  return ACCENT_PALETTE[Number.parseInt(key || '0', 16) % ACCENT_PALETTE.length] ?? '#E8EEDE';
}
function plantFundedPct(p: AdoptPlant): number {
  if (!p.targetCents || p.targetCents <= 0) {
    const adopters = p.adopterCount ?? 0;
    return Math.min(100, adopters * 4);
  }
  return Math.min(100, Math.round(((p.fundedCents ?? 0) / p.targetCents) * 100));
}

function euros(cents: number, locale: string): string {
  return (cents / 100).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// HOME_REGIONS is imported from @bloomoulu/constants — codes map to i18n
// keys "region<CODE>" in packages/i18n/messages/*.json. Step 3's I@H
// select consumes them via t(`region${code}`).

// ─── Component ────────────────────────────────────────────────────────────
interface AdoptWizardProps {
  locale: string;
  tiers: AdoptTier[];
  plants: AdoptPlant[];
  presetPlantSlug: string | null;
  presetTier: AdoptTier['id'];
  presetIntent: AdoptIntent;
  /** Optional billing interval forwarded from a plant-detail "Adopt" CTA so
   *  the donor doesn't have to re-pick on step 1. Null = use the wizard's
   *  own first-enabled default. */
  presetInterval?: 'monthly' | 'annual' | 'one_time' | null;
  /** Cart mode: render the wizard as the canonical multi-plant checkout
   *  instead of single-plant. When true the wizard reads items from the
   *  localStorage cart, replaces step 2 with a basket review, and submits
   *  to /v1/adoptions/bundle instead of /v1/adoptions. */
  cartMode?: boolean;
  /** Browser-facing API base URL — only used in cart mode to look up
   *  plants that aren't in the prefetched `plants` index. */
  apiUrl?: string;
  title: string;
  /** Enabled payment rails from /v1/settings/public. Bank transfer is omitted
   *  from the UI by design — Paytrail + MobilePay are the donor-facing rails. */
  enabledProviders: AdoptProvider[];
  /** Admin-editable knobs from SystemSetting. */
  adopt: AdoptSettings;
}

export function AdoptWizard({
  locale,
  tiers,
  plants,
  presetPlantSlug,
  presetTier,
  presetIntent,
  presetInterval,
  cartMode = false,
  apiUrl,
  title,
  enabledProviders,
  adopt,
}: AdoptWizardProps) {
  const t = useTranslations('Adopt');
  // When the donor arrived from a plant-detail page's "Adopt this plant"
  // button (presetPlantSlug is set), skip the tier+pick steps and drop
  // them straight into the personalise step. They picked already.
  // In cart mode, the items are already picked too — same fast-forward.
  // Otherwise start at step 1 (tier).
  // Donor entry → starting step.
  //   cartMode (entered via /cart/checkout): items are already chosen on
  //     prior plant pages — jump to step 3 personalise.
  //   presetPlantSlug (entered via /adopt?plant=X from a plant detail
  //     page): start at step 1 so the donor sees the full tier cards
  //     with perks + the corporate strip + the multi-plant picker in
  //     step 2 — identical options to a direct /adopt visitor. The
  //     plant + tier + interval are pre-filled, so step 1 + step 2 are
  //     two "Continue" clicks if the donor doesn't want to change
  //     anything.
  //   fresh /adopt: start at step 1.
  const initialStep = cartMode ? 3 : 1;
  const [step, setStep] = useState(initialStep);

  // ─── Cart-mode plant lookup ───────────────────────────────────────────
  // `plants` is the small index of popular plants pre-fetched server-side.
  // When the cart contains slugs that aren't in that index (donor walked
  // through niche species), we need to fetch their metadata client-side
  // so SummaryCard + the basket review render with proper names + images.
  const cartHook = useCart();
  const [cartPlants, setCartPlants] = useState<Record<string, AdoptPlant>>({});
  const cartItems = cartMode ? cartHook.cart.items : [];
  const cartReady = !cartMode || cartHook.hydrated;
  useEffect(() => {
    if (!cartMode || !cartHook.hydrated) return;
    const missing = cartHook.cart.items
      .map((i) => i.plantSlug)
      .filter((slug) => !plants.some((p) => p.slug === slug) && !cartPlants[slug]);
    if (missing.length === 0) return;
    let cancelled = false;
    const base = (apiUrl ?? '').replace(/\/$/, '');
    (async () => {
      const fetched = await Promise.all(
        missing.map(async (slug) => {
          try {
            const url = base ? `${base}/v1/plants/${encodeURIComponent(slug)}` : `/v1/plants/${encodeURIComponent(slug)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = (await res.json()) as AdoptPlant;
            return { slug, plant: data };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setCartPlants((prev) => {
        const next = { ...prev };
        for (const f of fetched) {
          if (f) next[f.slug] = f.plant;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [cartMode, cartHook.hydrated, cartHook.cart.items, plants, cartPlants, apiUrl]);
  const lookupPlant = (slug: string): AdoptPlant | null =>
    plants.find((p) => p.slug === slug) ?? cartPlants[slug] ?? null;

  // Tier + billing
  const orderedTiers = useMemo(
    () => tiers.filter((tt) => tt.id !== 'corporate').sort((a, b) => TIER_ORDER.indexOf(a.id) - TIER_ORDER.indexOf(b.id)),
    [tiers],
  );
  const corporateTier = useMemo(() => tiers.find((tt) => tt.id === 'corporate') ?? null, [tiers]);
  const [tierId, setTierId] = useState<AdoptTier['id']>(presetTier);
  // Single source of truth: one of three billing intervals, matching
  // /cart/checkout exactly. `recurring` is derived for the api payload.
  // Admin-controlled allow-list. The first enabled interval is the
  // initial selection, so disabling annual (the production default) lands
  // donors on monthly.
  const enabledIntervals = adopt.intervalsEnabled ?? ['monthly', 'one_time'];
  // Initial-interval policy lives in @bloomoulu/constants/billing — every
  // surface (wizard, plant page, cart checkout) defers to pickInitialInterval
  // so changing the default is a one-place edit.
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(
    pickInitialInterval(presetInterval ?? null, enabledIntervals),
  );
  const recurring = billingInterval !== 'one_time';
  const setRecurring = (next: boolean) => {
    if (next) {
      setBillingInterval(enabledIntervals.includes('monthly') ? 'monthly' : (enabledIntervals[0] ?? 'monthly'));
    } else {
      setBillingInterval(enabledIntervals.includes('one_time') ? 'one_time' : (enabledIntervals[0] ?? 'one_time'));
    }
  };

  // Picked items — the canonical "what am I adopting" state. Always an
  // array of 1+ items (or empty before the donor picks anything). Single-
  // plant entry seeds it from URL preset; cart entry seeds from
  // localStorage; fresh entry starts empty and the donor builds the
  // basket in step 2.
  interface PickedItem {
    plantSlug: string;
    tierId: AdoptTier['id'];
  }
  const initialPicked: PickedItem[] = (() => {
    if (cartMode) return []; // hydrated from useEffect below
    if (presetPlantSlug) return [{ plantSlug: presetPlantSlug, tierId: presetTier }];
    return [];
  })();
  const [pickedItems, setPickedItems] = useState<PickedItem[]>(initialPicked);
  // Sync cart-mode pickedItems FROM localStorage on hydration.
  useEffect(() => {
    if (!cartMode || !cartHook.hydrated) return;
    setPickedItems(
      cartHook.cart.items.map((it) => ({ plantSlug: it.plantSlug, tierId: it.tierId as AdoptTier['id'] })),
    );
  }, [cartMode, cartHook.hydrated, cartHook.cart.items]);
  // Helpers — mutate pickedItems in-session; also persist to localStorage
  // when we're in cart mode so the basket survives navigation.
  const addPick = (slug: string, tier: AdoptTier['id']) => {
    setPickedItems((prev) => {
      if (prev.some((it) => it.plantSlug === slug)) return prev; // dedupe
      return [...prev, { plantSlug: slug, tierId: tier }];
    });
    if (cartMode) cartHook.add(slug, tier as CartItem['tierId']);
  };
  const removePick = (slug: string) => {
    setPickedItems((prev) => prev.filter((it) => it.plantSlug !== slug));
    if (cartMode) cartHook.remove(slug);
  };
  const togglePick = (slug: string, tier: AdoptTier['id']) => {
    if (pickedItems.some((it) => it.plantSlug === slug)) removePick(slug);
    else addPick(slug, tier);
  };
  const setItemTier = (slug: string, newTier: AdoptTier['id']) => {
    setPickedItems((prev) => prev.map((it) => (it.plantSlug === slug ? { ...it, tierId: newTier } : it)));
    if (cartMode) cartHook.setTier(slug, newTier as CartItem['tierId']);
  };

  // Compatibility shims for code that used the old single-plant state.
  // The first picked item is treated as the "primary" plant for displays
  // that still render a single-card layout (entry from a plant page with
  // count === 1).
  const plantSlug = pickedItems[0]?.plantSlug ?? presetPlantSlug ?? plants[0]?.slug ?? '';

  // Picked-item summary used by SummaryCard — built from pickedItems
  // joined with the in-memory plant + tier indexes. Defined only when
  // there are 2+ items so SummaryCard switches to multi-item layout;
  // length-1 baskets keep the classic single-card layout.
  const itemSummaries = useMemo<CartItemSummary[] | undefined>(() => {
    if (pickedItems.length < 2) return undefined;
    return pickedItems.map((it) => ({
      plantSlug: it.plantSlug,
      tierId: it.tierId,
      plant: lookupPlant(it.plantSlug),
      tier: tiers.find((tt) => tt.id === it.tierId) ?? null,
    }));
  }, [pickedItems, tiers, cartPlants, plants]);
  // Step 2 always wants a full per-item summary so the basket section
  // renders even with a single picked item (the donor needs to see what
  // they've picked vs. the picker grid below).
  const allPickedSummaries = useMemo<CartItemSummary[]>(
    () =>
      pickedItems.map((it) => ({
        plantSlug: it.plantSlug,
        tierId: it.tierId,
        plant: lookupPlant(it.plantSlug),
        tier: tiers.find((tt) => tt.id === it.tierId) ?? null,
      })),
    [pickedItems, tiers, cartPlants, plants],
  );

  // Personalise
  const [intent, setIntent] = useState<AdoptIntent>(presetIntent);
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [dedication, setDedication] = useState('');
  const [homeRegion, setHomeRegion] = useState<string>('');
  const [giftRecipientName, setGiftRecipientName] = useState('');
  const [giftRecipientEmail, setGiftRecipientEmail] = useState('');
  const [giftDeliverOn, setGiftDeliverOn] = useState('');
  const [giftAnonymous, setGiftAnonymous] = useState(false);
  const [giftWrap, setGiftWrap] = useState(true);
  const [memorialOf, setMemorialOf] = useState('');
  const [memorialFamilyEmail, setMemorialFamilyEmail] = useState('');
  const [coAdopters, setCoAdopters] = useState<CoAdopter[]>([]);

  // Payment — default to the first enabled provider. MobilePay is preferred
  // for recurring; Paytrail wins otherwise. If no provider is enabled
  // server-side we still keep a sane default so the UI doesn't break.
  const defaultProvider: AdoptProvider =
    enabledProviders.find((p) => (recurring ? p === 'mobilepay' : p === 'paytrail')) ??
    enabledProviders[0] ??
    'paytrail';
  const [paymentMethod, setPaymentMethod] = useState<AdoptProvider>(defaultProvider);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useTransitionState();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The "primary" tier (selectedTier) and "primary" plant (selectedPlant)
  // drive the single-card SummaryCard layout for length-1 baskets. For
  // length >= 2 baskets, SummaryCard switches to the multi-item view and
  // these values are only used as a visual fallback.
  const primaryTierId = pickedItems[0]?.tierId ?? tierId;
  const selectedTier = useMemo(
    () => tiers.find((tt) => tt.id === primaryTierId) ?? orderedTiers[0] ?? null,
    [tiers, primaryTierId, orderedTiers],
  );
  const selectedPlant = useMemo(() => {
    if (pickedItems.length > 0) {
      return lookupPlant(pickedItems[0]!.plantSlug) ?? plants[0] ?? null;
    }
    return plants[0] ?? null;
  }, [plants, pickedItems, cartPlants]);

  const priceForTier = (id: AdoptTier['id']): number => {
    const tier = tiers.find((tt) => tt.id === id);
    if (!tier) return 0;
    if (billingInterval === 'monthly' && tier.monthlyPriceCents) return tier.monthlyPriceCents;
    return tier.annualPriceCents;
  };

  // Pricing always sums over every picked item — single-plant entry is
  // simply a 1-item basket. Gift-wrap is a single bundle-wide add-on
  // (one parcel), folded in only when intent=gift, matching the
  // server-side calc.
  const baseCents = useMemo(() => {
    if (pickedItems.length === 0) {
      // Empty basket — preview the default tier price from step 1.
      if (!selectedTier) return 0;
      if (billingInterval === 'monthly' && selectedTier.monthlyPriceCents) return selectedTier.monthlyPriceCents;
      return selectedTier.annualPriceCents;
    }
    return pickedItems.reduce((sum, it) => sum + priceForTier(it.tierId), 0);
  }, [selectedTier, billingInterval, pickedItems, tiers]);
  // Gift-wrap add-on price comes from admin settings (admin.adoption.giftWrapCents).
  const wrapAddOnCents = intent === 'gift' && giftWrap ? adopt.giftWrapCents : 0;
  const totalCents = baseCents + wrapAddOnCents;
  const recurringSuffix =
    billingInterval === 'monthly' && selectedTier?.monthlyPriceCents
      ? (locale === 'fi' ? '/kk' : locale === 'sv' ? '/mån' : '/mo')
    : billingInterval === 'one_time'
      ? ''
    : (locale === 'fi' ? '/vuosi' : locale === 'sv' ? '/år' : '/yr');

  // ─── Helpers ───────────────────────────────────────────────────────────
  const goNext = () => setStep((s) => Math.min(4, s + 1));
  const goPrev = () => setStep((s) => Math.max(1, s - 1));
  const canContinueFromPersonalise = (() => {
    if (!donorEmail || !donorEmail.includes('@')) return false;
    if (intent === 'gift' && (!giftRecipientEmail || !giftRecipientEmail.includes('@'))) return false;
    if (intent === 'memorial' && !memorialOf.trim()) return false;
    return true;
  })();

  const submit = () => {
    if (!donorEmail) return;
    setSubmitting(true);
    setErrorMessage(null);
    const fd = new FormData();
    // Shared fields — identical between single and bundle endpoints so
    // the wizard collects them once.
    fd.set('intent', intent);
    fd.set('recurring', String(recurring));
    fd.set('billingInterval', billingInterval);
    fd.set('locale', locale);
    fd.set('email', donorEmail);
    if (donorName) fd.set('name', donorName);
    if (dedication) fd.set('dedication', dedication);
    if (homeRegion) fd.set('homeRegion', homeRegion);
    if (intent === 'gift') {
      if (giftRecipientName) fd.set('giftRecipientName', giftRecipientName);
      fd.set('giftRecipientEmail', giftRecipientEmail);
      if (giftDeliverOn) fd.set('giftDeliverOn', giftDeliverOn);
      fd.set('giftAnonymous', String(giftAnonymous));
      fd.set('giftWrap', String(giftWrap));
    }
    if (intent === 'memorial') {
      fd.set('memorialOf', memorialOf);
      if (memorialFamilyEmail) fd.set('memorialFamilyEmail', memorialFamilyEmail);
    }
    const co = coAdopters.filter((c) => c.name || c.email);
    if (co.length > 0) fd.set('coAdopters', JSON.stringify(co));
    fd.set('marketingOptIn', String(marketingOptIn));
    fd.set('preferredProvider', paymentMethod);

    // Route on count, not entry mode. Single-plant adoption (whether the
    // donor came from a plant page or built a 1-item basket fresh) hits
    // /v1/adoptions; any 2+ item basket hits /v1/adoptions/bundle. The
    // backend supports the same field set on both, so the donor sees
    // identical receipts regardless of count.
    if (pickedItems.length === 0) {
      setSubmitting(false);
      setErrorMessage(t('errorTitle'));
      return;
    }
    if (pickedItems.length === 1) {
      const only = pickedItems[0]!;
      fd.set('plantSlug', only.plantSlug);
      fd.set('tierId', only.tierId);
      void adoptAction(fd).catch((err: Error) => {
        setSubmitting(false);
        setErrorMessage(err?.message ?? t('errorTitle'));
      });
      return;
    }
    fd.set(
      'items',
      JSON.stringify(pickedItems.map((it) => ({ plantSlug: it.plantSlug, tierId: it.tierId }))),
    );
    void adoptBundleAction(fd).catch((err: Error) => {
      setSubmitting(false);
      setErrorMessage(err?.message ?? t('errorTitle'));
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────
  const stepLabels: Array<{ key: string; label: string }> = [
    { key: 'tier', label: t('stepTier') },
    { key: 'plant', label: t('stepPlant') },
    { key: 'personalise', label: t('stepPersonalise') },
    { key: 'pay', label: t('stepPay') },
  ];

  // Cart mode with an empty basket → show the empty state instead of the
  // wizard. The donor came here from /cart/checkout but their cart is
  // empty (cleared in another tab, expired storage, etc.).
  if (cartMode && cartReady && cartItems.length === 0) {
    return (
      <section className="container" style={{ padding: '64px 24px', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
        <h1 className="serif" style={{ fontSize: 28, color: 'var(--forest)' }}>
          {locale === 'fi'
            ? 'Korisi on tyhjä'
            : locale === 'sv'
              ? 'Din korg är tom'
              : 'Your cart is empty'}
        </h1>
        <p className="muted" style={{ marginTop: 12, maxWidth: 480, marginInline: 'auto' }}>
          {locale === 'fi'
            ? 'Selaa kasveja ja paina "Adoptoi tämä kasvi" tai "Lisää koriin" jokaisella sivulla.'
            : locale === 'sv'
              ? 'Bläddra bland växterna och tryck "Adoptera denna växt" eller "Lägg i korg" på var och en.'
              : 'Browse the collection and press "Adopt this plant" or "Add to cart" on each plant you want.'}
        </p>
        <Link href={`/${locale}/plants`} className="btn btn-primary btn-lg" style={{ marginTop: 24, display: 'inline-flex' }}>
          {locale === 'fi' ? 'Selaa kasveja →' : locale === 'sv' ? 'Bläddra växter →' : 'Browse plants →'}
        </Link>
      </section>
    );
  }
  // Cart mode but localStorage hasn't hydrated yet — render a minimal
  // placeholder so we don't flash an empty state to a logged-in donor
  // whose cart is non-empty.
  if (cartMode && !cartReady) {
    return (
      <section className="container" style={{ padding: '64px 24px', textAlign: 'center' }}>
        <p className="muted">Loading basket…</p>
      </section>
    );
  }

  return (
    <>
      <div
        style={{
          background: 'var(--paper)',
          borderBottom: '1px solid var(--line)',
          position: 'sticky',
          top: 64,
          zIndex: 30,
        }}
      >
        <div
          className="container"
          style={{ padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 24 }}
        >
          <button
            type="button"
            className="btn btn-ghost small"
            onClick={() => (step > 1 ? goPrev() : window.history.back())}
            aria-label={step === 1 ? t('backToGarden') : t('previous')}
            style={{ padding: '6px 12px', fontSize: "0.867rem" }}
          >
            ← {step === 1 ? t('backToGarden') : t('previous')}
          </button>
          <ol
            style={{
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              flex: 1,
              justifyContent: 'center',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
            aria-label="Adopt steps"
          >
            {stepLabels.map(({ key, label }, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              return (
                <li
                  key={key}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: done
                        ? 'var(--forest)'
                        : active
                          ? 'var(--rust-on-light)'
                          : 'rgba(31,58,44,0.08)',
                      color: done || active ? 'var(--paper)' : 'var(--ink-mute)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: "0.733rem",
                      fontWeight: 600,
                    }}
                  >
                    {done ? '✓' : n}
                  </span>
                  <span
                    className="small"
                    style={{
                      color: active ? 'var(--ink)' : 'var(--ink-mute)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {label}
                  </span>
                  {n < stepLabels.length && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 32,
                        height: 1,
                        background: 'var(--line)',
                        marginLeft: 4,
                        marginRight: 4,
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ol>
          <span style={{ width: 100 }} />
        </div>
      </div>

      <div className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <h1 id="adopt-title" className="sr-only">
          {title}
        </h1>

        {step === 1 && selectedTier && (
          <Step1ChooseTier
            locale={locale}
            tiers={orderedTiers}
            corporate={corporateTier}
            tierId={tierId}
            setTierId={setTierId}
            recurring={recurring}
            setRecurring={setRecurring}
            billingInterval={billingInterval}
            setBillingInterval={setBillingInterval}
            enabledIntervals={enabledIntervals}
            selectedTier={selectedTier}
            totalCents={totalCents}
            baseCents={baseCents}
            onNext={goNext}
          />
        )}

        {step === 2 && selectedTier && (
          <Step2PickPlant
            locale={locale}
            plants={plants}
            pickedItems={pickedItems}
            togglePick={(slug) => togglePick(slug, primaryTierId)}
            setItemTier={setItemTier}
            removePick={removePick}
            defaultTierId={primaryTierId}
            selectedTier={selectedTier}
            tiers={tiers}
            billingInterval={billingInterval}
            totalCents={totalCents}
            recurringSuffix={recurringSuffix}
            allPickedSummaries={allPickedSummaries}
            onNext={goNext}
          />
        )}

        {step === 3 && selectedTier && selectedPlant && (
          <Step3Personalise
            locale={locale}
            plant={selectedPlant}
            tier={selectedTier}
            intent={intent}
            setIntent={setIntent}
            donorName={donorName}
            setDonorName={setDonorName}
            donorEmail={donorEmail}
            setDonorEmail={setDonorEmail}
            dedication={dedication}
            setDedication={setDedication}
            homeRegion={homeRegion}
            setHomeRegion={setHomeRegion}
            giftRecipientName={giftRecipientName}
            setGiftRecipientName={setGiftRecipientName}
            giftRecipientEmail={giftRecipientEmail}
            setGiftRecipientEmail={setGiftRecipientEmail}
            giftDeliverOn={giftDeliverOn}
            setGiftDeliverOn={setGiftDeliverOn}
            giftAnonymous={giftAnonymous}
            setGiftAnonymous={setGiftAnonymous}
            giftWrap={giftWrap}
            setGiftWrap={setGiftWrap}
            memorialOf={memorialOf}
            setMemorialOf={setMemorialOf}
            memorialFamilyEmail={memorialFamilyEmail}
            setMemorialFamilyEmail={setMemorialFamilyEmail}
            coAdopters={coAdopters}
            setCoAdopters={setCoAdopters}
            recurring={recurring}
            billingInterval={billingInterval}
            totalCents={totalCents}
            canContinue={canContinueFromPersonalise}
            onNext={goNext}
            adopt={adopt}
            cartItems={itemSummaries}
            onChangeCartTier={itemSummaries ? setItemTier : undefined}
            onRemoveCartItem={itemSummaries ? removePick : undefined}
            allTiers={itemSummaries ? tiers : undefined}
            onAddMore={() => setStep(2)}
          />
        )}

        {step === 4 && selectedTier && selectedPlant && (
          <Step4Pay
            locale={locale}
            plant={selectedPlant}
            tier={selectedTier}
            intent={intent}
            recurring={recurring}
            billingInterval={billingInterval}
            dedication={dedication}
            giftWrap={giftWrap}
            totalCents={totalCents}
            baseCents={baseCents}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            marketingOptIn={marketingOptIn}
            setMarketingOptIn={setMarketingOptIn}
            submitting={submitting}
            adopt={adopt}
            enabledProviders={enabledProviders}
            errorMessage={errorMessage}
            onSubmit={submit}
            cartItems={itemSummaries}
            allTiers={itemSummaries ? tiers : undefined}
          />
        )}
      </div>
    </>
  );
}

// Local hook around useTransition so submit-state is straightforward.
function useTransitionState(): [boolean, (b: boolean) => void] {
  const [pending, start] = useTransition();
  const [flag, setFlag] = useState(false);
  const set = (b: boolean) => {
    if (b) start(() => setFlag(true));
    else setFlag(false);
  };
  return [pending || flag, set];
}

// ─── Step 1 ───────────────────────────────────────────────────────────────
interface Step1Props {
  locale: string;
  tiers: AdoptTier[];
  corporate: AdoptTier | null;
  tierId: AdoptTier['id'];
  setTierId: (id: AdoptTier['id']) => void;
  recurring: boolean;
  setRecurring: (b: boolean) => void;
  billingInterval: 'monthly' | 'annual' | 'one_time';
  setBillingInterval: (v: 'monthly' | 'annual' | 'one_time') => void;
  enabledIntervals: Array<'monthly' | 'annual' | 'one_time'>;
  // `setRecurring` is kept on the props so legacy passthroughs compile.
  // The Step1 component itself uses `setBillingInterval`.
  selectedTier: AdoptTier;
  totalCents: number;
  baseCents: number;
  onNext: () => void;
}

function Step1ChooseTier({
  locale,
  tiers,
  corporate,
  tierId,
  setTierId,
  recurring,
  billingInterval,
  setBillingInterval,
  enabledIntervals,
  selectedTier,
  totalCents,
  onNext,
}: Step1Props) {
  const t = useTranslations('Adopt');
  return (
    <section className="fade-in" aria-labelledby="step1-title">
      <header style={{ marginBottom: 40 }}>
        <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
          {t('step1of4')}
        </div>
        <h2 id="step1-title" style={{ fontSize: 'clamp(2.667rem, 6vw, 3.733rem)', marginTop: 12 }}>
          {t('chooseTier')}
        </h2>
      </header>

      <div
        role="radiogroup"
        aria-label={t('billing')}
        style={{
          display: 'inline-flex',
          padding: 4,
          background: 'var(--paper)',
          borderRadius: 999,
          marginBottom: 28,
          border: '1px solid var(--line)',
        }}
      >
        {BILLING_INTERVAL_DISPLAY_ORDER
          .filter((id) => enabledIntervals.includes(id))
          .map((id) => {
            const label =
              id === 'monthly'
                ? locale === 'fi' ? 'Kuukausi' : locale === 'sv' ? 'Månad' : 'Monthly'
                : id === 'annual'
                  ? locale === 'fi' ? 'Vuosi' : locale === 'sv' ? 'År' : 'Annual'
                  : locale === 'fi' ? 'Kerran' : locale === 'sv' ? 'Engång' : 'One-time';
            const opt = { id, label };
          const active = billingInterval === opt.id;
          return (
            <button
              type="button"
              key={opt.id}
              role="radio"
              aria-checked={active}
              onClick={() => setBillingInterval(opt.id)}
              className="pill"
              style={{
                padding: '8px 18px',
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--forest)' : 'transparent',
                color: active ? 'var(--cream)' : 'var(--ink-soft)',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div
        data-grid-mobile="2"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}
      >
        {tiers.map((tier) => {
          const cents = recurring && tier.monthlyPriceCents ? tier.monthlyPriceCents : tier.annualPriceCents;
          const isSelected = tier.id === tierId;
          const tag = tierTag(tier, locale);
          const perks = (Array.isArray(tier.perks) ? tier.perks : []) as PerkEntry[];
          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => setTierId(tier.id)}
              aria-pressed={isSelected}
              className="card"
              style={{
                padding: 0,
                textAlign: 'left',
                border: isSelected ? `2px solid ${tier.color}` : '1px solid var(--line)',
                overflow: 'hidden',
                transition: 'transform 200ms, box-shadow 200ms',
                transform: isSelected ? 'translateY(-4px)' : 'none',
                boxShadow: isSelected ? 'var(--shadow-mid)' : 'var(--shadow-soft)',
                cursor: 'pointer',
              }}
            >
              <div style={{ padding: '20px 24px 24px', background: tier.bg, position: 'relative' }}>
                {tag && (
                  <div
                    className="badge"
                    style={{
                      background: 'rgba(255,255,255,0.7)',
                      color: 'var(--ink-soft)',
                      position: 'absolute',
                      top: 16,
                      right: 16,
                      fontSize: "0.667rem",
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {tag}
                  </div>
                )}
                <div
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: tier.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    marginBottom: 20,
                    fontSize: "1.2rem",
                  }}
                >
                  🌱
                </div>
                <div className="tiny">{tier.nameFi}</div>
                <div className="serif" style={{ fontSize: "1.867rem", marginTop: 4 }}>
                  {tierName(tier, locale)}
                </div>
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="serif" style={{ fontSize: "2.933rem" }}>
                    €{euros(cents, locale)}
                  </span>
                  <span className="muted small">
                    {recurring ? t('monthlyShort') : t('oneOffLabel')}
                  </span>
                </div>
                {recurring && tier.monthlyPriceCents && (
                  <div className="tiny" style={{ marginTop: 4 }}>
                    {t('perYear', { amount: euros(tier.monthlyPriceCents * 12, locale) })}
                  </div>
                )}
              </div>
              <div style={{ padding: 20 }}>
                <p className="small muted" style={{ marginBottom: 14, lineHeight: 1.5 }}>
                  {tierBlurb(tier, locale)}
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
                  {perks.map((p, i) => {
                    const label = pickPerkLabel(p, locale);
                    return (
                      <li
                        key={`${tier.id}-perk-${i}`}
                        style={{ display: 'flex', gap: 8, alignItems: 'start', fontSize: "0.867rem" }}
                      >
                        <span aria-hidden="true" style={{ color: tier.color, marginTop: 1 }}>
                          ✓
                        </span>
                        <span>{label}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </button>
          );
        })}
      </div>

      {corporate && (
        <div
          className="card"
          style={{
            marginTop: 32,
            padding: 0,
            overflow: 'hidden',
            background: 'var(--forest-deep)',
            color: 'var(--cream)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 0 }}>
            <div style={{ padding: 32 }}>
              <div className="tiny" style={{ color: 'var(--sage-bright)' }}>
                {t('corporateEyebrow')}
              </div>
              <h3 className="serif" style={{ fontSize: "2.133rem", marginTop: 8, color: 'var(--cream)' }}>
                {t('corporateTitle')}
              </h3>
              <p className="small" style={{ marginTop: 12, color: 'rgba(248,244,230,0.7)', lineHeight: 1.5 }}>
                {t('corporateBlurb')}
              </p>
            </div>
            <div style={{ padding: 24, borderLeft: '1px solid rgba(248,244,230,0.15)' }}>
              <div className="tiny" style={{ color: 'var(--sage-bright)' }}>
                {tierName(corporate, locale)}
              </div>
              <div className="serif" style={{ fontSize: "2.4rem", marginTop: 8, color: 'var(--cream)' }}>
                €{(corporate.annualPriceCents / 100).toLocaleString(locale)}
                <span style={{ fontSize: "0.933rem", color: 'rgba(248,244,230,0.6)' }}>/yr</span>
              </div>
              <p className="small" style={{ marginTop: 8, color: 'rgba(248,244,230,0.7)' }}>
                {t('corporateDeductible')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 18,
          padding: '12px 18px',
          background: 'rgba(168,192,96,0.10)',
          borderRadius: 12,
          fontSize: "0.867rem",
          lineHeight: 1.55,
          color: 'var(--ink-soft)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span aria-hidden="true" style={{ color: 'var(--forest)' }}>🌱</span>
        <span>{t('localPerks')}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 32 }}>
        <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
          {t('continueWithTier', {
            tier: tierName(selectedTier, locale),
            amount: euros(totalCents, locale),
            suffix: '',
          })}{' '}
          →
        </button>
      </div>
    </section>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────
interface Step2Props {
  locale: string;
  plants: AdoptPlant[];
  /** All currently-picked items. Step 2 toggles plants in/out of this set
   *  and lets the donor change per-item tier inline. */
  pickedItems: Array<{ plantSlug: string; tierId: AdoptTier['id'] }>;
  togglePick: (slug: string) => void;
  setItemTier: (slug: string, tierId: AdoptTier['id']) => void;
  removePick: (slug: string) => void;
  /** Tier applied when adding a new plant. Per-item dropdowns override. */
  defaultTierId: AdoptTier['id'];
  selectedTier: AdoptTier;
  /** Full tier catalogue used by per-item dropdowns. */
  tiers: AdoptTier[];
  billingInterval: 'monthly' | 'annual' | 'one_time';
  totalCents: number;
  recurringSuffix: string;
  /** Picked items joined with plant/tier metadata, for the basket view. */
  allPickedSummaries: CartItemSummary[];
  onNext: () => void;
}

function Step2PickPlant({
  locale,
  plants,
  pickedItems,
  togglePick,
  setItemTier,
  removePick,
  defaultTierId: _defaultTierId,
  selectedTier,
  tiers,
  billingInterval,
  totalCents,
  recurringSuffix,
  allPickedSummaries,
  onNext,
}: Step2Props) {
  const t = useTranslations('Adopt');
  const tPlants = useTranslations('Plants');

  // Live search + filter against the API. 7,954 plants is unusable as a
  // single grid, so we ship 16 prefetched by the server, plus a search
  // input that hits /v1/plants?q= as the user types.
  const [query, setQuery] = useState('');
  const [redListFilter, setRedListFilter] = useState<'' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC'>('');
  const [results, setResults] = useState<AdoptPlant[]>(plants);
  const [searching, setSearching] = useState(false);

  // Debounced server-side search.
  useEffect(() => {
    if (!query && !redListFilter) {
      setResults(plants);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ limit: '40' });
        if (query) params.set('q', query);
        if (redListFilter) params.set('redList', redListFilter);
        const res = await fetch(`${getBrowserApiUrl().replace(/\/$/, '')}/v1/plants?${params}`);
        if (res.ok) {
          const data = (await res.json()) as { items: AdoptPlant[] };
          setResults(data.items ?? []);
        }
      } catch {/* keep previous results */}
      finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, redListFilter, plants]);

  const visible = results;
  const pickedSlugs = new Set(pickedItems.map((it) => it.plantSlug));
  const headerHint =
    pickedItems.length === 0
      ? locale === 'fi'
        ? 'Valitse yksi tai useampi kasvi alta. Voit valita eri tason jokaiselle.'
        : locale === 'sv'
          ? 'Välj en eller flera växter nedan. Du kan välja olika nivåer per växt.'
          : 'Pick one or more plants below. You can choose different tiers per plant.'
      : pickedItems.length === 1
        ? locale === 'fi'
          ? '1 kasvi valittuna. Lisää useampi tai jatka.'
          : locale === 'sv'
            ? '1 växt vald. Lägg till fler eller fortsätt.'
            : '1 plant picked. Add more or continue.'
        : locale === 'fi'
          ? `${pickedItems.length} kasvia valittuna. Lisää tai jatka maksamiseen.`
          : locale === 'sv'
            ? `${pickedItems.length} växter valda. Lägg till fler eller fortsätt.`
            : `${pickedItems.length} plants picked. Add more or continue.`;

  return (
    <section className="fade-in" aria-labelledby="step2-title">
      <header
        style={{
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
            {t('step2of4')}
          </div>
          <h2 id="step2-title" style={{ fontSize: 'clamp(2.667rem, 6vw, 3.733rem)', marginTop: 12 }}>
            {locale === 'fi'
              ? 'Valitse kasvit'
              : locale === 'sv'
                ? 'Välj växter'
                : 'Pick your plants'}
          </h2>
          <p className="muted" style={{ marginTop: 12, maxWidth: 600 }}>
            {headerHint}
          </p>
        </div>
        <span className="pill">
          🌱 {t('tierPill', {
            tier: tierName(selectedTier, locale),
            amount: euros(totalCents, locale),
            suffix: recurringSuffix,
          })}
        </span>
      </header>

      {/* ── Basket (picked items) ─────────────────────────────────────────
          Always visible above the picker, so the donor knows exactly what
          they're carrying and can re-tier or remove without scrolling. */}
      {pickedItems.length > 0 && (
        <div
          style={{
            marginBottom: 24,
            padding: 16,
            background: 'var(--sage-pale)',
            border: '1px solid var(--forest-mid)',
            borderRadius: 14,
          }}
          aria-label={
            locale === 'fi' ? 'Valitut kasvit' : locale === 'sv' ? 'Valda växter' : 'Picked plants'
          }
        >
          <div
            className="tiny"
            style={{ textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--forest)' }}
          >
            {pickedItems.length}{' '}
            {pickedItems.length === 1
              ? locale === 'fi' ? 'kasvi valittu' : locale === 'sv' ? 'växt vald' : 'plant picked'
              : locale === 'fi' ? 'kasvia valittu' : locale === 'sv' ? 'växter valda' : 'plants picked'}
            {' · '}
            {locale === 'fi' ? 'kokonaishinta' : locale === 'sv' ? 'totalpris' : 'total'}: €{euros(totalCents, locale)}{recurringSuffix}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allPickedSummaries.map((it) => (
              <li
                key={it.plantSlug}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr auto auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 10px',
                  background: 'var(--cream)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: it.plant ? plantAccent(it.plant.id) : 'var(--sage-pale)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {it.plant?.primaryImage?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.plant.primaryImage.url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: "1.2rem" }}>🌿</span>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="serif"
                    style={{ fontSize: "1rem", fontStyle: 'italic', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {it.plant?.taxon?.latinName ?? it.plant?.nameEn ?? it.plantSlug}
                  </div>
                  {it.plant && (
                    <div className="tiny muted">{plantName(it.plant, locale)}</div>
                  )}
                </div>
                <select
                  value={it.tierId}
                  onChange={(e) => setItemTier(it.plantSlug, e.target.value as AdoptTier['id'])}
                  aria-label={`tier for ${it.plantSlug}`}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: 'var(--cream)',
                    fontSize: "0.867rem",
                  }}
                >
                  {tiers.map((tier) => {
                    const cents =
                      billingInterval === 'monthly' && tier.monthlyPriceCents
                        ? tier.monthlyPriceCents
                        : tier.annualPriceCents;
                    return (
                      <option key={tier.id} value={tier.id}>
                        {tierName(tier, locale)} · €{euros(cents, locale)}{recurringSuffix}
                      </option>
                    );
                  })}
                </select>
                <div className="small" style={{ fontFamily: 'ui-monospace, monospace', minWidth: 70, textAlign: 'right' }}>
                  €{euros(
                    billingInterval === 'monthly' && it.tier?.monthlyPriceCents
                      ? it.tier.monthlyPriceCents
                      : it.tier?.annualPriceCents ?? 0,
                    locale,
                  )}{recurringSuffix}
                </div>
                <button
                  type="button"
                  onClick={() => removePick(it.plantSlug)}
                  aria-label={`remove ${it.plantSlug}`}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    padding: '4px 8px',
                    cursor: 'pointer',
                    color: 'var(--rust-on-light)',
                    fontSize: "0.867rem",
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Search + Red-List filter ────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 24,
          padding: 12,
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 12,
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            locale === 'fi'
              ? 'Etsi nimellä tai latinaksi…'
              : locale === 'sv'
                ? 'Sök på namn eller latin…'
                : 'Search plants by name or Latin…'
          }
          aria-label={
            locale === 'fi' ? 'Etsi kasvi' : locale === 'sv' ? 'Sök växt' : 'Search for a plant'
          }
          style={{
            flex: '1 1 280px',
            minHeight: 44,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'var(--cream)',
            fontSize: 15,
            fontFamily: 'var(--f-body)',
          }}
        />
        <select
          value={redListFilter}
          onChange={(e) => setRedListFilter(e.target.value as typeof redListFilter)}
          aria-label={
            locale === 'fi' ? 'Suodata uhanalaisuuden mukaan' : locale === 'sv' ? 'Filtrera efter rödlista' : 'Filter by Red List status'
          }
          style={{
            minHeight: 44,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'var(--cream)',
            fontSize: 15,
            fontFamily: 'var(--f-body)',
          }}
        >
          <option value="">
            {locale === 'fi' ? 'Kaikki' : locale === 'sv' ? 'Alla' : 'Any status'}
          </option>
          <option value="CR">CR · {locale === 'fi' ? 'Äärimmäisen uhanalainen' : 'Critically Endangered'}</option>
          <option value="EN">EN · {locale === 'fi' ? 'Erittäin uhanalainen' : 'Endangered'}</option>
          <option value="VU">VU · {locale === 'fi' ? 'Vaarantunut' : 'Vulnerable'}</option>
          <option value="NT">NT · {locale === 'fi' ? 'Silmälläpidettävä' : 'Near Threatened'}</option>
          <option value="LC">LC · {locale === 'fi' ? 'Elinvoimainen' : 'Least Concern'}</option>
        </select>
        <div
          aria-live="polite"
          className="small muted"
          style={{ flexBasis: '100%', marginTop: 4 }}
        >
          {searching
            ? locale === 'fi'
              ? 'Haetaan…'
              : locale === 'sv'
                ? 'Söker…'
                : 'Searching…'
            : `${visible.length} ${locale === 'fi' ? 'tulosta' : locale === 'sv' ? 'resultat' : 'matches'}`}
        </div>
      </div>

      <div
        data-grid-mobile="2"
        role="group"
        aria-label={
          locale === 'fi'
            ? 'Valitse kasveja'
            : locale === 'sv'
              ? 'Välj växter'
              : 'Pick plants (multi-select)'
        }
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}
      >
        {visible.map((p) => {
          const isSelected = pickedSlugs.has(p.slug);
          const funded = plantFundedPct(p);
          const needs = funded < 80;
          const accent = plantAccent(p.id);
          return (
            <button
              key={p.id}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-label={
                isSelected
                  ? `${plantName(p, locale)} — ${locale === 'fi' ? 'poista valinta' : locale === 'sv' ? 'avmarkera' : 'remove from basket'}`
                  : `${plantName(p, locale)} — ${locale === 'fi' ? 'lisää koriin' : locale === 'sv' ? 'lägg till' : 'add to basket'}`
              }
              onClick={() => togglePick(p.slug)}
              className="card"
              style={{
                padding: 0,
                overflow: 'hidden',
                textAlign: 'left',
                cursor: 'pointer',
                border: isSelected ? `2px solid ${selectedTier.color}` : '1px solid var(--line)',
                transform: isSelected ? 'translateY(-4px)' : 'none',
                boxShadow: isSelected ? 'var(--shadow-mid)' : 'var(--shadow-soft)',
                transition: 'transform 200ms, box-shadow 200ms',
              }}
            >
              <div
                style={{
                  height: 140,
                  background: accent,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {p.primaryImage?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.primaryImage.url}
                    alt={
                      locale === 'fi'
                        ? p.primaryImage.altFi
                        : locale === 'sv'
                          ? p.primaryImage.altSv
                          : p.primaryImage.altEn
                    }
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: "3.2rem",
                    }}
                  >
                    🌿
                  </div>
                )}
                {needs && (
                  <span
                    className="badge"
                    style={{
                      background: 'var(--rust-on-light)',
                      color: 'var(--cream)',
                      position: 'absolute',
                      top: 10,
                      left: 10,
                      fontSize: "0.667rem",
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('needsAdopters')}
                  </span>
                )}
                {isSelected && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: selectedTier.color,
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: "0.867rem",
                    }}
                  >
                    ✓
                  </span>
                )}
                <span
                  className={`badge badge-${(p.redListStatus ?? 'NA').toLowerCase()}`}
                  style={{ position: 'absolute', bottom: 10, left: 10 }}
                >
                  {p.redListStatus}
                </span>
              </div>
              <div style={{ padding: 14 }}>
                <div
                  className="serif"
                  style={{ fontSize: "1.133rem", fontStyle: 'italic', lineHeight: 1.1 }}
                >
                  {p.taxon?.latinName ?? p.nameEn}
                </div>
                <div className="tiny" style={{ marginTop: 4 }}>
                  {plantName(p, locale)} · {p.adopterCount ?? 0} {tPlants('adopters').toLowerCase()}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    height: 3,
                    background: 'rgba(31,58,44,0.08)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                  aria-label={`${funded}% funded`}
                >
                  <div
                    style={{
                      width: `${funded}%`,
                      height: '100%',
                      background: selectedTier.color,
                    }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 32 }}>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={onNext}
          disabled={pickedItems.length === 0}
        >
          {pickedItems.length === 1
            ? t('continueWith', {
                label: allPickedSummaries[0]?.plant ? plantName(allPickedSummaries[0]!.plant!, locale) : '',
              })
            : locale === 'fi'
              ? `Jatka ${pickedItems.length} kasvilla →`
              : locale === 'sv'
                ? `Fortsätt med ${pickedItems.length} växter →`
                : `Continue with ${pickedItems.length} plants →`}
          {pickedItems.length === 1 ? ' →' : ''}
        </button>
      </div>
    </section>
  );
}

// ─── Step 3 ───────────────────────────────────────────────────────────────
interface Step3Props {
  locale: string;
  plant: AdoptPlant;
  tier: AdoptTier;
  intent: AdoptIntent;
  setIntent: (i: AdoptIntent) => void;
  donorName: string;
  setDonorName: (s: string) => void;
  donorEmail: string;
  setDonorEmail: (s: string) => void;
  dedication: string;
  setDedication: (s: string) => void;
  homeRegion: string;
  setHomeRegion: (s: string) => void;
  giftRecipientName: string;
  setGiftRecipientName: (s: string) => void;
  giftRecipientEmail: string;
  setGiftRecipientEmail: (s: string) => void;
  giftDeliverOn: string;
  setGiftDeliverOn: (s: string) => void;
  giftAnonymous: boolean;
  setGiftAnonymous: (b: boolean) => void;
  giftWrap: boolean;
  setGiftWrap: (b: boolean) => void;
  memorialOf: string;
  setMemorialOf: (s: string) => void;
  memorialFamilyEmail: string;
  setMemorialFamilyEmail: (s: string) => void;
  coAdopters: CoAdopter[];
  setCoAdopters: (a: CoAdopter[]) => void;
  recurring: boolean;
  /** Forwarded to SummaryCard so it can distinguish annual from one-off. */
  billingInterval: 'monthly' | 'annual' | 'one_time';
  totalCents: number;
  canContinue: boolean;
  onNext: () => void;
  adopt: AdoptSettings;
  /** Multi-item summary inputs — forwarded straight to SummaryCard. Empty
   *  in single-plant mode so the card renders the classic single-item layout. */
  cartItems?: CartItemSummary[];
  onChangeCartTier?: (plantSlug: string, tierId: AdoptTier['id']) => void;
  onRemoveCartItem?: (plantSlug: string) => void;
  allTiers?: AdoptTier[];
  /** Callback for the "+ Add more plants" affordance in SummaryCard. When
   *  provided, the link navigates BACK to step 2 to keep the donor in the
   *  wizard; otherwise it points at the /plants browse page. */
  onAddMore?: () => void;
}

function Step3Personalise(props: Step3Props) {
  const {
    locale,
    plant,
    tier,
    intent,
    setIntent,
    donorName,
    setDonorName,
    donorEmail,
    setDonorEmail,
    dedication,
    setDedication,
    homeRegion,
    setHomeRegion,
    giftRecipientName,
    setGiftRecipientName,
    giftRecipientEmail,
    setGiftRecipientEmail,
    giftDeliverOn,
    setGiftDeliverOn,
    giftAnonymous,
    setGiftAnonymous,
    giftWrap,
    setGiftWrap,
    memorialOf,
    setMemorialOf,
    memorialFamilyEmail,
    setMemorialFamilyEmail,
    coAdopters,
    setCoAdopters,
    recurring,
    billingInterval,
    totalCents,
    canContinue,
    onNext,
    adopt,
    cartItems,
    onChangeCartTier,
    onRemoveCartItem,
    allTiers,
    onAddMore,
  } = props;
  const t = useTranslations('Adopt');

  const intentOptions: Array<{ id: AdoptIntent; label: string; icon: string }> = [
    { id: 'for_self', label: t('intentSelf'), icon: '👤' },
    { id: 'gift', label: t('intentGift'), icon: '🎁' },
    { id: 'memorial', label: t('intentMemorial'), icon: '🤍' },
    { id: 'class', label: t('intentClass'), icon: '🎓' },
  ];

  const addCoAdopter = () => {
    if (coAdopters.length >= adopt.coAdopterMax) return;
    setCoAdopters([...coAdopters, { name: '', email: '' }]);
  };
  const updateCoAdopter = (i: number, patch: Partial<CoAdopter>) => {
    setCoAdopters(coAdopters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const removeCoAdopter = (i: number) => {
    setCoAdopters(coAdopters.filter((_, idx) => idx !== i));
  };

  return (
    <section className="fade-in" aria-labelledby="step3-title">
      <header style={{ marginBottom: 40 }}>
        <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
          {t('step3of4')}
        </div>
        <h2 id="step3-title" style={{ fontSize: 'clamp(2.667rem, 6vw, 3.733rem)', marginTop: 12 }}>
          {t('personaliseTitle')}
        </h2>
        <p className="muted" style={{ marginTop: 12, maxWidth: 600 }}>
          {t('personaliseHint')}
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <fieldset className="card card-pad" style={{ border: '1px solid var(--line)' }}>
            <legend className="tiny" style={{ padding: '0 6px' }}>
              {t('thisAdoptionIs')}
            </legend>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
                marginTop: 4,
              }}
            >
              {intentOptions.map((opt) => (
                <label
                  key={opt.id}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: `1px solid ${intent === opt.id ? 'var(--forest)' : 'var(--line)'}`,
                    background: intent === opt.id ? 'rgba(31,58,44,0.05)' : 'var(--paper)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    color: 'var(--ink)',
                  }}
                >
                  <input
                    type="radio"
                    name="intent"
                    value={opt.id}
                    checked={intent === opt.id}
                    onChange={() => setIntent(opt.id)}
                    className="sr-only"
                  />
                  <span aria-hidden="true" style={{ fontSize: "1.467rem" }}>
                    {opt.icon}
                  </span>
                  <span
                    className="small"
                    style={{ fontWeight: intent === opt.id ? 600 : 400, textAlign: 'center' }}
                  >
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="card card-pad" style={{ border: '1px solid var(--line)' }}>
            <legend className="tiny" style={{ padding: '0 6px' }}>
              {intent === 'gift' ? t('fromYou') : t('adopterDetails')}
            </legend>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                marginTop: 4,
              }}
            >
              <Field
                label={t('nameOnCertificate')}
                placeholder={t('placeholderDonorName')}
                value={donorName}
                onChange={setDonorName}
                autoComplete="name"
              />
              <Field
                label={t('email')}
                placeholder={t('placeholderDonorEmail')}
                type="email"
                value={donorEmail}
                onChange={setDonorEmail}
                autoComplete="email"
                required
              />
            </div>
            <div style={{ marginTop: 16 }}>
              <Field
                label={
                  intent === 'memorial' ? t('memorialDedication') : t('publicDedication')
                }
                placeholder={
                  intent === 'memorial'
                    ? t('placeholderMemorialDedication')
                    : t('placeholderGiftDedication')
                }
                value={dedication}
                onChange={setDedication}
                maxLength={adopt.dedicationMaxChars}
              />
              <div className="tiny" style={{ marginTop: 6, textAlign: 'right' }}>
                {dedication.length}/{adopt.dedicationMaxChars}
              </div>
            </div>
          </fieldset>

          <fieldset
            className="card card-pad"
            style={{
              background:
                'linear-gradient(135deg, rgba(168,192,96,0.10) 0%, rgba(95,176,160,0.10) 100%)',
              borderColor: 'var(--sage)',
            }}
          >
            <legend
              className="tiny"
              style={{
                padding: '0 6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                color: 'var(--forest)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: "0.867rem",
                  fontWeight: 700,
                  color: 'var(--forest)',
                  padding: '3px 8px',
                  background: 'var(--cream)',
                  borderRadius: 4,
                  letterSpacing: '0.04em',
                }}
              >
                I@H
              </span>
              {t('iahTitle')}
            </legend>
            <p
              className="small"
              style={{ color: 'var(--ink-soft)', lineHeight: 1.55, marginTop: 6 }}
            >
              {t('iahBlurb')}
            </p>
            <div style={{ marginTop: 14 }}>
              <Field
                label={t('iahHomeRegionLabel')}
                type="select"
                value={homeRegion}
                onChange={setHomeRegion}
                options={[
                  { value: '', label: t('regionSkip') },
                  ...HOME_REGIONS.map((r) => ({ value: r, label: t(`region${r}` as 'regionSkip') })),
                ]}
              />
            </div>
          </fieldset>

          {intent === 'gift' && (
            <fieldset
              className="card card-pad"
              style={{
                background: 'linear-gradient(135deg, #fbf3e0 0%, #f4eccc 100%)',
                borderColor: 'rgba(178,92,58,0.2)',
              }}
            >
              <legend
                className="tiny"
                style={{ padding: '0 6px', color: 'var(--rust-on-light)' }}
              >
                🎁 {t('giftDeliveryTitle')}
              </legend>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginTop: 4,
                }}
              >
                <Field
                  label={t('recipientName')}
                  placeholder={t('placeholderRecipientName')}
                  value={giftRecipientName}
                  onChange={setGiftRecipientName}
                  autoComplete="off"
                />
                <Field
                  label={t('recipientEmail')}
                  placeholder={t('placeholderRecipientEmail')}
                  type="email"
                  value={giftRecipientEmail}
                  onChange={setGiftRecipientEmail}
                  autoComplete="off"
                  required
                />
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginTop: 12,
                }}
              >
                <Field
                  label={t('deliverOn')}
                  type="date"
                  value={giftDeliverOn}
                  onChange={setGiftDeliverOn}
                />
                <Field
                  label={t('sendAnonymously')}
                  type="select"
                  value={giftAnonymous ? 'true' : 'false'}
                  onChange={(v) => setGiftAnonymous(v === 'true')}
                  options={[
                    { value: 'false', label: t('signFromMe') },
                    { value: 'true', label: t('yesAnonymous') },
                  ]}
                />
              </div>
              <label
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  marginTop: 16,
                  padding: 12,
                  background: 'rgba(255,255,255,0.6)',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={giftWrap}
                  onChange={(e) => setGiftWrap(e.target.checked)}
                  style={{ accentColor: 'var(--rust-on-light)', marginTop: 3 }}
                />
                <div>
                  <div className="small" style={{ fontWeight: 500 }}>
                    {t('giftWrapTitle')}
                  </div>
                  <div className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>
                    {t('giftWrapHint')}
                  </div>
                </div>
              </label>
            </fieldset>
          )}

          {intent === 'memorial' && (
            <fieldset
              className="card card-pad"
              style={{
                background: 'rgba(107, 45, 58, 0.04)',
                borderColor: 'rgba(107,45,58,0.2)',
              }}
            >
              <legend
                className="tiny"
                style={{ padding: '0 6px', color: 'var(--rust-on-light)' }}
              >
                {t('memorialDetailsTitle')}
              </legend>
              <p
                className="small"
                style={{ marginTop: 4, color: 'var(--ink-soft)', lineHeight: 1.55 }}
              >
                {t('memorialBlurb')}
              </p>
              <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                <Field
                  label={t('memorialOfLabel')}
                  placeholder={t('memorialOfPlaceholder')}
                  value={memorialOf}
                  onChange={setMemorialOf}
                  required
                />
                <Field
                  label={t('familyRecipientEmail')}
                  placeholder={t('placeholderFamilyEmail')}
                  type="email"
                  value={memorialFamilyEmail}
                  onChange={setMemorialFamilyEmail}
                />
              </div>
            </fieldset>
          )}

          <div className="card card-pad" style={{ background: 'var(--paper)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div className="small" style={{ fontWeight: 500 }}>
                  {t('coAdoptTitle')}
                </div>
                <div
                  className="tiny"
                  style={{ textTransform: 'none', letterSpacing: 0, marginTop: 2 }}
                >
                  {t('coAdoptHint')}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addCoAdopter}
                style={{ padding: '8px 14px', fontSize: '0.867rem' }}
                disabled={coAdopters.length >= adopt.coAdopterMax}
              >
                {t('addCoAdopter')}
              </button>
            </div>
            {coAdopters.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {coAdopters.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr auto',
                      gap: 10,
                      alignItems: 'end',
                    }}
                  >
                    <Field
                      label={t('coAdopterName')}
                      placeholder={t('placeholderRecipientName')}
                      value={c.name}
                      onChange={(v) => updateCoAdopter(i, { name: v })}
                    />
                    <Field
                      label={t('coAdopterEmail')}
                      placeholder={t('placeholderRecipientEmail')}
                      type="email"
                      value={c.email}
                      onChange={(v) => updateCoAdopter(i, { email: v })}
                    />
                    <button
                      type="button"
                      onClick={() => removeCoAdopter(i)}
                      className="btn btn-ghost small"
                      aria-label={`${t('removeCoAdopter')} ${i + 1}`}
                      style={{ padding: '8px 10px', height: 40 }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside style={{ position: 'sticky', top: 140, alignSelf: 'flex-start' }}>
          <SummaryCard
            locale={locale}
            plant={plant}
            tier={tier}
            billingInterval={billingInterval}
            intent={intent}
            totalCents={totalCents}
            dedication={dedication}
            giftWrap={intent === 'gift' && giftWrap}
            cartItems={cartItems}
            onChangeCartTier={onChangeCartTier}
            onRemoveCartItem={onRemoveCartItem}
            allTiers={allTiers}
            onAddMore={onAddMore}
          />
          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            style={{ marginTop: 16 }}
            onClick={onNext}
            disabled={!canContinue}
          >
            {t('continueToPayment')} →
          </button>
        </aside>
      </div>
    </section>
  );
}

// ─── Step 4 ───────────────────────────────────────────────────────────────
interface Step4Props {
  locale: string;
  plant: AdoptPlant;
  tier: AdoptTier;
  intent: AdoptIntent;
  recurring: boolean;
  /** Forwarded to SummaryCard so it shows the right billing label. */
  billingInterval: 'monthly' | 'annual' | 'one_time';
  dedication: string;
  giftWrap: boolean;
  totalCents: number;
  baseCents: number;
  paymentMethod: AdoptProvider;
  setPaymentMethod: (m: AdoptProvider) => void;
  marketingOptIn: boolean;
  setMarketingOptIn: (b: boolean) => void;
  submitting: boolean;
  onSubmit: () => void;
  adopt: AdoptSettings;
  enabledProviders: AdoptProvider[];
  errorMessage: string | null;
  cartItems?: CartItemSummary[];
  allTiers?: AdoptTier[];
}

function Step4Pay({
  locale,
  plant,
  tier,
  intent,
  recurring,
  billingInterval,
  dedication,
  giftWrap,
  totalCents,
  paymentMethod,
  setPaymentMethod,
  marketingOptIn,
  setMarketingOptIn,
  submitting,
  onSubmit,
  adopt,
  enabledProviders,
  errorMessage,
  cartItems,
  allTiers,
}: Step4Props) {
  const t = useTranslations('Adopt');

  // Only the providers admins have enabled in /admin show up here. The
  // backend's pickProvider() may still route differently (e.g. fall back
  // to a different rail), but the donor is offered the visible set.
  const allMethods: Record<AdoptProvider, { label: string; sub: string; badge: string; brandColor: string }> = {
    paytrail: {
      label: t('card'),
      sub: t('cardSubtitle'),
      badge: 'VISA',
      brandColor: 'var(--forest)',
    },
    mobilepay: {
      label: t('mobilepay'),
      sub: t('mobilepaySubtitle'),
      badge: 'MP',
      brandColor: '#5A78FF',
    },
  };
  const methods = enabledProviders.map((id) => ({ id, ...allMethods[id] }));

  const recurringSuffix = recurring
    ? locale === 'fi'
      ? '/kk'
      : locale === 'sv'
        ? '/mån'
        : '/mo'
    : '';

  // Donation-vs-benefits split is admin-configurable in basis points
  // (adopt.donationShareBp). The disclosure box is editorial; the
  // authoritative VAT calc on the receipt uses vat.donationRateBp /
  // vat.perkRateBp from SystemSetting.
  const donationShare = Math.round((totalCents * adopt.donationShareBp) / 10_000);
  const benefitsShare = totalCents - donationShare;

  return (
    <section className="fade-in" aria-labelledby="step4-title">
      <header style={{ marginBottom: 40 }}>
        <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
          {t('step4of4')}
        </div>
        <h2 id="step4-title" style={{ fontSize: 'clamp(2.667rem, 6vw, 3.733rem)', marginTop: 12 }}>
          {t('paymentTitle')}
        </h2>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <fieldset className="card card-pad" style={{ border: '1px solid var(--line)' }}>
            <legend className="tiny" style={{ padding: '0 6px' }}>
              {t('paymentMethod')}
            </legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              {methods.map((m) => (
                <label
                  key={m.id}
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: 16,
                    borderRadius: 12,
                    border: `1px solid ${
                      paymentMethod === m.id ? 'var(--forest)' : 'var(--line)'
                    }`,
                    background:
                      paymentMethod === m.id ? 'rgba(31,58,44,0.04)' : 'var(--paper)',
                    cursor: 'pointer',
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === m.id}
                    onChange={() => setPaymentMethod(m.id)}
                    style={{ accentColor: 'var(--forest)' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{m.label}</div>
                    <div className="small muted">{m.sub}</div>
                  </div>
                  <span
                    aria-hidden="true"
                    style={{
                      background: m.brandColor,
                      color: 'white',
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: '0.733rem',
                      fontWeight: 700,
                      fontFamily: 'var(--f-mono)',
                    }}
                  >
                    {m.badge}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div
            style={{
              padding: 16,
              background: 'rgba(31,58,44,0.04)',
              borderRadius: 12,
              fontSize: '0.867rem',
              color: 'var(--ink-soft)',
              lineHeight: 1.6,
            }}
          >
            ℹ{' '}
            {t('taxDisclosure', {
              total: euros(totalCents, locale),
              donation: euros(donationShare, locale),
              benefits: euros(benefitsShare, locale),
            })}{' '}
            <a
              href={`/${locale}${adopt.fundsFlowUrl.startsWith('/') ? adopt.fundsFlowUrl : `/${adopt.fundsFlowUrl}`}`}
              style={{ color: 'var(--forest)' }}
            >
              {t('fundsFlowLink')}
            </a>
            .
          </div>

          {errorMessage && (
            <div
              role="alert"
              aria-live="polite"
              style={{
                padding: 14,
                background: 'rgba(184,81,58,0.10)',
                color: 'var(--rust-on-light)',
                borderRadius: 10,
                fontSize: '0.867rem',
                border: '1px solid rgba(184,81,58,0.3)',
              }}
            >
              <strong>{t('errorTitle')}:</strong> {errorMessage}
            </div>
          )}

          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: 14,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              style={{ accentColor: 'var(--forest)', marginTop: 3 }}
            />
            <span className="small">{t('marketingOptIn')}</span>
          </label>
        </div>

        <aside style={{ position: 'sticky', top: 140, alignSelf: 'flex-start' }}>
          <SummaryCard
            locale={locale}
            plant={plant}
            tier={tier}
            billingInterval={billingInterval}
            intent={intent}
            totalCents={totalCents}
            dedication={dedication}
            giftWrap={intent === 'gift' && giftWrap}
            cartItems={cartItems}
            allTiers={allTiers}
          />
          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            style={{ marginTop: 16, minHeight: 48 }}
            onClick={onSubmit}
            disabled={submitting || methods.length === 0}
            aria-busy={submitting}
          >
            {submitting
              ? t('submitting')
              : `✓ ${t('confirmPay', { amount: euros(totalCents, locale), suffix: recurringSuffix })}`}
          </button>
          <div
            className="tiny"
            style={{
              textAlign: 'center',
              marginTop: 12,
              textTransform: 'none',
              letterSpacing: 0,
              lineHeight: 1.5,
            }}
          >
            {t('refundsPolicy')}
            <br />
            {t('plantDiedPolicy')}
          </div>
        </aside>
      </div>
    </section>
  );
}

// ─── Shared subcomponents ────────────────────────────────────────────────
type FieldOption = { value: string; label: string };
interface FieldProps {
  label: string;
  placeholder?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  options?: FieldOption[];
  maxLength?: number;
  autoComplete?: string;
  required?: boolean;
}

function Field({
  label,
  placeholder,
  type = 'text',
  value,
  onChange,
  options,
  maxLength,
  autoComplete,
  required,
}: FieldProps) {
  const styleBase: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'var(--paper)',
    fontSize: "0.933rem",
    color: 'var(--ink)',
    outline: 'none',
  };
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        className="tiny"
        style={{
          textTransform: 'none',
          letterSpacing: 0,
          color: 'var(--ink-mute)',
        }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--rust-on-light)', marginLeft: 4 }} aria-hidden="true">
            *
          </span>
        )}
      </span>
      {type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={styleBase}
          required={required}
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          autoComplete={autoComplete}
          required={required}
          style={styleBase}
        />
      )}
    </label>
  );
}

interface CartItemSummary {
  plantSlug: string;
  tierId: AdoptTier['id'];
  plant: AdoptPlant | null;
  tier: AdoptTier | null;
}

interface SummaryCardProps {
  locale: string;
  plant: AdoptPlant;
  tier: AdoptTier;
  /** Drives every cadence-dependent thing in the summary: the billing
   *  label, the per-period price, and the suffix. Replaces a previous
   *  `recurring` boolean which couldn't distinguish annual from one-off. */
  billingInterval: 'monthly' | 'annual' | 'one_time';
  intent: AdoptIntent;
  totalCents: number;
  dedication: string;
  giftWrap: boolean;
  /** When present, the card renders as a multi-item basket review instead
   *  of a single-plant card. Each item shows tier + price; the per-item
   *  tier select edits the cart in localStorage. */
  cartItems?: CartItemSummary[];
  onChangeCartTier?: (plantSlug: string, tierId: AdoptTier['id']) => void;
  onRemoveCartItem?: (plantSlug: string) => void;
  allTiers?: AdoptTier[];
  /** Optional handler for the "+ Add more plants" affordance. When set,
   *  the affordance becomes an in-wizard button (jumps to step 2) rather
   *  than a link to /plants. */
  onAddMore?: () => void;
}

function SummaryCard({
  locale,
  plant,
  tier,
  billingInterval,
  intent,
  totalCents,
  dedication,
  giftWrap,
  cartItems,
  onChangeCartTier,
  onRemoveCartItem,
  allTiers,
  onAddMore,
}: SummaryCardProps) {
  const t = useTranslations('Adopt');
  const intentLabel = (
    {
      for_self: t('intentLabelSelf'),
      gift: t('intentLabelGift'),
      memorial: t('intentLabelMemorial'),
      class: t('intentLabelClass'),
    } as Record<AdoptIntent, string>
  )[intent];
  const billing =
    billingInterval === 'monthly'
      ? t('summaryMonthlyCancel')
      : billingInterval === 'annual'
        ? t('summaryAnnualBilling')
        : t('summaryOneOff');
  // monthly → use monthly price (or annual fallback); annual/one_time → annual price.
  const tierPriceCents =
    billingInterval === 'monthly' && tier.monthlyPriceCents
      ? tier.monthlyPriceCents
      : tier.annualPriceCents;
  const recurringSuffix =
    billingInterval === 'monthly' && tier.monthlyPriceCents
      ? locale === 'fi' ? '/kk' : locale === 'sv' ? '/mån' : '/mo'
      : billingInterval === 'annual'
        ? locale === 'fi' ? '/vuosi' : locale === 'sv' ? '/år' : '/yr'
        : '';

  // Helper for per-item price within the basket review, mirrors the
  // wizard's priceForTier so the donor sees the same number.
  const priceForCartTier = (cartTier: AdoptTier | null): number => {
    if (!cartTier) return 0;
    if (billingInterval === 'monthly' && cartTier.monthlyPriceCents) return cartTier.monthlyPriceCents;
    return cartTier.annualPriceCents;
  };

  const isMulti = Array.isArray(cartItems) && cartItems.length > 0;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {isMulti ? (
        <div
          style={{
            padding: 16,
            background: 'var(--paper)',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div className="tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)' }}>
            {cartItems!.length}{' '}
            {locale === 'fi'
              ? cartItems!.length === 1 ? 'kasvi korissa' : 'kasvia korissa'
              : locale === 'sv'
                ? cartItems!.length === 1 ? 'växt i korgen' : 'växter i korgen'
                : cartItems!.length === 1 ? 'plant in basket' : 'plants in basket'}
          </div>
          {cartItems!.map((it) => {
            const p = it.plant;
            const tt = it.tier;
            return (
              <div
                key={it.plantSlug}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: '1px dashed var(--line)',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: p ? plantAccent(p.id) : 'var(--sage-pale)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {p?.primaryImage?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.primaryImage.url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: "1.067rem" }}>🌿</span>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="serif"
                    style={{ fontSize: "0.933rem", fontStyle: 'italic', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={p?.taxon?.latinName ?? p?.nameEn ?? it.plantSlug}
                  >
                    {p?.taxon?.latinName ?? p?.nameEn ?? it.plantSlug}
                  </div>
                  {allTiers && onChangeCartTier ? (
                    <select
                      value={it.tierId}
                      onChange={(e) => onChangeCartTier(it.plantSlug, e.target.value as AdoptTier['id'])}
                      style={{
                        marginTop: 2,
                        padding: '2px 6px',
                        borderRadius: 6,
                        border: '1px solid var(--line)',
                        background: 'var(--cream)',
                        fontSize: "0.733rem",
                        maxWidth: 180,
                      }}
                      aria-label={`tier for ${it.plantSlug}`}
                    >
                      {allTiers.map((tier) => {
                        const cents =
                          billingInterval === 'monthly' && tier.monthlyPriceCents
                            ? tier.monthlyPriceCents
                            : tier.annualPriceCents;
                        return (
                          <option key={tier.id} value={tier.id}>
                            {tierName(tier, locale)} · €{euros(cents, locale)}{recurringSuffix}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <div className="tiny muted" style={{ marginTop: 2 }}>
                      {tt ? tierName(tt, locale) : it.tierId}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div className="small" style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                    €{euros(priceForCartTier(tt), locale)}{recurringSuffix}
                  </div>
                  {onRemoveCartItem && (
                    <button
                      type="button"
                      onClick={() => onRemoveCartItem(it.plantSlug)}
                      className="tiny"
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--line)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        cursor: 'pointer',
                        color: 'var(--rust-on-light)',
                      }}
                      aria-label={`remove ${it.plantSlug}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {onAddMore ? (
            <button
              type="button"
              onClick={onAddMore}
              className="tiny"
              style={{
                color: 'var(--forest)',
                textAlign: 'center',
                textDecoration: 'underline',
                padding: '4px 0',
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
              }}
            >
              {locale === 'fi' ? '+ Lisää kasveja' : locale === 'sv' ? '+ Lägg till växter' : '+ Add more plants'}
            </button>
          ) : (
            <Link
              href={`/${locale}/plants`}
              className="tiny"
              style={{ color: 'var(--forest)', textAlign: 'center', textDecoration: 'underline', padding: '4px 0' }}
            >
              {locale === 'fi' ? '+ Lisää kasveja' : locale === 'sv' ? '+ Lägg till växter' : '+ Add more plants'}
            </Link>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: 24,
            background: 'var(--paper)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', gap: 14 }}>
            <div
              style={{
                width: 60,
                height: 76,
                borderRadius: 10,
                background: plantAccent(plant.id),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              {plant.primaryImage?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={plant.primaryImage.url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span aria-hidden="true" style={{ fontSize: "2rem" }}>
                  🌿
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tiny">{plant.nameFi}</div>
              <div
                className="serif"
                style={{ fontSize: "1.467rem", fontStyle: 'italic', lineHeight: 1.1, marginTop: 2 }}
              >
                {plant.taxon?.latinName ?? plant.nameEn}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className={`badge badge-${(plant.redListStatus ?? 'NA').toLowerCase()}`}>
                  {plant.redListStatus}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{ padding: 24 }}>
        {!isMulti && (
          <SummaryRow
            label={t('summaryTier', { tier: tierName(tier, locale) })}
            value={`€${euros(tierPriceCents, locale)}${recurringSuffix}`}
          />
        )}
        <SummaryRow label={t('summaryIntent')} value={intentLabel} />
        {dedication && (
          <SummaryRow
            label={t('summaryDedication')}
            value={`"${dedication.slice(0, 30)}${dedication.length > 30 ? '…' : ''}"`}
          />
        )}
        {giftWrap && <SummaryRow label={t('summaryGiftWrap')} value="€4" />}
        <SummaryRow label={t('summaryBilling')} value={billing} />
        <div
          style={{
            borderTop: '1px dashed var(--line)',
            margin: '16px 0',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <div style={{ fontWeight: 500 }}>{t('summaryTotal')}</div>
          <div className="serif" style={{ fontSize: "2.133rem" }}>
            €{euros(totalCents, locale)}
            {recurringSuffix && (
              <span style={{ fontSize: "0.933rem", color: 'var(--ink-mute)' }}>{recurringSuffix}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '6px 0',
        fontSize: "0.867rem",
        gap: 12,
      }}
    >
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
