/**
 * Local-storage backups admin page.
 *
 * The container writes JSON dumps to STORAGE_DIR/backups/<timestamp>.json
 * each time "Run backup now" is clicked. Each backup contains snapshots
 * of the core operational tables (Plant, Tier, Adoption, PlantScan,
 * Translation, SystemSetting, AuditLog) so the garden can restore from
 * one file without depending on cloud storage.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  HelpBanner,
  Notice,
  Page,
  PageHeader,
  SearchFilterBar,
  Skeleton,
  StatusPill,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface Snapshot {
  id: string;
  time: string;
  sizeBytes?: number;
  filename: string;
  tables: Record<string, number>;
}

const BackupsPage: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  async function loadList() {
    setLoading(true);
    try {
      const r = await fetch('/admin/backups', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { snapshots: Snapshot[] };
      setSnapshots(d.snapshots ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
  }, []);

  async function runBackup() {
    setBusy(true);
    setOkMsg(null);
    setErr(null);
    try {
      const res = await fetch('/admin/backups/run', {
        method: 'POST',
        credentials: 'include',
      });
      const json = (await res.json()) as {
        id?: string;
        tables?: Record<string, number>;
        message?: string;
      };
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      const counts = Object.entries(json.tables ?? {})
        .map(([t, n]) => `${t}=${n}`)
        .join(' · ');
      setOkMsg(`Snapshot ${json.id} written. ${counts}`);
      await loadList();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return snapshots;
    return snapshots.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        new Date(s.time).toLocaleString().toLowerCase().includes(q),
    );
  }, [snapshots, debouncedSearch]);

  return (
    <Page>
      <PageHeader
        kicker="Maintenance"
        title="Backups"
        lede="On-demand snapshots of the operational tables. Each backup is a single JSON file written to the container’s local volume — no cloud upload, no third-party data exposure."
        actions={
          <>
            <Button variant="secondary" onClick={loadList} disabled={busy || loading}>
              Refresh
            </Button>
            <Button variant="primary" onClick={runBackup} loading={busy} leftIcon="⛁">
              {busy ? 'Capturing…' : 'Run backup now'}
            </Button>
          </>
        }
      />

      <HelpBanner id="backups-intro" title="When and how to restore">
        Snapshots cover the operationally critical tables only (Plant, Tier, Adoption, PlantScan,
        Translation, SystemSetting, AuditLog). Restore is a manual step — pipe the file through
        <code style={{ background: colors.cream, padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>
          scripts/restore-backup.ts
        </code>
        as described in the runbook. Take a fresh snapshot before any risky migration.
      </HelpBanner>

      {err && (
        <Notice tone="danger" title="Couldn't list backups" onDismiss={() => setErr(null)}>
          {err}
        </Notice>
      )}
      {okMsg && (
        <Notice tone="success" onDismiss={() => setOkMsg(null)}>
          {okMsg}
        </Notice>
      )}

      <SearchFilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search by date or snapshot id…"
        resultCount={visible.length}
        totalCount={snapshots.length}
        resultLabel="snapshots"
      />

      <Card flush>
        {loading ? (
          <div style={{ padding: space[5] }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <Skeleton height={48} />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            variant={snapshots.length === 0 ? 'idle' : 'no-results'}
            title={
              snapshots.length === 0
                ? 'No snapshots yet'
                : 'Nothing matches your search'
            }
            description={
              snapshots.length === 0
                ? 'Click "Run backup now" above to create the first snapshot. It only takes a few seconds.'
                : 'Try a different date fragment or clear the search.'
            }
            action={
              snapshots.length === 0 ? (
                <Button variant="primary" onClick={runBackup} loading={busy}>
                  Run first backup
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              )
            }
          />
        ) : (
          <DataTable
            columns={[
              {
                key: 'time',
                label: 'When',
                width: 220,
                render: (s) => (
                  <span title={s.time}>
                    <strong style={{ color: colors.forest }}>
                      {new Date(s.time).toLocaleString()}
                    </strong>
                  </span>
                ),
              },
              {
                key: 'id',
                label: 'Snapshot ID',
                render: (s) => (
                  <code
                    style={{
                      fontFamily: font.mono,
                      fontSize: 12,
                      color: colors.inkSoft,
                    }}
                  >
                    {s.id}
                  </code>
                ),
              },
              {
                key: 'size',
                label: 'Size',
                align: 'right',
                width: 100,
                render: (s) =>
                  s.sizeBytes != null ? `${(s.sizeBytes / 1024).toFixed(1)} kB` : '—',
              },
              {
                key: 'tables',
                label: 'Rows captured',
                render: (s) => (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 4,
                    }}
                  >
                    {Object.entries(s.tables ?? {}).map(([t, n]) => (
                      <StatusPill key={t} tone="neutral" dot={false}>
                        {t}:{' '}
                        <span
                          style={{
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                          }}
                        >
                          {n.toLocaleString()}
                        </span>
                      </StatusPill>
                    ))}
                  </div>
                ),
              },
              {
                key: 'actions',
                label: '',
                align: 'right',
                width: 160,
                render: (s) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      (window.location.href = `/admin/backups/${encodeURIComponent(s.id)}/download`)
                    }
                    leftIcon="⬇"
                  >
                    Download
                  </Button>
                ),
              },
            ]}
            rows={visible}
            rowKey={(s) => s.id}
            stickyHeader
          />
        )}
      </Card>
    </Page>
  );
};

export default BackupsPage;
