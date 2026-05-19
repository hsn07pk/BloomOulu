/**
 * BloomOulu admin dashboard — replaces the AdminJS default welcome page.
 *
 * Shows the operational metrics that matter for daily curator + admin
 * work: collection counts, recent donations, recent curator
 * escalations, recent emails sent, and a few quick-action shortcuts.
 *
 * Polled every 30 seconds. Components fetch via the AdminJS ApiClient
 * which carries the session cookie automatically.
 */
import React, { useEffect, useState } from 'react';
// AdminJS design system isn't a direct dep — render with plain HTML/CSS.
// This keeps the component working without adding @adminjs/design-system
// to apps/admin's package.json.

interface DashStats {
  plants: number;
  donors: number;
  adoptionsActive: number;
  donationsMtdCents: number;
  ragDocs: number;
  webCacheDocs: number;
  curatorEscalationsOpen: number;
  askMessages7d: number;
}

interface Escalation {
  id: string;
  email: string;
  question: string;
  createdAt: string;
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashStats | null>(null);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        // Lightweight admin dashboard endpoint on the API.
        const res = await fetch('/admin/dashboard-stats', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        setStats(data.stats);
        setEscalations(data.recentEscalations ?? []);
        setErr(null);
      } catch (e) {
        if (!alive) return;
        setErr((e as Error).message);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const wrap: React.CSSProperties = { padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif' };
  const h2: React.CSSProperties = { fontSize: 32, fontWeight: 600, margin: '0 0 8px', color: '#1F3C2D' };
  const lead: React.CSSProperties = { color: '#6B7560', marginBottom: 24 };

  return (
    <div style={wrap}>
      <h1 style={h2}>BloomOulu</h1>
      <p style={lead}>Welcome back — here's a snapshot of the platform right now.</p>

      {err && (
        <div style={{ padding: 12, background: '#FFF3EE', border: '1px solid #B8513A', borderRadius: 8, marginBottom: 16, color: '#B8513A' }}>
          Couldn't load dashboard stats: {err}
        </div>
      )}

      {/* ── Stats tiles ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <StatTile label="Plants in catalogue" value={stats?.plants ?? '—'} accent="#2D5440" />
        <StatTile label="Donors" value={stats?.donors ?? '—'} accent="#5FB0A0" />
        <StatTile label="Active adoptions" value={stats?.adoptionsActive ?? '—'} accent="#A8C060" />
        <StatTile label="MTD donations" value={stats ? `€${(stats.donationsMtdCents / 100).toFixed(0)}` : '—'} accent="#B8513A" />
        <StatTile label="RAG docs" value={stats?.ragDocs ?? '—'} accent="#88A050" />
        <StatTile label="Cached web entries" value={stats?.webCacheDocs ?? '—'} accent="#5FB0A0" />
        <StatTile label="Open curator queue" value={stats?.curatorEscalationsOpen ?? '—'} accent={(stats?.curatorEscalationsOpen ?? 0) > 0 ? '#B8513A' : '#88A050'} />
        <StatTile label="Ask messages 7d" value={stats?.askMessages7d ?? '—'} accent="#3D6A52" />
      </div>

      {/* ── Recent escalations ────────────────────────────────────── */}
      <h3 style={{ fontSize: 20, fontWeight: 500, marginTop: 32, marginBottom: 8, color: '#1F3C2D' }}>
        Recent curator escalations
      </h3>
      <div style={{ background: 'white', border: '1px solid #E5E2D8', borderRadius: 8, overflow: 'hidden' }}>
        {escalations.length === 0 ? (
          <div style={{ padding: 16, color: '#88897C' }}>No open escalations.</div>
        ) : (
          escalations.map((e) => (
            <div key={e.id} style={{ padding: 14, borderBottom: '1px solid #F2F0E8' }}>
              <div style={{ fontSize: 12, color: '#88897C' }}>
                {new Date(e.createdAt).toLocaleString()} · {e.email || 'anonymous'}
              </div>
              <div style={{ marginTop: 4, color: '#1F3C2D' }}>{e.question}</div>
            </div>
          ))
        )}
      </div>

      {/* ── Quick links ───────────────────────────────────────────── */}
      <h4 style={{ fontSize: 16, fontWeight: 500, marginTop: 32, marginBottom: 12, color: '#1F3C2D' }}>
        Quick actions
      </h4>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <QuickLink href="/admin/resources/Plant">Plants</QuickLink>
        <QuickLink href="/admin/resources/Adoption">Adoptions</QuickLink>
        <QuickLink href="/admin/resources/AskAnswer?filters.reaction=escalated">Curator queue</QuickLink>
        <QuickLink href="/admin/resources/RagDocument">RAG documents</QuickLink>
        <QuickLink href="/admin/resources/Tier">Tier prices</QuickLink>
        <QuickLink href="/admin/pages/Settings">Settings</QuickLink>
        <QuickLink href="/admin/pages/Reconciliation">Reconciliation</QuickLink>
        <QuickLink href="http://localhost:8025" external>MailHog inbox</QuickLink>
        <QuickLink href="http://localhost:3300" external>Grafana dashboards</QuickLink>
      </div>
    </div>
  );
};

const StatTile: React.FC<{ label: string; value: React.ReactNode; accent: string }> = ({
  label,
  value,
  accent,
}) => (
  <div
    style={{
      flex: '1 1 200px',
      minWidth: 160,
      padding: 16,
      background: 'white',
      borderLeft: `4px solid ${accent}`,
      borderRadius: 6,
      border: '1px solid #E5E2D8',
    }}
  >
    <div style={{ fontSize: 11, color: '#88897C', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </div>
    <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4, color: '#1F3C2D' }}>{value}</div>
  </div>
);

const QuickLink: React.FC<{ href: string; external?: boolean; children: React.ReactNode }> = ({
  href,
  external,
  children,
}) => (
  <a
    href={href}
    target={external ? '_blank' : undefined}
    rel={external ? 'noopener noreferrer' : undefined}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '8px 14px',
      borderRadius: 8,
      background: '#FAF7EE',
      border: '1px solid #E5E2D8',
      color: '#1F3C2D',
      textDecoration: 'none',
      fontSize: 14,
    }}
  >
    {children}{external ? ' ↗' : ''}
  </a>
);

export default Dashboard;
