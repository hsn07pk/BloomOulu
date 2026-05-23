/**
 * Local-storage backups admin page.
 *
 * The container writes JSON dumps to STORAGE_DIR/backups/<timestamp>.json
 * each time "Run backup now" is clicked. Each backup contains snapshots
 * of the core operational tables (Plant, Tier, Adoption, PlantScan,
 * Translation, SystemSetting, AuditLog) so the garden can restore from
 * one file without depending on cloud storage.
 */
import React, { useEffect, useState } from 'react';

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
  const [log, setLog] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  async function loadList() {
    try {
      const r = await fetch('/admin/backups');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { snapshots: Snapshot[] };
      setSnapshots(d.snapshots ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void loadList();
  }, []);

  async function runBackup() {
    setBusy(true);
    setLog('Capturing snapshot…');
    setErr(null);
    try {
      const res = await fetch('/admin/backups/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      const counts = Object.entries(json.tables ?? {})
        .map(([t, n]) => `${t}=${n}`)
        .join(' · ');
      setLog(`Snapshot ${json.id} written (${counts}).`);
      await loadList();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Backups</h1>
      <p style={{ color: '#555' }}>
        Snapshots are written locally to <code>STORAGE_DIR/backups/</code> — no cloud upload.
        Each file is a JSON dump of the core operational tables. Restore by piping the file
        through <code>scripts/restore-backup.ts</code> (see runbook).
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={runBackup}
          disabled={busy}
          style={{
            padding: '8px 16px',
            background: '#1F3A2C',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Running…' : 'Run backup now'}
        </button>
        <button onClick={loadList} disabled={busy} style={{ padding: '8px 12px' }}>
          Refresh
        </button>
      </div>
      {err && (
        <div role="alert" style={{ marginTop: 12, padding: 10, background: '#FFF3EE', color: '#B8513A', borderRadius: 6 }}>
          {err}
        </div>
      )}
      {log && (
        <pre style={{ background: '#f4f7ef', padding: 12, marginTop: 12, fontSize: 12, overflowX: 'auto' }}>{log}</pre>
      )}
      <h2 style={{ marginTop: 24, fontSize: 18 }}>Recent snapshots</h2>
      {snapshots.length === 0 ? (
        <p style={{ color: '#666' }}>No snapshots yet. Click "Run backup now" to create the first.</p>
      ) : (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '6px' }}>Time</th>
              <th style={{ padding: '6px' }}>ID</th>
              <th style={{ padding: '6px' }}>Size</th>
              <th style={{ padding: '6px' }}>Tables</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px' }}>{new Date(s.time).toLocaleString()}</td>
                <td style={{ padding: '6px', fontFamily: 'ui-monospace, monospace' }}>{s.id}</td>
                <td style={{ padding: '6px' }}>{s.sizeBytes ? `${(s.sizeBytes / 1024).toFixed(1)} kB` : '—'}</td>
                <td style={{ padding: '6px', fontSize: 11, color: '#666' }}>
                  {Object.entries(s.tables ?? {})
                    .map(([t, n]) => `${t}:${n}`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default BackupsPage;
