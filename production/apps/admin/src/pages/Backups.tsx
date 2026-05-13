import React, { useEffect, useState } from 'react';

interface Snapshot {
  id: string;
  time: string;
  paths: string[];
  size?: number;
}

const BackupsPage: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>('');

  useEffect(() => {
    fetch('/admin-api/backups')
      .then((r) => r.json())
      .then((d) => setSnapshots(d.snapshots ?? []));
  }, []);

  async function runBackup() {
    setBusy(true);
    setLog('Triggering backup…');
    try {
      const res = await fetch('/admin-api/backups/run', { method: 'POST' });
      const json = await res.json();
      setLog(json.log ?? 'Started. Check Grafana → Backups dashboard for progress.');
    } catch (e: any) {
      setLog(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Backups</h1>
      <p>
        Daily encrypted backups via <code>restic</code>. Stored in MinIO and a
        weekly off-VPS copy. To restore, follow <code>docs/runbook/restore-from-backup.md</code>.
      </p>
      <button onClick={runBackup} disabled={busy}>
        {busy ? 'Running…' : 'Run backup now'}
      </button>
      {log && <pre style={{ background: '#f4f7ef', padding: 12, marginTop: 12 }}>{log}</pre>}
      <h2 style={{ marginTop: 24 }}>Recent snapshots</h2>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr><th align="left">Time</th><th align="left">ID</th><th align="left">Size</th></tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.time).toLocaleString()}</td>
              <td style={{ fontFamily: 'monospace' }}>{s.id.slice(0, 12)}</td>
              <td>{s.size ? `${(s.size / 1e6).toFixed(1)} MB` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default BackupsPage;
