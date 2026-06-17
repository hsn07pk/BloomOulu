/**
 * BloomOulu admin dashboard — replaces the AdminJS default welcome page.
 *
 * Shows the operational metrics that matter for daily curator + admin
 * work: collection counts, recent donations, recent curator
 * escalations, recent emails sent, and a few quick-action shortcuts.
 *
 * Polled every 30 seconds (paused while the tab is hidden so we don't
 * burn the API at night). Stats are split by domain so a curator can
 * see at a glance whether the catalogue, donor flow, or RAG layer
 * needs attention.
 */
import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  HelpBanner,
  Notice,
  Page,
  PageHeader,
  Skeleton,
  StatGrid,
  StatTile,
  StatusPill,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface DashStats {
  plants: number;
  donors: number;
  donationsCompleted: number;
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/admin/dashboard-stats', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { stats: DashStats; recentEscalations?: Escalation[] };
        if (!alive) return;
        setStats(data.stats);
        setEscalations(data.recentEscalations ?? []);
        setErr(null);
        setLastUpdated(new Date());
      } catch (e) {
        if (!alive) return;
        setErr((e as Error).message);
      }
    }
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const moneyEur = (cents: number | undefined) =>
    cents == null ? '—' : `€${Math.round(cents / 100).toLocaleString('en-FI')}`;

  const queueAttention = (stats?.curatorEscalationsOpen ?? 0) > 0;
  const monthLabel = new Date().toLocaleString('en-FI', { month: 'long', year: 'numeric' });

  return (
    <Page>
      <PageHeader
        kicker="Operations overview"
        title="BloomOulu admin"
        lede="Welcome back — here’s a snapshot of the platform right now. Stats refresh every 30 seconds while this tab is visible."
        actions={
          lastUpdated ? (
            <span
              style={{
                fontSize: fontSize.sm,
                color: colors.inkMute,
                fontFamily: font.body,
              }}
              title={`Last updated: ${lastUpdated.toLocaleString()}`}
            >
              <StatusPill tone="success" dot>
                Live · {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </StatusPill>
            </span>
          ) : (
            <Skeleton width={120} height={26} radius={999} />
          )
        }
      />

      {err && (
        <Notice tone="danger" title="Couldn't refresh stats" onDismiss={() => setErr(null)}>
          {err}. The numbers below show the last successful snapshot.
        </Notice>
      )}

      <HelpBanner
        id="dashboard-intro"
        title="What you’re looking at"
      >
        The tiles below summarise the live platform. Numbers in <strong>terra</strong> mean
        something needs attention (e.g. open curator queue). Click any tile to jump straight to
        the matching list. Use the quick links lower down for tasks you run weekly.
      </HelpBanner>

      {/* ── Donor & donation metrics ───────────────────────────────── */}
      <Card
        kicker="Donor activity"
        title="This month in donations"
        description={`Live counts as of ${monthLabel}. The MTD figure is paid donations only — see Finance → Payments for full breakdown.`}
      >
        <StatGrid min={180}>
          <StatTile
            label="Donors (lifetime)"
            value={stats?.donors ?? <Skeleton width={64} height={28} />}
            hint="Unique email addresses on the User table with at least one donation attached."
            accent={colors.moss}
            href="/admin/resources/User"
          />
          <StatTile
            label="Completed donations"
            value={stats?.donationsCompleted ?? <Skeleton width={64} height={28} />}
            hint="Donations in status `completed`. Excludes pending, failed, refunded."
            accent={colors.olive}
            href="/admin/resources/Donation?filters.status=completed"
          />
          <StatTile
            label="MTD donations"
            value={stats ? moneyEur(stats.donationsMtdCents) : <Skeleton width={80} height={28} />}
            hint="Sum of paid donation amounts in the current calendar month (in cents, rendered as euros)."
            accent={colors.accent}
            href={`/admin/resources/Payment?filters.status=paid`}
          />
          <StatTile
            label="Plants in catalogue"
            value={stats?.plants ?? <Skeleton width={64} height={28} />}
            hint="Plant rows with status `active`. Hidden plants are excluded."
            accent={colors.forestMid}
            href="/admin/resources/Plant"
          />
        </StatGrid>
      </Card>

      {/* ── RAG & AskTheGarden ─────────────────────────────────────── */}
      <Card
        kicker="AskTheGarden health"
        title="Knowledge corpus & curator queue"
        description="The retrieval pipeline that powers donor questions. Watch the open queue — every unanswered escalation is a donor waiting."
      >
        <StatGrid min={180}>
          <StatTile
            label="Open curator queue"
            value={
              stats ? (
                stats.curatorEscalationsOpen
              ) : (
                <Skeleton width={64} height={28} />
              )
            }
            hint="AskAnswers with reaction=`escalated` and no curator reply yet."
            emphasis={queueAttention ? 'attention' : 'normal'}
            accent={queueAttention ? colors.accent : colors.olive}
            href="/admin/resources/AskAnswer?filters.reaction=escalated"
          />
          <StatTile
            label="Ask messages (7d)"
            value={stats?.askMessages7d ?? <Skeleton width={64} height={28} />}
            hint="Total donor questions in the past 7 days, including ones the AI answered confidently."
            accent={colors.moss}
            href="/admin/resources/AskMessage"
          />
          <StatTile
            label="RAG documents"
            value={stats?.ragDocs ?? <Skeleton width={64} height={28} />}
            hint="Indexed long-form documents (per-plant, family, conservation summaries, manual ingest)."
            accent={colors.teal}
            href="/admin/resources/RagDocument"
          />
          <StatTile
            label="Cached web pages"
            value={stats?.webCacheDocs ?? <Skeleton width={64} height={28} />}
            hint="Wikipedia / GBIF / laji.fi pages fetched once and cached locally."
            accent={colors.leaf}
          />
        </StatGrid>
      </Card>

      {/* ── Recent escalations ──────────────────────────────────────── */}
      <Card
        kicker="Needs a human"
        title="Recent curator escalations"
        description="The five most recent questions where the AI handed off to a curator. Reply in /admin → Ask answers."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              (window.location.href = '/admin/resources/AskAnswer?filters.reaction=escalated')
            }
          >
            Open queue →
          </Button>
        }
      >
        {!stats ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={48} />
            ))}
          </div>
        ) : escalations.length === 0 ? (
          <EmptyState
            variant="all-done"
            title="Inbox zero — no open escalations."
            description="When a donor question stumps the AI, it lands here for human review. You’re caught up."
          />
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {escalations.map((e) => (
              <li
                key={e.id}
                style={{
                  padding: `${space[3]} ${space[4]}`,
                  borderRadius: radius.md,
                  background: 'transparent',
                  transition: 'background 150ms ease',
                  cursor: 'pointer',
                }}
                onClick={() => (window.location.href = `/admin/resources/AskAnswer/records/${e.id}/show`)}
                onMouseEnter={(ev) => {
                  (ev.currentTarget as HTMLLIElement).style.background = colors.sagePale;
                }}
                onMouseLeave={(ev) => {
                  (ev.currentTarget as HTMLLIElement).style.background = 'transparent';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: fontSize.sm,
                    color: colors.inkMute,
                    marginBottom: 4,
                  }}
                >
                  <StatusPill tone="warn" dot>
                    Open
                  </StatusPill>
                  <span>{new Date(e.createdAt).toLocaleString()}</span>
                  <span aria-hidden="true">·</span>
                  <span>{e.email || 'anonymous donor'}</span>
                </div>
                <div
                  style={{
                    color: colors.forestDeep,
                    fontSize: fontSize.base,
                    lineHeight: 1.5,
                  }}
                >
                  {e.question}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Quick actions ──────────────────────────────────────────── */}
      <Card
        kicker="Shortcuts"
        title="Quick actions"
        description="The pages staff visit most often. Use the sidebar for the full navigation tree."
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          <QuickLink href="/admin/resources/Plant" icon="❀">
            Plants
            <small>Catalogue + Red List</small>
          </QuickLink>
          <QuickLink href="/admin/resources/Donation" icon="♥">
            Donations
            <small>Donor gift list + refunds</small>
          </QuickLink>
          <QuickLink href="/admin/resources/AskAnswer?filters.reaction=escalated" icon="✎">
            Curator queue
            <small>Open escalations</small>
          </QuickLink>
          <QuickLink href="/admin/resources/RagDocument" icon="◉">
            RAG documents
            <small>Knowledge corpus</small>
          </QuickLink>
          <QuickLink href="/admin/pages/configure#identity" icon="⚙">
            Configure
            <small>All settings in one place</small>
          </QuickLink>
          <QuickLink href="/admin/pages/configure#translations" icon="🌐">
            Translations
            <small>EN / FI / SV editor</small>
          </QuickLink>
          <QuickLink href="/admin/pages/operations#reconciliation" icon="✓">
            Reconciliation
            <small>Match bank CSV</small>
          </QuickLink>
          <QuickLink href="/admin/pages/operations#backups" icon="⛁">
            Backups
            <small>Snapshot & restore</small>
          </QuickLink>
          <QuickLink href="/admin/pages/plantTools#add" icon="✿">
            Add plant
            <small>Open-data assistant</small>
          </QuickLink>
          <QuickLink href="/admin/pages/plantTools#review" icon="✓">
            Enrichment review
            <small>Approve worker suggestions</small>
          </QuickLink>
          <QuickLink href="http://localhost:8025" icon="✉" external>
            MailHog inbox
            <small>Outbound mail in dev</small>
          </QuickLink>
        </div>
      </Card>

      {/* ── RAG maintenance ──────────────────────────────────────────── */}
      <Card
        kicker="Maintenance"
        title="RAG corpus rebuild"
        description="Forces the next cron tick (or the build scripts) to repopulate the family + conservation summary chunks from scratch. Use this after editing the family-biology source table or adding new species the summaries should cover. Per-plant chunks are not affected."
      >
        <RebuildButton />
      </Card>
    </Page>
  );
};

const RebuildButton: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  return (
    <div>
      <Button
        variant="danger"
        loading={busy}
        onClick={async () => {
          const confirmed = window.confirm(
            'Drop family + conservation summary RAG documents? They’ll be empty until the rebuild scripts run again.',
          );
          if (!confirmed) return;
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch('/admin/rebuild-summaries', {
              method: 'POST',
              credentials: 'include',
            });
            const data = (await res.json()) as { ok?: boolean; error?: string };
            setMsg(
              data.ok
                ? { kind: 'ok', text: 'Queued. Run the rebuild scripts to refill the corpus.' }
                : { kind: 'err', text: data.error ?? 'Unknown error' },
            );
          } catch (e) {
            setMsg({ kind: 'err', text: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Working…' : 'Drop summary chunks · force rebuild on next run'}
      </Button>
      {msg && (
        <div style={{ marginTop: 12 }}>
          <Notice tone={msg.kind === 'ok' ? 'success' : 'danger'} onDismiss={() => setMsg(null)} compact>
            {msg.text}
          </Notice>
        </div>
      )}
    </div>
  );
};

const QuickLink: React.FC<{
  href: string;
  external?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ href, external, icon, children }) => {
  // Children: first text node + optional <small> subtitle.
  const arr = React.Children.toArray(children);
  const main = arr.filter((c) => typeof c === 'string' || (React.isValidElement(c) && c.type !== 'small'));
  const sub = arr.find((c) => React.isValidElement(c) && c.type === 'small');
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 14px',
        borderRadius: radius.md,
        background: colors.cream,
        border: `1px solid ${colors.line}`,
        color: colors.forest,
        textDecoration: 'none',
        transition: 'all 150ms ease',
        alignItems: 'center',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = colors.sage;
        el.style.borderColor = colors.olive;
        el.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = colors.cream;
        el.style.borderColor = colors.line;
        el.style.transform = 'translateY(0)';
      }}
    >
      {icon && (
        <span
          aria-hidden="true"
          style={{
            fontSize: 18,
            color: colors.teal,
            flexShrink: 0,
            width: 22,
            textAlign: 'center',
          }}
        >
          {icon}
        </span>
      )}
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600, fontSize: fontSize.base }}>{main}</span>
        {sub}
      </span>
      <span aria-hidden="true" style={{ color: colors.inkFaint, fontSize: 16 }}>
        {external ? '↗' : '›'}
      </span>
    </a>
  );
};

export default Dashboard;
