/**
 * Bulk add plants — paste a list of Latin names or upload an Excel /
 * CSV file. The page hands the list off to the admin server as a
 * persistent BulkAddJob; the server fans out parallel enrichment +
 * creation in the background. The curator can close the browser, leave
 * the page, or come back tomorrow — the job keeps running and the page
 * always resumes from the last saved state.
 *
 * Flow:
 *   1. Compose: paste Latin names OR upload .xlsx/.xls/.csv
 *   2. Submit → server creates job → page switches to the job-detail
 *      view (URL hash carries the job id so reloads resume).
 *   3. Poll every 2 s for live progress.
 *   4. Once every row is "ready" the curator can untick anything wrong
 *      and hit "Create N plants" — kicks off the creation phase.
 *   5. Recent jobs appear at the top so the curator can pick up where
 *      they left off across sessions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Button,
  Card,
  EmptyState,
  HelpBanner,
  Notice,
  Page,
  PageHeader,
  Skeleton,
  StatusPill,
  Tabs,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

type RowStatus =
  | 'queued'
  | 'fetching'
  | 'ready'
  | 'failed'
  | 'creating'
  | 'created'
  | 'create-failed'
  | 'skipped';

interface PreviewSlot<T = unknown> {
  value: T;
  source: { provider: string; url?: string };
}
interface PreviewPayload {
  story: PreviewSlot<{ en?: string; fi?: string; sv?: string }> | null;
  origin: PreviewSlot<string> | null;
  status: PreviewSlot<string> | null;
  image: PreviewSlot<{ url?: string; attribution?: string; licenseSpdx?: string }> | null;
}

interface Row {
  id: string;
  latinName: string;
  nameEn?: string;
  nameFi?: string;
  nameSv?: string;
  family?: string;
  status: RowStatus;
  preview?: PreviewPayload;
  keep?: { story: boolean; origin: boolean; status: boolean; image: boolean };
  error?: string;
  createdId?: string;
  createdSlug?: string;
}

interface JobTotals {
  total: number;
  queued: number;
  fetching: number;
  ready: number;
  failed: number;
  creating: number;
  created: number;
  createFailed: number;
  skipped: number;
}

interface JobSummary {
  id: string;
  status: string;
  phase: string;
  totals: JobTotals;
  createdAt: string;
  updatedAt: string;
  createdByUser: string | null;
}

interface JobDetail extends JobSummary {
  items: Row[];
  running: boolean;
}

type Mode = 'paste' | 'upload';

function parsePasted(text: string): Array<Pick<Row, 'latinName' | 'nameEn'>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [latin, common] = line.split(/,\s*/);
      return { latinName: latin!, nameEn: common };
    });
}

function parseSheet(file: File): Promise<Array<Partial<Row>>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result as ArrayBuffer, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]!];
        if (!sheet) return resolve([]);
        const rowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
        });
        const rows: Array<Partial<Row>> = rowsRaw
          .map((r) => {
            const keys = Object.fromEntries(
              Object.keys(r).map((k) => [k.toLowerCase().trim(), k]),
            );
            const latin = String(
              r[keys['latinname'] ?? keys['latin'] ?? keys['name'] ?? ''] ?? '',
            ).trim();
            if (!latin) return null;
            return {
              latinName: latin,
              nameEn: String(r[keys['nameen'] ?? keys['english'] ?? keys['en'] ?? ''] ?? '').trim() || undefined,
              nameFi: String(r[keys['namefi'] ?? keys['finnish'] ?? keys['fi'] ?? ''] ?? '').trim() || undefined,
              nameSv: String(r[keys['namesv'] ?? keys['swedish'] ?? keys['sv'] ?? ''] ?? '').trim() || undefined,
              family: String(r[keys['family'] ?? ''] ?? '').trim() || undefined,
            };
          })
          .filter(Boolean) as Array<Partial<Row>>;
        resolve(rows);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

const BulkAddPlants: React.FC = () => {
  // The URL hash decides whether to render the compose view (no hash or
  // #compose) or the job-detail view (#job=<id>). This keeps deep links
  // shareable and lets the curator paste a job link to a teammate.
  const [view, setView] = useState<{ kind: 'compose' } | { kind: 'job'; id: string }>(
    () => readView(),
  );
  useEffect(() => {
    const handler = () => setView(readView());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return (
    <Page>
      <PageHeader
        kicker="Bulk import"
        title="Add many plants at once"
        lede={
          view.kind === 'compose'
            ? 'Paste Latin names or upload an Excel/CSV sheet. The admin server enriches them in parallel and can batch-create the lot. Jobs persist — close the browser, come back tomorrow, the work continues.'
            : 'Live state for this job. Leave this tab open or close it — processing continues on the server. Refresh any time to see progress.'
        }
        actions={
          view.kind === 'job' && (
            <Button
              variant="secondary"
              onClick={() => {
                window.location.hash = '';
              }}
            >
              ← Back to compose
            </Button>
          )
        }
      />
      {view.kind === 'compose' && <ComposeView />}
      {view.kind === 'job' && <JobView jobId={view.id} />}
    </Page>
  );
};

function readView(): { kind: 'compose' } | { kind: 'job'; id: string } {
  if (typeof window === 'undefined') return { kind: 'compose' };
  const m = window.location.hash.match(/job=([0-9a-f-]{36})/i);
  return m ? { kind: 'job', id: m[1]! } : { kind: 'compose' };
}

// ────────────────────────────────────────────────────────────────────────
// Compose view — paste / upload, plus a list of recent jobs.
// ────────────────────────────────────────────────────────────────────────

const ComposeView: React.FC = () => {
  const [mode, setMode] = useState<Mode>('paste');
  const [pasted, setPasted] = useState('');
  const [recent, setRecent] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadRecent = async () => {
    try {
      const res = await fetch('/admin/plants/bulk-jobs', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { jobs: JobSummary[] };
      setRecent(data.jobs ?? []);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    void loadRecent();
  }, []);

  async function startJob(items: Array<Partial<Row>>) {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/admin/plants/bulk-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      window.location.hash = `job=${id}`;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function startFromPaste() {
    const parsed = parsePasted(pasted);
    if (parsed.length === 0) {
      setErr('Paste at least one Latin name (one per line).');
      return;
    }
    void startJob(parsed);
  }

  async function startFromFile(file: File) {
    try {
      const parsed = await parseSheet(file);
      if (parsed.length === 0) {
        setErr(`No rows found in ${file.name}. Need a column called latinName / latin / name.`);
        return;
      }
      void startJob(parsed);
    } catch (e) {
      setErr(`Couldn't parse ${file.name}: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <HelpBanner id="bulk-add-intro-v2" title="How the persistent flow works">
        Submitting the form creates a background job on the server. Each plant is enriched and
        created in parallel; closing the browser doesn’t stop anything. The “Recent jobs” section
        below lets you reopen any job — completed, in-flight, or interrupted — to see its state or
        finish reviewing.
      </HelpBanner>

      {recent && recent.length > 0 && (
        <Card
          kicker="Pick up where you left off"
          title="Recent jobs"
          description="Last 20 bulk-add jobs. Click any row to open its detail view."
          actions={
            <Button variant="secondary" size="sm" onClick={() => void loadRecent()}>
              Refresh
            </Button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map((j) => (
              <JobRow key={j.id} job={j} onOpen={() => (window.location.hash = `job=${j.id}`)} />
            ))}
          </div>
        </Card>
      )}

      <Tabs<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'paste', label: 'Paste names', hint: 'Quickest — one Latin name per line.' },
          { value: 'upload', label: 'Upload Excel / CSV', hint: '.xlsx, .xls, or .csv with a latinName column.' },
        ]}
      />

      {mode === 'paste' && (
        <Card
          title="Paste Latin names"
          description="One species per line. Optional: append a comma + common name. e.g. Abies alba, European silver fir"
        >
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={10}
            placeholder={'Abies alba\nNepenthes alata\nTrollius europaeus'}
            style={{
              width: '100%',
              padding: `${space[3]} ${space[3]}`,
              borderRadius: radius.md,
              border: `1px solid ${colors.line}`,
              background: colors.cream,
              fontSize: fontSize.base,
              fontFamily: font.mono,
              color: colors.ink,
              boxSizing: 'border-box',
              lineHeight: 1.55,
              resize: 'vertical',
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: space[3],
              gap: space[3],
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: fontSize.sm, color: colors.inkMute }}>
              {pasted.split(/\r?\n/).filter((l) => l.trim()).length} non-empty line
              {pasted.split(/\r?\n/).filter((l) => l.trim()).length === 1 ? '' : 's'}.
            </span>
            <Button
              variant="primary"
              size="lg"
              onClick={startFromPaste}
              disabled={!pasted.trim() || submitting}
              loading={submitting}
              leftIcon="⌕"
            >
              Start enrichment job
            </Button>
          </div>
        </Card>
      )}

      {mode === 'upload' && (
        <Card title="Upload Excel or CSV">
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: `${space[10]} ${space[6]}`,
              border: `2px dashed ${colors.line}`,
              borderRadius: radius.lg,
              background: colors.whisper,
              cursor: 'pointer',
              gap: space[3],
            }}
            onDragOver={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLLabelElement).style.background = colors.sage;
              (e.currentTarget as HTMLLabelElement).style.borderColor = colors.olive;
            }}
            onDragLeave={(e) => {
              (e.currentTarget as HTMLLabelElement).style.background = colors.whisper;
              (e.currentTarget as HTMLLabelElement).style.borderColor = colors.line;
            }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void startFromFile(file);
              (e.currentTarget as HTMLLabelElement).style.background = colors.whisper;
              (e.currentTarget as HTMLLabelElement).style.borderColor = colors.line;
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 36, color: colors.olive }}>
              ⬆
            </span>
            <div
              style={{
                fontFamily: font.display,
                fontSize: fontSize.xl,
                color: colors.forestDeep,
                fontWeight: 600,
              }}
            >
              Drop file or click to choose
            </div>
            <div style={{ fontSize: fontSize.base, color: colors.inkMute, textAlign: 'center', maxWidth: 460 }}>
              <code style={{ fontFamily: font.mono }}>.xlsx</code> ·{' '}
              <code style={{ fontFamily: font.mono }}>.xls</code> ·{' '}
              <code style={{ fontFamily: font.mono }}>.csv</code>. Required column:{' '}
              <code style={{ fontFamily: font.mono }}>latinName</code>.
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void startFromFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </Card>
      )}

      {err && (
        <Notice tone="danger" onDismiss={() => setErr(null)}>
          {err}
        </Notice>
      )}

      {recent && recent.length === 0 && (
        <Card>
          <EmptyState
            variant="idle"
            title="No bulk-add jobs yet"
            description="Submit your first list above. The job runs on the server — you can close this tab and come back later."
          />
        </Card>
      )}
    </>
  );
};

// ────────────────────────────────────────────────────────────────────────
// Job-detail view — live polling of one server-side job.
// ────────────────────────────────────────────────────────────────────────

const JobView: React.FC<{ jobId: string }> = ({ jobId }) => {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch(`/admin/plants/bulk-jobs/${jobId}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as JobDetail;
      setJob(data);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Poll every 2s while the job is in flight; back off when settled.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, 2000);
    return () => window.clearInterval(id);
  }, [jobId]);

  async function startCreation() {
    setCreating(true);
    try {
      await fetch(`/admin/plants/bulk-jobs/${jobId}/create-ready`, {
        method: 'POST',
        credentials: 'include',
      });
      await refresh();
    } finally {
      setCreating(false);
    }
  }
  async function cancel() {
    setActionBusy('cancel');
    try {
      await fetch(`/admin/plants/bulk-jobs/${jobId}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      await refresh();
    } finally {
      setActionBusy(null);
    }
  }
  async function rowAction(
    rowId: string,
    action: 'retry-row' | 'skip-row' | 'toggle-keep',
    field?: string,
  ) {
    setActionBusy(`${action}-${rowId}`);
    try {
      await fetch(`/admin/plants/bulk-jobs/${jobId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowId, field }),
      });
      await refresh();
    } finally {
      setActionBusy(null);
    }
  }
  async function deleteJob() {
    if (!window.confirm('Delete this bulk-add job? Created plants stay; just the job log is removed.')) return;
    setActionBusy('delete');
    try {
      await fetch(`/admin/plants/bulk-jobs/${jobId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      window.location.hash = '';
    } finally {
      setActionBusy(null);
    }
  }

  if (err && !job) {
    return (
      <Card>
        <Notice tone="danger">{err}</Notice>
      </Card>
    );
  }
  if (!job) {
    return (
      <Card>
        <Skeleton height={120} />
      </Card>
    );
  }

  const eligibleCount = job.totals.ready;
  const phaseLabel =
    job.status === 'running' && job.phase === 'enrich'
      ? 'Enriching…'
      : job.status === 'running' && job.phase === 'create'
        ? 'Creating…'
        : job.status === 'awaiting_review'
          ? 'Awaiting review'
          : job.status === 'completed'
            ? 'Completed'
            : job.status === 'cancelled'
              ? 'Cancelled'
              : job.status === 'interrupted'
                ? 'Interrupted (resume to finish)'
                : job.status;
  const phaseTone =
    job.status === 'running'
      ? 'info'
      : job.status === 'awaiting_review'
        ? 'warn'
        : job.status === 'completed'
          ? 'success'
          : job.status === 'cancelled' || job.status === 'interrupted'
            ? 'danger'
            : 'neutral';

  return (
    <>
      <Card
        kicker={`Job · ${job.id.slice(0, 8)}…`}
        title={phaseLabel}
        description={`Total ${job.totals.total} · queued ${job.totals.queued} · fetching ${job.totals.fetching} · ready ${job.totals.ready} · failed ${job.totals.failed} · creating ${job.totals.creating} · created ${job.totals.created}${job.totals.createFailed ? ` · create-failed ${job.totals.createFailed}` : ''}${job.totals.skipped ? ` · skipped ${job.totals.skipped}` : ''}.`}
        actions={
          <>
            <StatusPill tone={phaseTone as 'info'}>{phaseLabel}</StatusPill>
            {(job.status === 'awaiting_review' || job.status === 'interrupted') && eligibleCount > 0 && (
              <Button variant="primary" onClick={() => void startCreation()} loading={creating}>
                Create {eligibleCount} plant{eligibleCount === 1 ? '' : 's'}
              </Button>
            )}
            {job.status === 'running' && (
              <Button variant="danger" onClick={() => void cancel()} loading={actionBusy === 'cancel'}>
                Cancel
              </Button>
            )}
            {(job.status === 'completed' || job.status === 'cancelled') && (
              <Button variant="secondary" onClick={() => void deleteJob()} loading={actionBusy === 'delete'}>
                Delete job
              </Button>
            )}
          </>
        }
      >
        {err && <Notice tone="danger" onDismiss={() => setErr(null)}>{err}</Notice>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {job.items.map((row) => (
            <JobRowDetail
              key={row.id}
              row={row}
              actionBusy={actionBusy}
              onAction={(a, field) => void rowAction(row.id, a, field)}
            />
          ))}
        </div>
      </Card>
    </>
  );
};

const JobRow: React.FC<{ job: JobSummary; onOpen: () => void }> = ({ job, onOpen }) => {
  const t = job.totals ?? ({ total: 0 } as JobTotals);
  const tone =
    job.status === 'completed'
      ? 'success'
      : job.status === 'running'
        ? 'info'
        : job.status === 'awaiting_review'
          ? 'warn'
          : 'neutral';
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: space[3],
        alignItems: 'center',
        padding: `${space[3]} ${space[4]}`,
        borderRadius: radius.md,
        border: `1px solid ${colors.line}`,
        background: colors.paper,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: font.body,
      }}
    >
      <div>
        <code
          style={{
            fontFamily: font.mono,
            fontSize: fontSize.sm,
            color: colors.forest,
            fontWeight: 600,
          }}
        >
          {job.id.slice(0, 12)}…
        </code>
        <div
          style={{
            fontSize: fontSize.sm,
            color: colors.inkMute,
            marginTop: 4,
          }}
        >
          {t.total} rows · {t.created}/{t.total} created · {t.failed + t.createFailed} failed
          {job.createdByUser ? ` · by ${job.createdByUser}` : ''}
        </div>
      </div>
      <span style={{ fontSize: fontSize.sm, color: colors.inkFaint }}>
        {new Date(job.updatedAt).toLocaleString()}
      </span>
      <StatusPill tone={tone as 'success'}>{job.status}</StatusPill>
    </button>
  );
};

const JobRowDetail: React.FC<{
  row: Row;
  actionBusy: string | null;
  onAction: (a: 'retry-row' | 'skip-row' | 'toggle-keep', field?: string) => void;
}> = ({ row, actionBusy, onAction }) => {
  const statusTone =
    row.status === 'ready' || row.status === 'created'
      ? 'success'
      : row.status === 'fetching' || row.status === 'queued' || row.status === 'creating'
        ? 'info'
        : row.status === 'skipped'
          ? 'neutral'
          : 'danger';
  const statusLabel =
    row.status === 'queued'
      ? 'Queued'
      : row.status === 'fetching'
        ? 'Fetching…'
        : row.status === 'ready'
          ? 'Ready'
          : row.status === 'creating'
            ? 'Creating…'
            : row.status === 'created'
              ? 'Created ✓'
              : row.status === 'create-failed'
                ? 'Create failed'
                : row.status === 'skipped'
                  ? 'Skipped'
                  : 'Fetch failed';
  const keep = row.keep ?? { story: true, origin: true, status: true, image: true };
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 240px) 1fr auto',
        gap: space[3],
        alignItems: 'flex-start',
        padding: `${space[3]} ${space[4]}`,
        borderRadius: radius.md,
        background:
          row.status === 'created'
            ? colors.successBg
            : row.status === 'failed' || row.status === 'create-failed'
              ? colors.dangerBg
              : row.status === 'skipped'
                ? colors.whisper
                : 'transparent',
        border: `1px solid ${
          row.status === 'created'
            ? colors.successLine
            : row.status === 'failed' || row.status === 'create-failed'
              ? colors.dangerLine
              : colors.lineSoft
        }`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontStyle: 'italic',
            fontFamily: font.display,
            fontSize: fontSize.lg,
            fontWeight: 600,
            color: colors.forestDeep,
            wordBreak: 'break-word',
          }}
        >
          {row.latinName}
        </div>
        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusPill tone={statusTone as 'success'}>{statusLabel}</StatusPill>
        </div>
        {row.error && (
          <div style={{ fontSize: fontSize.sm, color: colors.dangerFg, marginTop: 4 }}>
            {row.error}
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        {row.status === 'fetching' && <Skeleton height={36} />}
        {(row.status === 'ready' || row.status === 'creating') && row.preview && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[2] }}>
            {(['story', 'origin', 'status', 'image'] as const).map((field) => {
              const slot = row.preview?.[field];
              return (
                <KeepChip
                  key={field}
                  label={field}
                  icon={field === 'story' ? '📖' : field === 'origin' ? '🌍' : field === 'status' ? '🛡' : '📷'}
                  checked={keep[field]}
                  disabled={!slot || row.status === 'creating' || actionBusy !== null}
                  hint={
                    slot
                      ? typeof slot.value === 'string'
                        ? slot.value.slice(0, 60)
                        : slot.source.provider
                      : 'no data'
                  }
                  onClick={() => onAction('toggle-keep', field)}
                />
              );
            })}
          </div>
        )}
        {row.status === 'created' && row.createdSlug && (
          <div style={{ fontSize: fontSize.sm, color: colors.forestDeep }}>
            <a
              href={`/admin/resources/Plant/records/${row.createdId}/edit`}
              style={{
                color: colors.forestMid,
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the new plant ↗
            </a>
            <span style={{ marginLeft: 8, color: colors.inkMute }}>
              slug <code style={{ fontFamily: font.mono }}>{row.createdSlug}</code>
            </span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        {(row.status === 'failed' || row.status === 'create-failed') && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAction('retry-row')}
            loading={actionBusy === `retry-row-${row.id}`}
          >
            Retry
          </Button>
        )}
        {(row.status === 'ready' || row.status === 'skipped') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAction('skip-row')}
            loading={actionBusy === `skip-row-${row.id}`}
          >
            {row.status === 'skipped' ? 'Include' : 'Skip'}
          </Button>
        )}
      </div>
    </div>
  );
};

const KeepChip: React.FC<{
  label: string;
  icon: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}> = ({ label, icon, checked, disabled, hint, onClick }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    title={hint}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 999,
      border: `1px solid ${disabled ? colors.line : checked ? colors.olive : colors.line}`,
      background: disabled ? colors.whisper : checked ? colors.sage : colors.cream,
      color: disabled ? colors.inkFaint : checked ? colors.forestDeep : colors.inkSoft,
      fontSize: fontSize.sm,
      fontWeight: checked ? 600 : 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: font.body,
      textTransform: 'capitalize',
    }}
  >
    <span aria-hidden="true">{icon}</span>
    {label}
    {!disabled && (
      <span style={{ marginLeft: 4, fontSize: 11, color: checked ? colors.forestMid : colors.inkFaint }}>
        {checked ? '✓' : '○'}
      </span>
    )}
  </button>
);

export default BulkAddPlants;
