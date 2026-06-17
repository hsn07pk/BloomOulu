/**
 * Configure — single hub page for every system-setting panel.
 *
 * Replaces the old eight individual sidebar entries (Garden identity,
 * Payment providers, Donations, Curator & Ask, Enrichment worker, QR
 * labels, Translations, All settings) with one page + a horizontal tab
 * bar. Same panels, friendlier navigation: a non-technical curator sees
 * a single "Configure" link in the sidebar and tabs across the top.
 *
 * Tabs persist in the URL hash so deep links (and the browser's back
 * button) survive.
 */
import React, { useEffect, useMemo, useState } from 'react';
import ConfigForm from './ConfigForm';
import { schema as identitySchema } from './GardenIdentity';
import { schema as paymentsSchema } from './PaymentProviders';
import { schema as donationSchema } from './AdoptionConfig';
import { schema as curatorSchema } from './CuratorConfig';
import { schema as enrichmentSchema } from './EnrichmentConfig';
import { schema as qrLabelSchema } from './QrLabelConfig';
import SettingsPage from './Settings';
import TranslationsPage from './Translations';
import { Page, PageHeader, Tabs } from './shared/ui';

type TabId =
  | 'identity'
  | 'payments'
  | 'donation'
  | 'curator'
  | 'enrichment'
  | 'qr'
  | 'translations'
  | 'advanced';

const TAB_DEFS: Array<{ value: TabId; label: string; hint: string }> = [
  { value: 'identity', label: 'Garden identity', hint: 'Name, IBAN, BIC, VAT id, address — everything that signs off as the Garden.' },
  { value: 'payments', label: 'Payments', hint: 'Toggle Paytrail / MobilePay / bank-transfer and paste merchant credentials.' },
  { value: 'donation', label: 'Donations', hint: 'Suggested amounts, default, custom-amount toggle, min/max, dedication limit.' },
  { value: 'curator', label: 'AskTheGarden', hint: 'Curator inbox + confidence floor for the donor Q&A.' },
  { value: 'enrichment', label: 'Enrichment worker', hint: '24/7 open-data backfill cadence + per-field auto-apply policy.' },
  { value: 'qr', label: 'QR label print', hint: 'Print dimensions, fields next to the QR, kiosk tracking embed.' },
  { value: 'translations', label: 'Translations', hint: 'Every UI string in EN / FI / SV — search, import, export.' },
  { value: 'advanced', label: 'All settings & flags', hint: 'Raw SystemSetting and FeatureFlag overview for power users.' },
];

function readHash(): TabId {
  if (typeof window === 'undefined') return 'identity';
  const raw = window.location.hash.replace('#', '');
  return (TAB_DEFS.find((t) => t.value === raw)?.value ?? 'identity') as TabId;
}

const ConfigurePage: React.FC = () => {
  const [tab, setTab] = useState<TabId>(readHash);

  useEffect(() => {
    const handler = () => setTab(readHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const setTabAndHash = (next: TabId) => {
    setTab(next);
    if (typeof window !== 'undefined') {
      const hash = `#${next}`;
      if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
    }
  };

  const body = useMemo(() => {
    switch (tab) {
      case 'identity':
        return <ConfigForm schema={identitySchema} />;
      case 'payments':
        return <ConfigForm schema={paymentsSchema} />;
      case 'donation':
        return <ConfigForm schema={donationSchema} />;
      case 'curator':
        return <ConfigForm schema={curatorSchema} />;
      case 'enrichment':
        return <ConfigForm schema={enrichmentSchema} />;
      case 'qr':
        return <ConfigForm schema={qrLabelSchema} />;
      case 'translations':
        return <TranslationsPage />;
      case 'advanced':
        return <SettingsPage />;
      default:
        return null;
    }
  }, [tab]);

  return (
    <div>
      <Page>
        <PageHeader
          kicker="Configuration hub"
          title="Configure"
          lede="Every system setting in one place. Pick a tab to focus on a single area; the form inside is the same one you used to find on its own sidebar entry."
        />
        <Tabs<TabId>
          value={tab}
          onChange={setTabAndHash}
          options={TAB_DEFS.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))}
        />
      </Page>
      <div style={{ marginTop: -16 }}>{body}</div>
    </div>
  );
};

export default ConfigurePage;
