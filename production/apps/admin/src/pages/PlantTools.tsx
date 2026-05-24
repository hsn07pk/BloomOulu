/**
 * Plant tools — single hub for daily curator workflow.
 *
 * Bundles four tabs that previously lived as separate sidebar entries
 * (Add plant, Enrichment review, Bulk QR print, Ingest RAG doc). One
 * sidebar link → tabbed UI on top.
 */
import React, { useEffect, useMemo, useState } from 'react';
import EnrichmentAssistant from './EnrichmentAssistant';
import EnrichmentReview from './EnrichmentReview';
import BulkQrPrint from './BulkQrPrint';
import IngestDoc from './IngestDoc';
import BulkAddPlants from './BulkAddPlants';
import { Page, PageHeader, Tabs } from './shared/ui';

type TabId = 'add' | 'add-bulk' | 'review' | 'print' | 'ingest';

const TAB_DEFS: Array<{ value: TabId; label: string; hint: string }> = [
  { value: 'add', label: 'Add plant', hint: 'Open-data assistant — fetch story / origin / status / photo for one species at a time.' },
  { value: 'add-bulk', label: 'Add many plants', hint: 'Paste a list of Latin names or upload Excel/CSV; the assistant enriches them in parallel and batch-creates the lot.' },
  { value: 'review', label: 'Enrichment review', hint: 'Approve or reject the 24/7 worker’s suggested updates.' },
  { value: 'print', label: 'Bulk QR print', hint: 'Print a multi-plant label sheet with the picker + sheet preset chooser.' },
  { value: 'ingest', label: 'Ingest RAG document', hint: 'Hand-write a new entry for the AskTheGarden knowledge corpus.' },
];

function readHash(): TabId {
  if (typeof window === 'undefined') return 'add';
  const raw = window.location.hash.replace('#', '');
  return (TAB_DEFS.find((t) => t.value === raw)?.value ?? 'add') as TabId;
}

const PlantToolsPage: React.FC = () => {
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
      case 'add':
        return <EnrichmentAssistant />;
      case 'add-bulk':
        return <BulkAddPlants />;
      case 'review':
        return <EnrichmentReview />;
      case 'print':
        return <BulkQrPrint />;
      case 'ingest':
        return <IngestDoc />;
      default:
        return null;
    }
  }, [tab]);

  return (
    <div>
      <Page>
        <PageHeader
          kicker="Daily workflow"
          title="Plant tools"
          lede="Tasks a curator runs week-in, week-out. Each tab is a focused workflow — add a new species, review what the worker found, print labels for a bed, or write a new knowledge entry."
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

export default PlantToolsPage;
