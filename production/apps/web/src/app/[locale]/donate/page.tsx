import { getTranslations } from 'next-intl/server';
import {
  DONOR_FACING_PROVIDERS,
  DEFAULT_SUGGESTED_AMOUNTS_CENTS,
  DEFAULT_DONATION_AMOUNT_CENTS,
  MIN_DONATION_CENTS,
  MAX_DONATION_CENTS,
  getInternalApiUrl,
} from '@bloomoulu/constants';
import { DonateForm, type DonatePlant, type DonateSettings } from './donate-form.client';

export const dynamic = 'force-dynamic';

async function fetchPlants(limit: number): Promise<DonatePlant[]> {
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

async function fetchPlant(slug: string | undefined): Promise<DonatePlant | null> {
  if (!slug) return null;
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/plants/${slug}`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

interface PublicSettingsResponse {
  payments?: { bank_transfer?: boolean; paytrail?: boolean; mobilepay?: boolean };
  donation?: Partial<DonateSettings>;
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

const DEFAULT_DONATE_SETTINGS: DonateSettings = {
  suggestedAmountsCents: [...DEFAULT_SUGGESTED_AMOUNTS_CENTS],
  defaultAmountCents: DEFAULT_DONATION_AMOUNT_CENTS,
  allowCustomAmount: true,
  minCents: MIN_DONATION_CENTS,
  maxCents: MAX_DONATION_CENTS,
  dedicationMaxChars: 240,
  fundsFlowUrl: '/about#funds-flow',
};

export default async function DonatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plant?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Donate' });

  const [plants, presetPlant, publicSettings] = await Promise.all([
    fetchPlants(48),
    fetchPlant(sp.plant),
    fetchPublicSettings(),
  ]);

  const mergedPlants =
    presetPlant && !plants.some((p) => p.slug === presetPlant.slug)
      ? [presetPlant, ...plants]
      : plants;

  const adminPayments = publicSettings.payments ?? {};
  const enabledProviders = DONOR_FACING_PROVIDERS.filter((p) => adminPayments[p] !== false);

  const donation = {
    ...DEFAULT_DONATE_SETTINGS,
    ...(publicSettings.donation ?? {}),
  } satisfies DonateSettings;

  return (
    <article className="fade-in">
      <DonateForm
        locale={locale}
        title={t('title')}
        plants={mergedPlants}
        presetPlantSlug={presetPlant?.slug ?? null}
        donation={donation}
        enabledProviders={
          enabledProviders.length > 0 ? Array.from(enabledProviders) : [...DONOR_FACING_PROVIDERS]
        }
        testMode={publicSettings.testMode}
      />
    </article>
  );
}
