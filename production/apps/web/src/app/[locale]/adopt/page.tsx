import { getTranslations } from 'next-intl/server';
import {
  BILLING_INTERVALS,
  DEFAULT_INTERVALS_ENABLED,
  DEFAULT_PLAQUE_ELIGIBLE_TIERS,
  DONOR_FACING_PROVIDERS,
  TIER_IDS,
  getInternalApiUrl,
  normaliseIntent,
  type BillingInterval,
} from '@bloomoulu/constants';
import {
  AdoptWizard,
  type AdoptTier,
  type AdoptPlant,
  type AdoptSettings,
} from './wizard.client';

export const dynamic = 'force-dynamic';

async function fetchTiers(): Promise<AdoptTier[]> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/tiers`, { cache: 'no-store' });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

async function fetchPlants(limit: number): Promise<AdoptPlant[]> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/plants?limit=${limit}`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

async function fetchPlant(slug: string | undefined): Promise<AdoptPlant | null> {
  if (!slug) return null;
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/plants/${slug}`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

interface PublicSettingsResponse {
  payments?: {
    bank_transfer?: boolean;
    paytrail?: boolean;
    mobilepay?: boolean;
  };
  adoption?: Partial<AdoptSettings>;
  features?: { corporateTier?: boolean };
  testMode?: { paytrail?: boolean; mobilepay?: boolean };
}

async function fetchPublicSettings(): Promise<PublicSettingsResponse> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/settings/public`, {
      cache: 'no-store',
    });
    return res.ok ? res.json() : {};
  } catch {
    return {};
  }
}

function normaliseInterval(
  raw: string | undefined,
  enabled: readonly BillingInterval[],
): BillingInterval | null {
  if (!raw) return null;
  const candidate = raw === 'one-time' ? 'one_time' : raw;
  if ((BILLING_INTERVALS as readonly string[]).includes(candidate) && enabled.includes(candidate as BillingInterval)) {
    return candidate as BillingInterval;
  }
  return null;
}

/**
 * Fallback used when the /v1/settings/public fetch fails. The runtime SSOT
 * is `buildSettingsDefaults` in apps/api/src/modules/settings/settings.service.ts;
 * mirror values from packages/constants for the type-safe subset we
 * defaulting here. Editing one of these defaults should update both.
 */
const DEFAULT_ADOPT_SETTINGS: AdoptSettings = {
  giftWrapCents: 400,
  donationShareBp: 7200,
  plaqueEligibleTiers: [...DEFAULT_PLAQUE_ELIGIBLE_TIERS],
  dedicationMaxChars: 240,
  coAdopterMax: 10,
  fundsFlowUrl: '/about#funds-flow',
  intervalsEnabled: [...DEFAULT_INTERVALS_ENABLED],
};

export default async function AdoptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plant?: string; tier?: string; intent?: string; interval?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Adopt' });

  const [tiers, plants, presetPlant, publicSettings] = await Promise.all([
    fetchTiers(),
    fetchPlants(16),
    fetchPlant(sp.plant),
    fetchPublicSettings(),
  ]);

  const presetTier =
    sp.tier && (TIER_IDS as readonly string[]).includes(sp.tier) ? sp.tier : 'vulnerable';
  const presetIntent = normaliseIntent(sp.intent);

  // Make sure the preset plant is present in the picker list so step 2
  // highlights it immediately. The list comes back ordered by adopterCount;
  // preset plants for niche species may be off-page.
  const mergedPlants =
    presetPlant && !plants.some((p) => p.slug === presetPlant.slug)
      ? [presetPlant, ...plants]
      : plants;

  // Whether the corporate strip is rendered comes from settings — admin
  // can hide the corporate tier without removing the row.
  const showCorporate = publicSettings.features?.corporateTier ?? true;
  const filteredTiers = showCorporate ? tiers : tiers.filter((tt) => tt.id !== 'corporate');

  // Map enabled providers; bank-transfer is omitted from the donor-facing
  // UI per current product direction (Paytrail + MobilePay only). The DTO
  // still accepts it for compatibility with the admin reconciliation flow.
  const adminPayments = publicSettings.payments ?? {};
  const enabledProviders = DONOR_FACING_PROVIDERS.filter(
    (p) => adminPayments[p] !== false,
  );

  const adopt = {
    ...DEFAULT_ADOPT_SETTINGS,
    ...(publicSettings.adoption ?? {}),
  } satisfies AdoptSettings;

  // Preset interval lets the plant-detail page forward the donor's tier
  // + interval choice into the wizard so step 1 doesn't reset their pick.
  // Falls back to the wizard's own first-enabled default if absent or
  // disabled in admin.
  const presetInterval = normaliseInterval(sp.interval, adopt.intervalsEnabled);

  return (
    <article className="fade-in">
      <AdoptWizard
        locale={locale}
        tiers={filteredTiers}
        plants={mergedPlants}
        presetPlantSlug={presetPlant?.slug ?? null}
        presetTier={presetTier as AdoptTier['id']}
        presetIntent={presetIntent}
        presetInterval={presetInterval}
        title={t('title')}
        enabledProviders={enabledProviders.length > 0 ? Array.from(enabledProviders) : [...DONOR_FACING_PROVIDERS]}
        adopt={adopt}
        testMode={publicSettings.testMode}
      />
    </article>
  );
}
