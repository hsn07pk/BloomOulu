/**
 * /[locale]/plants/[slug]/print — printable QR label for a single plant.
 *
 * The plant detail page's "Print" used to call `window.print()` on the
 * whole detail view, which dumped a multi-page PDF of the entire UI.
 * This dedicated page renders ONLY the label so a curator hits Cmd+P
 * and gets a tidy stickerable QR.
 *
 * Every dimension and field is admin-configurable via `qrLabel.*` in
 * /admin → SystemSetting, served at /v1/settings/public. The encoded
 * URL carries ?qr=1 (and optionally &kiosk=<id>) so PlantScan rows are
 * recorded when a visitor actually scans the label.
 */
import { notFound } from 'next/navigation';
import { getInternalApiUrl, getWebUrl } from '@bloomoulu/constants';
import { PrintQrLabel } from './label.client';

export const dynamic = 'force-dynamic';

interface QrLabelSettings {
  sizeMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  showCommonName: boolean;
  showLatin: boolean;
  showRedList: boolean;
  showGardenZone: boolean;
  showSlug: boolean;
  embedKioskId: boolean;
  defaultKioskId: string;
}

const DEFAULT_LABEL: QrLabelSettings = {
  sizeMm: 35,
  labelWidthMm: 80,
  labelHeightMm: 50,
  showCommonName: true,
  showLatin: true,
  showRedList: true,
  showGardenZone: false,
  showSlug: false,
  embedKioskId: true,
  defaultKioskId: '',
};

interface PlantSummary {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  gardenZone?: string | null;
  taxon?: { latinName?: string | null } | null;
}

async function fetchPlant(slug: string): Promise<PlantSummary | null> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/plants/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

async function fetchQrLabelSettings(): Promise<QrLabelSettings> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/settings/public`, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_LABEL;
    const data = (await res.json()) as { qrLabel?: Partial<QrLabelSettings> };
    return { ...DEFAULT_LABEL, ...(data.qrLabel ?? {}) };
  } catch {
    return DEFAULT_LABEL;
  }
}

export default async function PrintQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ kiosk?: string; size?: string }>;
}) {
  const { locale, slug } = await params;
  const sp = await searchParams;
  const [plant, settings] = await Promise.all([fetchPlant(slug), fetchQrLabelSettings()]);
  if (!plant) notFound();

  // Compose the URL the QR encodes: public plant page + ?qr=1 (and a
  // kioskId from URL override → admin default → none).
  const kioskFromUrl = sp.kiosk?.trim() ?? '';
  const kioskId = kioskFromUrl || settings.defaultKioskId || '';
  const qrParams = new URLSearchParams({ qr: '1' });
  if (settings.embedKioskId && kioskId) qrParams.set('kiosk', kioskId);
  const targetUrl = `${getWebUrl().replace(/\/$/, '')}/${locale}/plants/${plant.slug}?${qrParams}`;

  // Override the QR size via ?size=XX (mm) if a curator wants a one-off
  // resize without changing admin settings.
  const overrideSize = sp.size ? parseInt(sp.size, 10) : NaN;
  const effective: QrLabelSettings = {
    ...settings,
    sizeMm: Number.isFinite(overrideSize) && overrideSize > 5 && overrideSize <= 200
      ? overrideSize
      : settings.sizeMm,
  };

  return (
    <PrintQrLabel
      plant={plant}
      locale={locale as 'en' | 'fi' | 'sv'}
      kioskId={kioskId}
      qrUrl={targetUrl}
      settings={effective}
    />
  );
}
