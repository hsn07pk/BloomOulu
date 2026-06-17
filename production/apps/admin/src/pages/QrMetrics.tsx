/**
 * Admin · QR scan metrics page.
 *
 * Three sections, sourced from /v1/admin/metrics:
 *   1. Funnel    — scans / unique visitors / scanned plants / donations
 *                  / conversion %
 *   2. Top scanned plants — leaderboard with lifetime vs. window counts
 *   3. Timeline  — daily scans for the window with hover-able bars
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterChip,
  HelpBanner,
  Notice,
  Page,
  PageHeader,
  Skeleton,
  StatGrid,
  StatTile,
  StatusPill,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface FunnelStats {
  windowStart: string;
  totalScans: number;
  uniqueVisitors: number;
  uniqueScannedPlants: number;
  donationsAfterScan: number;
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
  donorCount: number;
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

// The api guards /v1/admin/* with RolesGuard, which needs an HS256 Bearer JWT
// — the AdminJS session cookie alone yields 401. The dashboard handler mints
// one for the logged-in admin (GET /admin/api/dashboard); fetch it once,
// cache it, and attach it. On 401 the token may have expired (12h TTL) — drop
// the cache and retry once.
let cachedApiToken: string | null = null;
async function apiToken(force = false): Promise<string | null> {
  if (cachedApiToken && !force) return cachedApiToken;
  try {
    const res = await new ApiClient().getDashboard();
    cachedApiToken = (res.data as { apiToken?: string | null })?.apiToken ?? null;
  } catch {
    cachedApiToken = null;
  }
  return cachedApiToken;
}

async function authedJson<T>(url: string): Promise<T> {
  const send = (token: string | null) =>
    fetch(url, {
      credentials: 'include',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  let res = await send(await apiToken());
  if (res.status === 401) res = await send(await apiToken(true));
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
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [redListFilter, setRedListFilter] = useState<string>('all');

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

  const visibleLeaderboard = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return leaderboard.filter((p) => {
      if (redListFilter !== 'all' && p.redListStatus !== redListFilter) return false;
      if (!q) return true;
      return (
        p.latinName.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        p.nameFi.toLowerCase().includes(q) ||
        p.nameSv.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q)
      );
    });
  }, [leaderboard, debouncedSearch, redListFilter]);

  const redListCounts = useMemo(() => {
    const out: Record<string, number> = { all: leaderboard.length };
    for (const p of leaderboard) {
      out[p.redListStatus] = (out[p.redListStatus] ?? 0) + 1;
    }
    return out;
  }, [leaderboard]);

  return (
    <Page>
      <PageHeader
        kicker="Analytics"
        title="QR scan metrics"
        lede="Every printed QR encodes the plant URL with `?qr=1`, so visits from physical labels can be split from organic web traffic. Use this page to spot which plants get the most attention and how that converts to donations."
        actions={
          <>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              aria-label="Time window"
              title="Time window for all numbers on this page"
              style={{
                padding: '8px 12px',
                borderRadius: radius.md,
                border: `1px solid ${colors.line}`,
                background: colors.cream,
                fontFamily: font.body,
                fontSize: fontSize.base,
                color: colors.forest,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={refresh} loading={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        }
      />

      {err && (
        <Notice tone="danger" title="Couldn't load metrics" onDismiss={() => setErr(null)}>
          {err}
        </Notice>
      )}

      <HelpBanner id="qr-metrics-intro" title="Reading the funnel">
        <strong>Total scans</strong> counts every QR hit, including repeat visits and the same
        visitor scanning multiple plants. <strong>Unique visitors</strong> is per browser session
        cookie. <strong>Conversion</strong> divides post-scan donations by unique visitors, so a
        rate near 1% is healthy for a botanical-garden audience.
      </HelpBanner>

      <Card
        kicker={`Funnel · ${WINDOWS.find((w) => w.value === days)?.label.toLowerCase()}`}
        title="Scan → donation funnel"
      >
        {loading && !funnel ? (
          <StatGrid min={180}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={120} radius={14} />
            ))}
          </StatGrid>
        ) : funnel ? (
          <StatGrid min={180}>
            <StatTile
              label="Total scans"
              value={funnel.totalScans.toLocaleString()}
              hint="Every QR hit recorded in PlantScan, including repeat visits."
              accent={colors.forestMid}
            />
            <StatTile
              label="Unique visitors"
              value={funnel.uniqueVisitors.toLocaleString()}
              hint="Distinct anonymised session cookies. Resets every 30 days."
              accent={colors.moss}
            />
            <StatTile
              label="Plants scanned"
              value={funnel.uniqueScannedPlants.toLocaleString()}
              hint="How many distinct Plant rows received at least one scan."
              accent={colors.olive}
            />
            <StatTile
              label="Donations after scan"
              value={funnel.donationsAfterScan.toLocaleString()}
              hint="Completed donations whose donor scanned this plant in the time window before donating."
              accent={colors.leaf}
            />
            <StatTile
              label="Conversion"
              value={`${(funnel.conversionRate * 100).toFixed(1)}%`}
              hint="donationsAfterScan / uniqueVisitors. 0.5–2% is healthy for botanical-garden traffic."
              accent={colors.accent}
              emphasis={funnel.conversionRate > 0 ? 'normal' : 'attention'}
            />
          </StatGrid>
        ) : null}
      </Card>

      <Card
        kicker="Activity"
        title="Daily scans"
        description={`Bar height is relative to the busiest day in the window (max = ${maxBar.toLocaleString()} scans).`}
      >
        {loading && timeline.length === 0 ? (
          <Skeleton height={160} />
        ) : timeline.length === 0 ? (
          <EmptyState
            variant="idle"
            title="No scans recorded in this window."
            description="Try a wider time window, or check that the QR labels are out in the garden."
          />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: timeline.length > 90 ? 1 : timeline.length > 30 ? 2 : 4,
                height: 180,
                padding: `${space[2]} 0 ${space[4]}`,
                borderBottom: `1px dashed ${colors.lineSoft}`,
              }}
            >
              {timeline.map((p) => {
                // Zero days render as an empty column (with a 1-px floor
                // line via the parent border) so real scan days stand out
                // visually. Earlier the 2 % minimum height made every day
                // look identical to a 1-scan day.
                const h = p.count === 0 ? 0 : Math.max(6, (p.count / maxBar) * 100);
                const d = new Date(p.day);
                return (
                  <div
                    key={p.day}
                    title={`${d.toLocaleDateString()} · ${p.count} scan${p.count === 1 ? '' : 's'}`}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      minWidth: 0,
                    }}
                  >
                    {h > 0 && (
                      <div
                        style={{
                          height: `${h}%`,
                          background: `linear-gradient(to top, ${colors.forestMid}, ${colors.leaf})`,
                          borderRadius: '4px 4px 0 0',
                          transition: 'background 200ms ease',
                          minHeight: 4,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: fontSize.sm,
                color: colors.inkMute,
              }}
            >
              <span>{timeline[0]?.day.slice(0, 10)}</span>
              <span>{timeline[timeline.length - 1]?.day.slice(0, 10)}</span>
            </div>
          </>
        )}
      </Card>

      <Card
        kicker={`Top ${leaderboard.length} of ${WINDOWS.find((w) => w.value === days)?.label.toLowerCase()}`}
        title="Most-scanned plants"
        description="Search and filter the leaderboard to find specific plants. Click a row to jump to the full record in AdminJS."
      >
        {leaderboard.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: space[4],
            }}
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leaderboard…"
              style={{
                flex: '1 1 220px',
                padding: '8px 12px',
                borderRadius: radius.md,
                border: `1px solid ${colors.line}`,
                background: colors.cream,
                fontFamily: font.body,
                fontSize: fontSize.base,
                color: colors.ink,
                boxSizing: 'border-box',
              }}
            />
            <FilterChip
              active={redListFilter === 'all'}
              label="Any status"
              count={redListCounts['all']}
              onClick={() => setRedListFilter('all')}
            />
            {Object.entries(redListCounts)
              .filter(([k]) => k !== 'all')
              .map(([k, v]) => (
                <FilterChip
                  key={k}
                  active={redListFilter === k}
                  label={k}
                  count={v}
                  onClick={() => setRedListFilter(k)}
                />
              ))}
          </div>
        )}
        {loading && leaderboard.length === 0 ? (
          <div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <Skeleton height={48} />
              </div>
            ))}
          </div>
        ) : visibleLeaderboard.length === 0 ? (
          <EmptyState
            variant={leaderboard.length === 0 ? 'idle' : 'no-filter-match'}
            title={
              leaderboard.length === 0
                ? 'No scans in this window'
                : 'No plants match your filters'
            }
            description={
              leaderboard.length === 0
                ? 'Once visitors start scanning labels, the busiest plants will rank here.'
                : 'Try a different Red List status or clear the search.'
            }
          />
        ) : (
          <DataTable
            columns={[
              {
                key: 'plant',
                label: 'Plant',
                render: (p) => (
                  <a
                    href={`/admin/resources/Plant/records/${p.plantId}/show`}
                    style={{ color: colors.forest, textDecoration: 'none' }}
                  >
                    <div style={{ fontStyle: 'italic', fontWeight: 600, color: colors.forestDeep }}>
                      {p.latinName}
                    </div>
                    <div style={{ fontSize: fontSize.sm, color: colors.inkMute }}>
                      {p.nameEn}
                    </div>
                  </a>
                ),
              },
              {
                key: 'redList',
                label: 'Red List',
                width: 100,
                render: (p) =>
                  p.redListStatus && p.redListStatus !== 'LC' ? (
                    <StatusPill tone="warn" dot>
                      {p.redListStatus}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="neutral" dot={false}>
                      {p.redListStatus || '—'}
                    </StatusPill>
                  ),
              },
              {
                key: 'window',
                label: 'In window',
                align: 'right',
                width: 120,
                hint: 'Scans during the selected time window.',
                render: (p) => (
                  <strong style={{ fontFamily: font.mono, color: colors.forest }}>
                    {p.scansInWindow.toLocaleString()}
                  </strong>
                ),
              },
              {
                key: 'lifetime',
                label: 'Lifetime',
                align: 'right',
                width: 120,
                hint: 'Total scans ever recorded for this plant.',
                render: (p) => (
                  <span style={{ fontFamily: font.mono, color: colors.inkMute }}>
                    {p.scanCountLifetime.toLocaleString()}
                  </span>
                ),
              },
              {
                key: 'donors',
                label: 'Donors',
                align: 'right',
                width: 120,
                render: (p) => (
                  <span style={{ fontFamily: font.mono, color: colors.inkMute }}>
                    {p.donorCount.toLocaleString()}
                  </span>
                ),
              },
            ]}
            rows={visibleLeaderboard}
            rowKey={(p) => p.plantId}
            onRowClick={(p) =>
              (window.location.href = `/admin/resources/Plant/records/${p.plantId}/show`)
            }
          />
        )}
      </Card>
    </Page>
  );
};

export default QrMetrics;
