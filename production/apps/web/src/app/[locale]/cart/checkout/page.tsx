/**
 * /[locale]/cart/checkout — renders the unified adoption wizard in cart
 * mode. The wizard reads basket items from localStorage and submits to
 * /v1/adoptions/bundle. This is the SAME UI as /adopt for a single plant
 * so the donor sees one consistent flow regardless of count.
 */
import { getTranslations } from 'next-intl/server';
import {
  DEFAULT_INTERVALS_ENABLED,
  DEFAULT_PLAQUE_ELIGIBLE_TIERS,
  DONOR_FACING_PROVIDERS,
  getBrowserApiUrl,
  getInternalApiUrl,
} from '@bloomoulu/constants';
import {
  AdoptWizard,
  type AdoptIntent,
  type AdoptTier,
  type AdoptPlant,
  type AdoptSettings,
} from '../../adopt/wizard.client';

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
    const res = await fetch(`${getInternalApiUrl()}/v1/plants?limit=${limit}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

interface PublicSettingsResponse {
  payments?: { bank_transfer?: boolean; paytrail?: boolean; mobilepay?: boolean };
  adoption?: Partial<AdoptSettings>;
  features?: { corporateTier?: boolean };
  testMode?: { paytrail?: boolean; mobilepay?: boolean };
}

async function fetchPublicSettings(): Promise<PublicSettingsResponse> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/settings/public`, { cache: 'no-store' });
    return res.ok ? res.json() : {};
  } catch {
    return {};
  }
}

const DEFAULT_ADOPT_SETTINGS: AdoptSettings = {
  giftWrapCents: 400,
  donationShareBp: 7200,
  plaqueEligibleTiers: [...DEFAULT_PLAQUE_ELIGIBLE_TIERS],
  dedicationMaxChars: 240,
  coAdopterMax: 10,
  intervalsEnabled: [...DEFAULT_INTERVALS_ENABLED],
};

export default async function CartCheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Adopt' });
  const [tiers, plants, publicSettings] = await Promise.all([
    fetchTiers(),
    fetchPlants(16),
    fetchPublicSettings(),
  ]);

  const showCorporate = publicSettings.features?.corporateTier ?? true;
  const filteredTiers = showCorporate ? tiers : tiers.filter((tt) => tt.id !== 'corporate');

  const adminPayments = publicSettings.payments ?? {};
  const enabledProviders = DONOR_FACING_PROVIDERS.filter(
    (p) => adminPayments[p] !== false,
  );

  const adopt = {
    ...DEFAULT_ADOPT_SETTINGS,
    ...(publicSettings.adoption ?? {}),
  } satisfies AdoptSettings;

  const presetIntent: AdoptIntent = 'for_self';

  return (
    <article className="fade-in">
      <AdoptWizard
        locale={locale}
        tiers={filteredTiers}
        plants={plants}
        presetPlantSlug={null}
        presetTier={'vulnerable' as AdoptTier['id']}
        presetIntent={presetIntent}
        cartMode
        apiUrl={getBrowserApiUrl()}
        title={t('title')}
        enabledProviders={enabledProviders.length > 0 ? Array.from(enabledProviders) : [...DONOR_FACING_PROVIDERS]}
        adopt={adopt}
        testMode={publicSettings.testMode}
      />
    </article>
  );
}
