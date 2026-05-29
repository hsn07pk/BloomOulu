/**
 * Admin · Enrichment review.
 *
 * Lists pending EnrichmentSuggestion rows from the 24/7 worker. Curator
 * picks Approve (writes the proposed value to Plant) or Reject (records
 * a reason; row stays for audit). All reviewed suggestions move into the
 * History tab so nothing is silently dropped.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  StatusPill,
  Tabs,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface PlantRef {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  taxon?: { latinName?: string | null } | null;
}

interface Suggestion {
  id: string;
  plantId: string;
  field: 'story' | 'origin' | 'status' | 'image';
  source: string;
  sourceUrl?: string | null;
  confidence: number;
  proposed: unknown;
  currentSnapshot: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'auto_applied' | 'superseded';
  createdAt: string;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  plant: PlantRef;
}

type Tab = 'pending' | 'history';
type FieldName = Suggestion['field'];

const FIELD_LABEL: Record<FieldName, string> = {
  story: 'Story',
  origin: 'Native origin',
  status: 'Red List status',
  image: 'Photo',
};

const FIELD_ICON: Record<FieldName, string> = {
  story: '📖',
  origin: '🌍',
  status: '🛡',
  image: '📷',
};

// All /v1/* calls go through the admin server's same-origin proxy
// (server.ts onRequest hook → process.env.API_URL || localhost:4000).
// Keeps the page identical in standalone dev and behind-Caddy prod.

const EnrichmentReview: React.FC = () => {
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [counts, setCounts] = useState<{ pending: number; history: number }>({
    pending: 0,
    history: 0,
  });
  const [busy, setBusy] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fieldFilter, setFieldFilter] = useState<FieldName | 'all'>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [rejecting, setRejecting] = useState<Suggestion | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (tab === 'pending' && fieldFilter !== 'all') params.set('field', fieldFilter);
      const url = `/v1/admin/enrichment/${tab}?${params}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: Suggestion[] };
      setItems(data.items);
      setCounts((c) => ({ ...c, [tab]: data.items.length }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [tab, fieldFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
    ok: number;
    failed: number;
    failures: Array<{ id: string; plant: string; field: FieldName; error: string }>;
  } | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<Suggestion[] | null>(null);
  const bulkAbortRef = React.useRef<AbortController | null>(null);

  async function act(id: string, kind: 'approve' | 'reject', reason?: string) {
    setActingOn(id);
    try {
      const res = await fetch(`/v1/admin/enrichment/${id}/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: kind === 'reject' ? JSON.stringify({ reason }) : '{}',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setActingOn(null);
    }
  }

  // Bulk-approve every visible pending suggestion.
  //
  // Concurrency tuned down from 6 → 3 after a 100-row bulk-approve hit
  // 37 photo failures: Wikimedia /thumb returns 429 once a single client
  // makes more than ~4 concurrent fetches, and the failures cascaded
  // because each photo apply does both a Wikimedia GET and a MinIO PUT.
  // Three workers keeps us under Wikimedia's per-IP cap while still
  // finishing a 100-row queue in ~3-4 minutes.
  const CONCURRENCY = 3;
  // 120s per request — the API now retries Wikimedia up to 6 times with
  // exponential back-off, which can stack to ~45s on a rate-limited
  // burst. The previous 45s ceiling timed out the very requests that
  // would have succeeded on retry.
  const PER_REQUEST_TIMEOUT_MS = 120_000;

  async function approveAll(targets: Suggestion[]) {
    const abort = new AbortController();
    bulkAbortRef.current = abort;
    setBulkProgress({ done: 0, total: targets.length, ok: 0, failed: 0, failures: [] });
    setErr(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    let cursor = 0;
    let ok = 0;
    let failed = 0;
    const failures: Array<{ id: string; plant: string; field: FieldName; error: string }> = [];

    const workers = Array.from({ length: CONCURRENCY }).map(async () => {
      while (!abort.signal.aborted) {
        const idx = cursor++;
        if (idx >= targets.length) break;
        const item = targets[idx]!;
        const reqAbort = new AbortController();
        const timeout = window.setTimeout(() => reqAbort.abort(), PER_REQUEST_TIMEOUT_MS);
        // Bridge the outer "Stop" signal to this individual request.
        const onOuterAbort = () => reqAbort.abort();
        abort.signal.addEventListener('abort', onOuterAbort);

        try {
          const res = await fetch(`/v1/admin/enrichment/${item.id}/approve`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            signal: reqAbort.signal,
          });
          if (res.ok) {
            ok++;
          } else {
            // Race with the 24/7 worker — if the suggestion was already
            // applied between page load and our POST, the API returns
            // 400 "already applied". Count as success because the
            // desired end state was reached.
            const j = (await res.json().catch(() => ({}))) as { message?: string };
            if (res.status === 400 && /already /i.test(j.message ?? '')) {
              ok++;
            } else {
              failed++;
              failures.push({
                id: item.id,
                plant: item.plant.taxon?.latinName ?? item.plant.nameEn ?? item.plant.slug,
                field: item.field,
                error: j.message ?? `HTTP ${res.status}`,
              });
            }
          }
        } catch (e) {
          failed++;
          const msg = reqAbort.signal.aborted
            ? abort.signal.aborted
              ? 'cancelled by user'
              : `timed out after ${Math.round(PER_REQUEST_TIMEOUT_MS / 1000)}s`
            : (e as Error).message;
          failures.push({
            id: item.id,
            plant: item.plant.taxon?.latinName ?? item.plant.nameEn ?? item.plant.slug,
            field: item.field,
            error: msg,
          });
        } finally {
          window.clearTimeout(timeout);
          abort.signal.removeEventListener('abort', onOuterAbort);
          setBulkProgress((p) =>
            p ? { ...p, done: p.done + 1, ok, failed, failures: [...failures] } : null,
          );
        }
      }
    });
    await Promise.all(workers);
    bulkAbortRef.current = null;
    await load();
  }

  function cancelBulkApprove() {
    bulkAbortRef.current?.abort();
  }

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return items.filter((s) => {
      if (!q) return true;
      const hay = [
        s.plant.taxon?.latinName ?? '',
        s.plant.nameEn,
        s.plant.nameFi,
        s.plant.nameSv,
        s.plant.slug,
        s.source,
        FIELD_LABEL[s.field],
        String(s.proposed),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, debouncedSearch]);

  const fieldCounts = useMemo(() => {
    const out: Record<FieldName, number> = { story: 0, origin: 0, status: 0, image: 0 };
    for (const s of items) out[s.field]++;
    return out;
  }, [items]);

  return (
    <Page>
      <PageHeader
        kicker="Plant enrichment"
        title="Enrichment review"
        lede="Suggested values fetched by the 24/7 worker from Wikipedia, GBIF, laji.fi, and Wikimedia Commons. Approve the ones that look right; the rest stays in the audit trail."
        actions={
          <>
            {tab === 'pending' && visible.length > 0 && (
              <Button
                variant="primary"
                onClick={() => setBulkConfirm(visible)}
                loading={Boolean(bulkProgress && bulkProgress.done < bulkProgress.total)}
                disabled={Boolean(bulkProgress)}
                leftIcon="✓"
              >
                Approve all {visible.length}
                {fieldFilter !== 'all' ? ` ${FIELD_LABEL[fieldFilter]}` : ''}
              </Button>
            )}
            <Button variant="secondary" onClick={() => void load()} loading={busy}>
              {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        }
      />

      <HelpBanner
        id="enrichment-review-intro"
        title="What you’re reviewing"
      >
        Each card is a single proposed change to one field on one plant. Click the plant name to
        open its full record in a new tab. Use the field filter to focus — e.g. tackle all the
        IUCN status updates in one sitting, leave the longer story rewrites for later.
      </HelpBanner>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pending', label: 'Pending', count: tab === 'pending' ? items.length : undefined, hint: 'Suggestions waiting for review' },
          { value: 'history', label: 'History', count: tab === 'history' ? items.length : undefined, hint: 'Approved and rejected suggestions, with reviewer notes' },
        ]}
      />

      <SearchFilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search by plant name, slug, source, or proposed value…"
        searchHint="Looks across the Latin / English / Finnish / Swedish names, the source provider, and the proposed text."
        filters={
          tab === 'pending' ? (
            <>
              <FilterChip
                active={fieldFilter === 'all'}
                label="All fields"
                count={items.length}
                onClick={() => setFieldFilter('all')}
              />
              {(Object.keys(FIELD_LABEL) as FieldName[]).map((f) => (
                <FilterChip
                  key={f}
                  active={fieldFilter === f}
                  label={`${FIELD_ICON[f]} ${FIELD_LABEL[f]}`}
                  count={fieldCounts[f]}
                  onClick={() => setFieldFilter(f)}
                />
              ))}
            </>
          ) : undefined
        }
        activeFilterCount={(search ? 1 : 0) + (fieldFilter !== 'all' ? 1 : 0)}
        onClearAll={() => {
          setSearch('');
          setFieldFilter('all');
        }}
        resultCount={visible.length}
        totalCount={items.length}
        resultLabel="suggestions"
      />

      {err && (
        <Notice tone="danger" title="Error loading enrichment data" onDismiss={() => setErr(null)}>
          {err}
        </Notice>
      )}

      {bulkProgress && (
        <Notice
          tone={
            bulkProgress.done < bulkProgress.total
              ? 'info'
              : bulkProgress.failed > 0
                ? 'warn'
                : 'success'
          }
          title={
            bulkProgress.done < bulkProgress.total
              ? `Approving ${bulkProgress.done}/${bulkProgress.total}…`
              : bulkProgress.failed > 0
                ? `Done — ${bulkProgress.ok} approved, ${bulkProgress.failed} failed`
                : `Done — ${bulkProgress.ok} approved`
          }
          onDismiss={
            bulkProgress.done >= bulkProgress.total ? () => setBulkProgress(null) : undefined
          }
        >
          {bulkProgress.done < bulkProgress.total ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
              <span>
                Each approval can take up to 2&nbsp;min — the API now retries Wikimedia
                rate-limits with back-off before giving up. Leave this tab open; failures
                are kept and shown when the run finishes.
              </span>
              <Button variant="danger" size="sm" onClick={cancelBulkApprove}>
                Stop
              </Button>
            </div>
          ) : bulkProgress.failed > 0 ? (
            <div>
              <div style={{ marginBottom: space[2] }}>
                {bulkProgress.failed} approval{bulkProgress.failed === 1 ? '' : 's'} failed. The
                most common cause is a transient Wikimedia rate-limit (HTTP 429); the API now
                retries with back-off, so a second pass usually succeeds. Each failure below shows
                the exact upstream cause.
              </div>
              <div style={{ display: 'flex', gap: space[2], marginBottom: space[2], flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const failedIds = new Set(bulkProgress.failures.map((f) => f.id));
                    const retargets = items.filter(
                      (s) => failedIds.has(s.id) && s.status === 'pending',
                    );
                    if (retargets.length) void approveAll(retargets);
                  }}
                >
                  Retry {bulkProgress.failures.length} failure
                  {bulkProgress.failures.length === 1 ? '' : 's'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setBulkProgress(null)}>
                  Dismiss
                </Button>
              </div>
              <details>
                <summary style={{ cursor: 'pointer', fontWeight: 500 }}>
                  Show failure list ({bulkProgress.failures.length})
                </summary>
                <ul
                  style={{
                    marginTop: space[2],
                    paddingLeft: 20,
                    fontSize: fontSize.sm,
                    lineHeight: 1.55,
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {bulkProgress.failures.map((f) => (
                    <li key={f.id}>
                      <span aria-hidden="true">{FIELD_ICON[f.field]}</span> <em>{f.plant}</em> ·{' '}
                      <code style={{ fontFamily: font.mono }}>{f.error}</code>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <>All approvals went through. The list below shows whatever is still pending.</>
          )}
        </Notice>
      )}

      {busy && !items.length ? (
        <Card>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ marginBottom: space[3] }}>
              <Skeleton height={120} />
            </div>
          ))}
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            variant={tab === 'pending' && items.length === 0 ? 'all-done' : 'no-results'}
            title={
              tab === 'pending' && items.length === 0
                ? 'Inbox zero — no suggestions to review.'
                : tab === 'history' && items.length === 0
                  ? 'No reviewed suggestions yet'
                  : 'No suggestions match your filters'
            }
            description={
              tab === 'pending' && items.length === 0
                ? 'New suggestions appear here automatically as the 24/7 worker enriches plants from open data sources.'
                : tab === 'history' && items.length === 0
                  ? 'Once you approve or reject a suggestion, it lands here with your reviewer note.'
                  : 'Try clearing the field filter or broadening your search.'
            }
            action={
              (search || fieldFilter !== 'all') && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setFieldFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
          {visible.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              tab={tab}
              busy={actingOn === s.id}
              onApprove={() => void act(s.id, 'approve')}
              onReject={() => {
                setRejecting(s);
                setRejectReason('');
              }}
            />
          ))}
        </div>
      )}

      {rejecting && (
        <RejectModal
          suggestion={rejecting}
          reason={rejectReason}
          onChange={setRejectReason}
          onCancel={() => setRejecting(null)}
          onConfirm={() => {
            void act(rejecting.id, 'reject', rejectReason);
            setRejecting(null);
          }}
        />
      )}

      {bulkConfirm && (
        <BulkApproveModal
          targets={bulkConfirm}
          fieldFilter={fieldFilter === 'all' ? null : fieldFilter}
          onCancel={() => setBulkConfirm(null)}
          onConfirm={() => {
            const list = bulkConfirm;
            setBulkConfirm(null);
            void approveAll(list);
          }}
        />
      )}
    </Page>
  );
};

const BulkApproveModal: React.FC<{
  targets: Suggestion[];
  fieldFilter: FieldName | null;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ targets, fieldFilter, onCancel, onConfirm }) => {
  // Summarise what's about to happen so the curator can sanity-check.
  const byField: Record<FieldName, number> = { story: 0, origin: 0, status: 0, image: 0 };
  for (const t of targets) byField[t.field]++;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Approve all visible suggestions"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(22, 48, 31, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 300,
        padding: space[6],
        animation: 'bo-fade-in 180ms ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: colors.paper,
          borderRadius: radius.lg,
          boxShadow: 'var(--bo-shadow-lg)',
          padding: space[6],
          maxWidth: 520,
          width: '100%',
        }}
      >
        <h2
          style={{
            fontFamily: font.display,
            fontSize: fontSize.xl,
            color: colors.forestDeep,
            margin: `0 0 ${space[2]}`,
          }}
        >
          Approve {targets.length} suggestion{targets.length === 1 ? '' : 's'}?
        </h2>
        <p style={{ color: colors.inkMute, fontSize: fontSize.base, margin: `0 0 ${space[3]}` }}>
          Every approval writes the proposed value to its plant and is recorded in the audit
          log. This action is irreversible (the original values are gone from the form, though
          enrichmentSuggestion rows keep a history snapshot).
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: space[2],
            marginBottom: space[4],
            padding: `${space[3]} ${space[4]}`,
            background: colors.whisper,
            borderRadius: radius.md,
            border: `1px solid ${colors.lineSoft}`,
          }}
        >
          {(['story', 'origin', 'status', 'image'] as FieldName[])
            .filter((f) => byField[f] > 0)
            .map((f) => (
              <span
                key={f}
                style={{
                  fontSize: fontSize.sm,
                  color: colors.forest,
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span aria-hidden="true">{FIELD_ICON[f]}</span>
                <strong style={{ fontFamily: font.mono }}>{byField[f]}</strong> {FIELD_LABEL[f]}
              </span>
            ))}
        </div>
        {fieldFilter && (
          <p style={{ color: colors.inkMute, fontSize: fontSize.sm, margin: `0 0 ${space[3]}` }}>
            Field filter is set to <strong>{FIELD_LABEL[fieldFilter]}</strong> — only those
            suggestions will be approved. Switch to “All fields” first if you want to clear the
            entire queue.
          </p>
        )}
        <div
          style={{
            display: 'flex',
            gap: space[2],
            justifyContent: 'flex-end',
          }}
        >
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Approve all {targets.length}
          </Button>
        </div>
      </div>
    </div>
  );
};

const SuggestionCard: React.FC<{
  suggestion: Suggestion;
  tab: Tab;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}> = ({ suggestion: s, tab, busy, onApprove, onReject }) => {
  const plantName = s.plant.taxon?.latinName ?? s.plant.nameEn ?? s.plant.slug;
  const reviewedTone =
    s.status === 'approved' || s.status === 'applied' || s.status === 'auto_applied'
      ? 'success'
      : s.status === 'rejected'
        ? 'danger'
        : 'neutral';
  return (
    <article
      style={{
        background: colors.paper,
        border: `1px solid ${colors.line}`,
        borderRadius: radius.lg,
        padding: 0,
        display: 'grid',
        gridTemplateColumns: '1fr minmax(180px, auto)',
        gap: 0,
        overflow: 'hidden',
        boxShadow: 'var(--bo-shadow-sm)',
      }}
    >
      <div style={{ padding: `${space[5]} ${space[5]}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: space[2],
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: 22,
              lineHeight: 1,
            }}
          >
            {FIELD_ICON[s.field]}
          </span>
          <span
            style={{
              fontFamily: font.display,
              fontWeight: 600,
              fontSize: fontSize.lg,
              color: colors.forestDeep,
            }}
          >
            {FIELD_LABEL[s.field]}
          </span>
          <span style={{ color: colors.inkFaint }}>·</span>
          <a
            href={`/admin/resources/Plant/records/${s.plant.id}/show`}
            style={{
              color: colors.moss,
              fontStyle: 'italic',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            {plantName}
          </a>
          <span style={{ color: colors.inkFaint }}>·</span>
          <span style={{ fontSize: fontSize.sm, color: colors.inkMute }}>
            from <strong>{s.source}</strong>
          </span>
          {s.sourceUrl && (
            <a
              href={s.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: colors.moss,
                fontSize: fontSize.sm,
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}
            >
              view source ↗
            </a>
          )}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: fontSize.sm,
              color: colors.inkFaint,
              fontVariantNumeric: 'tabular-nums',
            }}
            title={new Date(s.createdAt).toLocaleString()}
          >
            {new Date(s.createdAt).toLocaleDateString()}
          </span>
        </div>
        <PreviewBlock s={s} />
        {s.reviewNote && (
          <div
            style={{
              marginTop: space[3],
              padding: `${space[2]} ${space[3]}`,
              background: colors.whisper,
              borderRadius: radius.sm,
              fontSize: fontSize.sm,
              color: colors.inkMute,
              borderLeft: `3px solid ${colors.olive}`,
            }}
          >
            <strong>Reviewer note:</strong> {s.reviewNote}
          </div>
        )}
      </div>
      <div
        style={{
          background: colors.whisper,
          borderLeft: `1px solid ${colors.lineSoft}`,
          padding: space[4],
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'stretch',
        }}
      >
        {tab === 'pending' ? (
          <>
            <Button
              variant="primary"
              onClick={onApprove}
              loading={busy}
              leftIcon="✓"
            >
              Approve
            </Button>
            <Button variant="danger" onClick={onReject} disabled={busy} leftIcon="×">
              Reject…
            </Button>
            <div style={{ fontSize: 11, color: colors.inkMute, marginTop: 4, lineHeight: 1.45 }}>
              Approve writes this value to the Plant row.<br />
              Reject records a reason and keeps the suggestion for audit.
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <StatusPill tone={reviewedTone}>{s.status.replace('_', ' ')}</StatusPill>
            {s.reviewedAt && (
              <div
                style={{
                  fontSize: 11,
                  color: colors.inkFaint,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {new Date(s.reviewedAt).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

const PreviewBlock: React.FC<{ s: Suggestion }> = ({ s }) => {
  if (s.field === 'origin') {
    return (
      <div>
        <div style={{ fontSize: 11, color: colors.inkMute, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          Proposed
        </div>
        <div style={{ marginTop: 4, fontSize: fontSize.base, color: colors.forestDeep, fontWeight: 500 }}>
          {String(s.proposed)}
        </div>
        {s.currentSnapshot != null && (
          <>
            <div style={{ fontSize: 11, color: colors.inkMute, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginTop: 8 }}>
              Current
            </div>
            <div style={{ color: colors.inkFaint, fontStyle: 'italic' }}>
              {String(s.currentSnapshot)}
            </div>
          </>
        )}
      </div>
    );
  }
  if (s.field === 'status') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <StatusPill tone="info" dot>
          {String(s.proposed)}
        </StatusPill>
        {!!s.currentSnapshot && (
          <span style={{ color: colors.inkFaint, fontSize: fontSize.sm }}>
            was <code style={{ fontFamily: font.mono }}>{String(s.currentSnapshot)}</code>
          </span>
        )}
      </div>
    );
  }
  if (s.field === 'story' && s.proposed && typeof s.proposed === 'object') {
    const en = ((s.proposed as { en?: string }).en) ?? '';
    return (
      <div
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          fontSize: fontSize.base,
          color: colors.inkSoft,
          lineHeight: 1.6,
          background: colors.cream,
          padding: `${space[3]} ${space[4]}`,
          borderRadius: radius.sm,
          border: `1px solid ${colors.lineSoft}`,
        }}
      >
        {en.slice(0, 800)}
        {en.length > 800 && <em style={{ color: colors.inkFaint }}>… ({en.length - 800} more chars)</em>}
      </div>
    );
  }
  if (s.field === 'image' && s.proposed && typeof s.proposed === 'object') {
    const obj = s.proposed as { url?: string; attribution?: string; licenseSpdx?: string };
    return (
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {obj.url && (
          <img
            src={obj.url}
            alt=""
            loading="lazy"
            style={{
              width: 140,
              height: 140,
              objectFit: 'cover',
              border: `1px solid ${colors.line}`,
              borderRadius: radius.md,
              background: colors.whisper,
            }}
          />
        )}
        <div style={{ fontSize: fontSize.sm, color: colors.inkMute, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 500, color: colors.forest }}>{obj.attribution}</div>
          <div style={{ marginTop: 4 }}>License: {obj.licenseSpdx ?? 'unknown'}</div>
        </div>
      </div>
    );
  }
  return (
    <pre
      style={{
        fontSize: 11,
        fontFamily: font.mono,
        background: colors.cream,
        padding: `${space[2]} ${space[3]}`,
        borderRadius: radius.sm,
        margin: 0,
        overflowX: 'auto',
      }}
    >
      {JSON.stringify(s.proposed, null, 2).slice(0, 600)}
    </pre>
  );
};

const RejectModal: React.FC<{
  suggestion: Suggestion;
  reason: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ suggestion, reason, onChange, onCancel, onConfirm }) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Reject suggestion"
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(22, 48, 31, 0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 300,
      padding: space[6],
      animation: 'bo-fade-in 180ms ease',
    }}
    onClick={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}
  >
    <div
      style={{
        background: colors.paper,
        borderRadius: radius.lg,
        boxShadow: 'var(--bo-shadow-lg)',
        padding: space[6],
        maxWidth: 520,
        width: '100%',
      }}
    >
      <h2
        style={{
          fontFamily: font.display,
          fontSize: fontSize.xl,
          color: colors.forestDeep,
          margin: `0 0 ${space[2]}`,
        }}
      >
        Reject {FIELD_LABEL[suggestion.field]} suggestion
      </h2>
      <p style={{ color: colors.inkMute, fontSize: fontSize.base, margin: `0 0 ${space[4]}` }}>
        For <em>{suggestion.plant.taxon?.latinName ?? suggestion.plant.nameEn}</em>. The reason
        below is recorded in the audit trail — write enough that a future curator (or your future
        self) understands why this was wrong.
      </p>
      <textarea
        value={reason}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        autoFocus
        placeholder="e.g. The Wikipedia summary mixes two species. The English name is correct but the origin paragraph is about A. sibirica."
        style={{
          width: '100%',
          padding: `${space[3]} ${space[3]}`,
          border: `1px solid ${colors.line}`,
          borderRadius: radius.md,
          background: colors.cream,
          fontSize: fontSize.base,
          fontFamily: font.body,
          color: colors.ink,
          boxSizing: 'border-box',
          resize: 'vertical',
          lineHeight: 1.55,
        }}
      />
      <div
        style={{
          display: 'flex',
          gap: space[2],
          justifyContent: 'flex-end',
          marginTop: space[4],
        }}
      >
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={reason.trim().length < 3}>
          Reject suggestion
        </Button>
      </div>
    </div>
  </div>
);

export default EnrichmentReview;
