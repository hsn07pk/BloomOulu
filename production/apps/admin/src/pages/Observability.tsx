/**
 * Observability hub — the technical operator's single screen for every
 * event, error, latency stat and system KPI the admin produces.
 *
 * Three sections:
 *   1. KPI tiles — uptime, memory, request volume + avg latency, error
 *      rate in the last hour vs day.
 *   2. Event search — filter by severity / source / free text / trace
 *      id / time window. Click any row to open the trace drawer with
 *      every related event sorted on a timeline.
 *   3. Recent errors — quick-glance list of the last 10 errors with
 *      a button to jump into the full trace.
 *
 * Auto-refreshes every 5 s while the tab is visible; pauses when
 * hidden so we don't burn the DB at night.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  FilterChip,
  HelpBanner,
  Notice,
  Page,
  PageHeader,
  SearchFilterBar,
  Skeleton,
  StatGrid,
  StatTile,
  StatusPill,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface ObsEvent {
  id: string;
  ts: string;
  severity: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  source: string;
  message: string;
  traceId: string | null;
  userId: string | null;
  durationMs: number | null;
  details: Record<string, unknown>;
}

interface KpiResponse {
  process: {
    uptimeSec: number;
    pid: number;
    nodeVersion: string;
    memRssMb: number;
    memHeapUsedMb: number;
    memHeapTotalMb: number;
  };
  last24h: { total: number; errors: number; warns: number };
  lastHour: { errors: number };
  http: { requestsLastHour: number; avgMsLastHour: number; maxMsLastHour: number };
  bySource: Array<{ source: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  recentErrors: ObsEvent[];
}

const SEVERITY_TONES: Record<ObsEvent['severity'], 'success' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  trace: 'neutral',
  debug: 'neutral',
  info: 'info',
  warn: 'warn',
  error: 'danger',
  fatal: 'danger',
};

const SOURCES = ['http', 'job', 'rag', 'enrich', 'payment', 'admin', 'system', 'external', 'db'];

const Observability: React.FC = () => {
  const [events, setEvents] = useState<ObsEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState<KpiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<string>('all');
  const [source, setSource] = useState<string>('all');
  const [windowMin, setWindowMin] = useState(60);
  const [detail, setDetail] = useState<{ event: ObsEvent; trace: ObsEvent[] } | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const reload = async () => {
    try {
      const since = new Date(Date.now() - windowMin * 60_000).toISOString();
      const params = new URLSearchParams({ since, limit: '300' });
      if (severity !== 'all') params.set('severity', severity);
      if (source !== 'all') params.set('source', source);
      if (debouncedSearch) params.set('q', debouncedSearch);
      const [eventsRes, kpiRes] = await Promise.all([
        fetch(`/admin/observability/events?${params}`, { credentials: 'include' }),
        fetch(`/admin/observability/kpis`, { credentials: 'include' }),
      ]);
      if (!eventsRes.ok) throw new Error(`events HTTP ${eventsRes.status}`);
      if (!kpiRes.ok) throw new Error(`kpis HTTP ${kpiRes.status}`);
      const eData = (await eventsRes.json()) as { events: ObsEvent[]; total: number };
      const kData = (await kpiRes.json()) as KpiResponse;
      setEvents(eData.events);
      setTotal(eData.total);
      setKpis(kData);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void reload();
    }, 5000);
    return () => window.clearInterval(id);
  }, [debouncedSearch, severity, source, windowMin]);

  async function openDetail(eventId: string) {
    try {
      const res = await fetch(`/admin/observability/events/${eventId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { event: ObsEvent; trace: ObsEvent[] };
      setDetail(data);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const errorRate24h = useMemo(() => {
    if (!kpis || kpis.last24h.total === 0) return 0;
    return (kpis.last24h.errors / kpis.last24h.total) * 100;
  }, [kpis]);

  return (
    <Page>
      <PageHeader
        kicker="Technical health"
        title="Observability"
        lede="Every event the admin produces — request, job, RAG ingest, error — is persisted here. Search, filter, and click any row to see the full trace. Auto-refreshes every 5 seconds."
        actions={
          <Button variant="secondary" onClick={() => void reload()}>
            Refresh now
          </Button>
        }
      />

      <HelpBanner id="observability-intro" title="What this page is for">
        Use this when something looks wrong — a slow page, a failed job, a webhook that didn’t
        fire. The event log captures structured data + a stack-trace for every error, grouped by
        a trace id so one click expands the full chain of related events. KPI tiles up top show
        process health (memory, uptime, request latency, error rate).
      </HelpBanner>

      {err && <Notice tone="danger" onDismiss={() => setErr(null)}>{err}</Notice>}

      <Card title="System health" description="Live process + traffic metrics. Updated every 5 s.">
        {!kpis ? (
          <StatGrid min={180}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={120} radius={14} />
            ))}
          </StatGrid>
        ) : (
          <StatGrid min={180}>
            <StatTile
              label="Uptime"
              value={formatDuration(kpis.process.uptimeSec)}
              hint={`Node ${kpis.process.nodeVersion} · pid ${kpis.process.pid}`}
              accent={colors.forestMid}
            />
            <StatTile
              label="Memory · RSS"
              value={`${kpis.process.memRssMb} MB`}
              hint={`Heap used ${kpis.process.memHeapUsedMb} / ${kpis.process.memHeapTotalMb} MB`}
              accent={colors.moss}
            />
            <StatTile
              label="HTTP req/h"
              value={kpis.http.requestsLastHour.toLocaleString()}
              hint="Number of HTTP requests in the last hour."
              accent={colors.teal}
            />
            <StatTile
              label="Avg latency"
              value={`${Math.round(kpis.http.avgMsLastHour)} ms`}
              hint={`Max in window: ${Math.round(kpis.http.maxMsLastHour)} ms`}
              accent={colors.olive}
            />
            <StatTile
              label="Errors (1 h)"
              value={kpis.lastHour.errors.toLocaleString()}
              hint="Severity error or fatal in the last hour."
              accent={colors.accent}
              emphasis={kpis.lastHour.errors > 0 ? 'attention' : 'normal'}
            />
            <StatTile
              label="Error rate (24 h)"
              value={`${errorRate24h.toFixed(2)} %`}
              hint={`${kpis.last24h.errors} of ${kpis.last24h.total} events in the last 24 h.`}
              accent={colors.accent}
              emphasis={errorRate24h > 5 ? 'attention' : 'normal'}
            />
          </StatGrid>
        )}
      </Card>

      <SearchFilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search event messages — substring match…"
        searchHint="Matches anywhere in the message text. Combine with severity / source filters."
        filters={
          <>
            <FilterChip
              active={severity === 'all'}
              label="All severities"
              onClick={() => setSeverity('all')}
            />
            <FilterChip
              active={severity === 'error'}
              label="Errors"
              tone="accent"
              onClick={() => setSeverity('error')}
            />
            <FilterChip
              active={severity === 'warn'}
              label="Warnings"
              onClick={() => setSeverity('warn')}
            />
            <FilterChip
              active={severity === 'info'}
              label="Info"
              onClick={() => setSeverity('info')}
            />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 4px 2px 10px',
                borderRadius: 999,
                background: source !== 'all' ? colors.sage : colors.cream,
                border: `1px solid ${source !== 'all' ? colors.olive : colors.line}`,
              }}
            >
              <label
                htmlFor="obs-source"
                style={{ fontSize: fontSize.sm, color: colors.inkMute }}
              >
                Source:
              </label>
              <select
                id="obs-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: fontSize.sm,
                  color: colors.forest,
                  fontWeight: 500,
                  padding: '4px 8px 4px 4px',
                  cursor: 'pointer',
                  fontFamily: font.body,
                }}
              >
                <option value="all">all</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 4px 2px 10px',
                borderRadius: 999,
                background: colors.cream,
                border: `1px solid ${colors.line}`,
              }}
            >
              <label
                htmlFor="obs-window"
                style={{ fontSize: fontSize.sm, color: colors.inkMute }}
              >
                Window:
              </label>
              <select
                id="obs-window"
                value={windowMin}
                onChange={(e) => setWindowMin(parseInt(e.target.value, 10))}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: fontSize.sm,
                  color: colors.forest,
                  fontWeight: 500,
                  padding: '4px 8px 4px 4px',
                  cursor: 'pointer',
                  fontFamily: font.body,
                }}
              >
                <option value={5}>last 5 min</option>
                <option value={60}>last hour</option>
                <option value={360}>last 6 hours</option>
                <option value={1440}>last 24 hours</option>
                <option value={10080}>last 7 days</option>
              </select>
            </span>
          </>
        }
        activeFilterCount={
          (search ? 1 : 0) + (severity !== 'all' ? 1 : 0) + (source !== 'all' ? 1 : 0)
        }
        onClearAll={() => {
          setSearch('');
          setSeverity('all');
          setSource('all');
        }}
        resultCount={events?.length ?? 0}
        totalCount={total}
        resultLabel="events"
      />

      <Card flush>
        {!events ? (
          <div style={{ padding: space[5] }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <Skeleton height={36} />
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="No events match your filters"
            description="Broaden the time window or clear filters. The admin server logs every request automatically — if nothing's here, nothing happened."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setSeverity('all');
                  setSource('all');
                  setWindowMin(1440);
                }}
              >
                Clear filters · widen to 24 h
              </Button>
            }
          />
        ) : (
          <div style={{ maxHeight: 600, overflowY: 'auto' }}>
            {events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => void openDetail(e.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '170px 100px 90px 1fr 80px',
                  gap: space[3],
                  width: '100%',
                  alignItems: 'center',
                  padding: `${space[2]} ${space[4]}`,
                  borderBottom: `1px solid ${colors.lineSoft}`,
                  background: 'transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: font.body,
                  border: 'none',
                  borderRadius: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: colors.inkMute,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  title={new Date(e.ts).toISOString()}
                >
                  {new Date(e.ts).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <StatusPill tone={SEVERITY_TONES[e.severity]}>
                  {e.severity}
                </StatusPill>
                <code
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: colors.moss,
                    fontWeight: 500,
                  }}
                >
                  {e.source}
                </code>
                <span
                  style={{
                    fontSize: fontSize.sm,
                    color: colors.inkSoft,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e.message}
                </span>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: e.durationMs && e.durationMs > 500 ? colors.accent : colors.inkFaint,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {e.durationMs != null ? `${e.durationMs} ms` : '—'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {detail && (
        <DetailDrawer
          event={detail.event}
          trace={detail.trace}
          onClose={() => setDetail(null)}
        />
      )}
    </Page>
  );
};

const DetailDrawer: React.FC<{
  event: ObsEvent;
  trace: ObsEvent[];
  onClose: () => void;
}> = ({ event, trace, onClose }) => (
  <div
    role="dialog"
    aria-modal="true"
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(22, 48, 31, 0.4)',
      zIndex: 300,
      display: 'flex',
      justifyContent: 'flex-end',
      animation: 'bo-fade-in 180ms ease',
    }}
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div
      style={{
        background: colors.paper,
        width: 'min(720px, 90vw)',
        height: '100vh',
        overflowY: 'auto',
        boxShadow: '-12px 0 32px rgba(31, 60, 45, 0.15)',
        padding: space[6],
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: space[3],
          marginBottom: space[4],
        }}
      >
        <div>
          <div
            style={{
              fontSize: fontSize.xs,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: colors.moss,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Event detail
          </div>
          <h2
            style={{
              fontFamily: font.display,
              fontSize: fontSize.xl,
              color: colors.forestDeep,
              margin: 0,
              wordBreak: 'break-word',
            }}
          >
            {event.message}
          </h2>
          <div style={{ marginTop: space[2], display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <StatusPill tone={SEVERITY_TONES[event.severity]}>{event.severity}</StatusPill>
            <StatusPill tone="neutral" dot={false}>
              {event.source}
            </StatusPill>
            {event.durationMs != null && (
              <StatusPill tone="neutral" dot={false}>
                {event.durationMs} ms
              </StatusPill>
            )}
            <span style={{ fontSize: fontSize.sm, color: colors.inkMute }}>
              {new Date(event.ts).toLocaleString()}
            </span>
          </div>
          {event.traceId && (
            <div
              style={{
                marginTop: space[2],
                fontSize: fontSize.sm,
                color: colors.inkMute,
                fontFamily: font.mono,
              }}
            >
              trace: <code>{event.traceId}</code>
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close ×
        </Button>
      </div>

      <Card title="Payload">
        <pre
          style={{
            margin: 0,
            padding: `${space[3]} ${space[4]}`,
            background: colors.cream,
            borderRadius: radius.sm,
            fontFamily: font.mono,
            fontSize: 12,
            color: colors.ink,
            lineHeight: 1.55,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {JSON.stringify(event.details ?? {}, null, 2)}
        </pre>
      </Card>

      {trace.length > 1 ? (
        <TraceTimeline event={event} trace={trace} />
      ) : null}
    </div>
    </div>
  );

const TraceTimeline: React.FC<{ event: ObsEvent; trace: ObsEvent[] }> = ({ event, trace }) => (
  <Card
    kicker={`${trace.length - 1} related events`}
    title="Trace timeline"
    description={`Every event recorded with the same trace id (${event.traceId?.slice(0, 8)}…), in time order.`}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {trace.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 70px 1fr 60px',
            gap: space[2],
            alignItems: 'center',
            padding: '6px 10px',
            background: t.id === event.id ? colors.sage : 'transparent',
            borderRadius: radius.sm,
            fontSize: fontSize.sm,
            borderLeft:
              t.id === event.id
                ? `3px solid ${colors.forestMid}`
                : '3px solid transparent',
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              color: colors.inkMute,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {new Date(t.ts).toLocaleTimeString()}
          </span>
          <StatusPill tone={SEVERITY_TONES[t.severity]} dot={false}>
            {t.severity}
          </StatusPill>
          <span
            style={{
              color: colors.inkSoft,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.message}
          </span>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              color: colors.inkFaint,
              textAlign: 'right',
            }}
          >
            {t.durationMs != null ? `${t.durationMs} ms` : ''}
          </span>
        </div>
      ))}
    </div>
  </Card>
);

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export default Observability;
