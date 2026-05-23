/**
 * /[locale]/cart/checkout — renders the unified adoption wizard in cart
 * mode. The wizard reads basket items from localStorage and submits to
 * /v1/adoptions/bundle. This is the SAME UI as /adopt for a single plant
 * so the donor sees one consistent flow regardless of count.
 */
import { getTranslations } from 'next-intl/server';
import {
  AdoptWizard,
  type AdoptIntent,
  type AdoptTier,
  type AdoptPlant,
  type AdoptSettings,
} from '../../adopt/wizard.client';

export const dynamic = 'force-dynamic';

function internalApiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
}

async function fetchTiers(): Promise<AdoptTier[]> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/tiers`, { cache: 'no-store' });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

async function fetchPlants(limit: number): Promise<AdoptPlant[]> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/plants?limit=${limit}`, { cache: 'no-store' });
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
}

async function fetchPublicSettings(): Promise<PublicSettingsResponse> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/settings/public`, { cache: 'no-store' });
    return res.ok ? res.json() : {};
  } catch {
    return {};
  }
}

const DEFAULT_ADOPT_SETTINGS: AdoptSettings = {
  giftWrapCents: 400,
  donationShareBp: 7200,
  plaqueEligibleTiers: ['endangered', 'corporate'],
  dedicationMaxChars: 240,
  coAdopterMax: 10,
  fundsFlowUrl: '/about#funds-flow',
  intervalsEnabled: ['monthly', 'one_time'],
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
  const enabledProviders = (['paytrail', 'mobilepay'] as const).filter(
    (p) => adminPayments[p] !== false,
  );

  const adopt = {
    ...DEFAULT_ADOPT_SETTINGS,
    ...(publicSettings.adoption ?? {}),
  } satisfies AdoptSettings;

  const browserApi = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
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
        apiUrl={browserApi}
        title={t('title')}
        enabledProviders={enabledProviders.length > 0 ? Array.from(enabledProviders) : ['paytrail', 'mobilepay']}
        adopt={adopt}
      />
    </article>
  );
}
