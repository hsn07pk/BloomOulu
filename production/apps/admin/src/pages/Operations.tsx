/**
 * Operations — single hub for maintenance + finance utilities.
 *
 * Combines Bank reconciliation + Backups under one sidebar entry with
 * tabs. Same two workflows as before, just one click less to switch.
 */
import React, { useEffect, useMemo, useState } from 'react';
import BackupsPage from './Backups';
import ReconciliationPage from './Reconciliation';
import { Page, PageHeader, Tabs } from './shared/ui';

type TabId = 'reconciliation' | 'backups';

const TAB_DEFS: Array<{ value: TabId; label: string; hint: string }> = [
  { value: 'reconciliation', label: 'Bank reconciliation', hint: 'Upload the daily camt.054 / CSV and match RF references to pending orders.' },
  { value: 'backups', label: 'Backups', hint: 'On-demand JSON snapshots of the operational tables, written to the container’s local volume.' },
];

function readHash(): TabId {
  if (typeof window === 'undefined') return 'reconciliation';
  const raw = window.location.hash.replace('#', '');
  return (TAB_DEFS.find((t) => t.value === raw)?.value ?? 'reconciliation') as TabId;
}

const OperationsPage: React.FC = () => {
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
      case 'reconciliation':
        return <ReconciliationPage />;
      case 'backups':
        return <BackupsPage />;
      default:
        return null;
    }
  }, [tab]);

  return (
    <div>
      <Page>
        <PageHeader
          kicker="Maintenance"
          title="Operations"
          lede="Less-frequent tasks: matching the daily bank statement to pending orders, and snapshotting the database before risky changes."
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

export default OperationsPage;
