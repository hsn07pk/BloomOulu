/**
 * Admin · QR scan metrics page.
 *
 * Three tiles, sourced from /v1/admin/metrics:
 *   1. Funnel    — scans / unique visitors / scanned plants / adoptions
 *                  / conversion %
 *   2. Top scanned plants — leaderboard with lifetime vs. window counts
 *   3. Timeline  — daily scans for the window
 *
 * Polled on mount; refresh button re-fetches without reloading the page.
 * Window length (1–365 days) is picked from a dropdown; defaults to 30.
 */
import React, { useEffect, useState, useCallback } from 'react';

interface FunnelStats {
  windowStart: string;
  totalScans: number;
  uniqueVisitors: number;
  uniqueScannedPlants: number;
  adoptionsAfterScan: number;
  conversionRate: number;
}

interface LeaderboardItem {
  plantId: string;
  slug: string;
  latinName: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  scansInWindow: number;
  scanCountLifetime: number;
  adopterCount: number;
  primaryImageUrl: string | null;
}

interface TimelinePoint {
  day: string;
  count: number;
}

const WINDOWS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last year' },
];

async function authedJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

const QrMetrics: React.FC = () => {
  const [days, setDays] = useState(30);
  const [funnel, setFunnel] = useState<FunnelStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const base = `/v1/admin/metrics`;
      const [f, l, t] = await Promise.all([
        authedJson<FunnelStats>(`${base}/funnel?days=${days}`),
        authedJson<{ items: LeaderboardItem[] }>(`${base}/qr?days=${days}&limit=20`),
        authedJson<{ points: TimelinePoint[] }>(`${base}/qr/timeline?days=${days}`),
      ]);
      setFunnel(f);
      setLeaderboard(l.items);
      setTimeline(t.points);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const maxBar = Math.max(1, ...timeline.map((p) => p.count));

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>QR scan metrics</h1>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          aria-label="Window"
          style={{ padding: '6px 10px', borderRadius: 6 }}
        >
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
        <button onClick={refresh} disabled={loading} style={{ padding: '6px 14px' }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {err && (
        <div role="alert" style={{ background: '#FFF3EE', color: '#B8513A', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {err}
        </div>
      )}

      {funnel && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 28 }}>
          <Tile label="Total scans" value={funnel.totalScans.toLocaleString()} />
          <Tile label="Unique visitors" value={funnel.uniqueVisitors.toLocaleString()} />
          <Tile label="Plants scanned" value={funnel.uniqueScannedPlants.toLocaleString()} />
          <Tile label="Adoptions after scan" value={funnel.adoptionsAfterScan.toLocaleString()} />
          <Tile label="Conversion" value={`${(funnel.conversionRate * 100).toFixed(1)}%`} />
        </section>
      )}

      {timeline.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 10 }}>Daily scans</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140, padding: '4px 0' }}>
            {timeline.map((p) => {
              const h = (p.count / maxBar) * 100;
              const d = new Date(p.day);
              return (
                <div
                  key={p.day}
                  title={`${d.toISOString().slice(0, 10)} · ${p.count} scans`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
                >
                  <div
                    style={{
                      height: `${h}%`,
                      background: '#1F3A2C',
                      borderRadius: '4px 4px 0 0',
                      minHeight: p.count > 0 ? 2 : 0,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666', marginTop: 4 }}>
            <span>{timeline[0]?.day.slice(0, 10)}</span>
            <span>{timeline[timeline.length - 1]?.day.slice(0, 10)}</span>
          </div>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>Top scanned plants</h2>
        {leaderboard.length === 0 ? (
          <p style={{ color: '#666' }}>No scans recorded in the selected window.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>Plant</th>
                <th style={{ padding: '8px 6px' }}>Red List</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Scans in window</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Lifetime scans</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Adopters</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((p) => (
                <tr key={p.plantId} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <a
                      href={`/admin/resources/Plant/records/${p.plantId}/show`}
                      style={{ color: '#1F3A2C', textDecoration: 'none' }}
                    >
                      <span style={{ fontStyle: 'italic' }}>{p.latinName}</span>
                      <br />
                      <span style={{ fontSize: 12, color: '#666' }}>{p.nameEn}</span>
                    </a>
                  </td>
                  <td style={{ padding: '8px 6px' }}>{p.redListStatus}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{p.scansInWindow}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{p.scanCountLifetime}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{p.adopterCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 14,
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666' }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: 'ui-monospace, monospace', marginTop: 6, color: '#1F3A2C' }}>{value}</div>
    </div>
  );
}

export default QrMetrics;
