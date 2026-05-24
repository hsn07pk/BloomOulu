/**
 * Persistent bulk-add-plant job processor.
 *
 * BulkAddJob rows store the full per-row state of a multi-plant import.
 * This module fans out enrichment + creation in the background so the
 * curator can leave the page / close the browser and come back later to
 * pick up exactly where they left off.
 *
 * Concurrency is capped at 4 parallel fetches to stay well under
 * Wikipedia / GBIF / laji.fi rate limits. Progress is persisted to the
 * job row every batch so the UI poll always sees fresh state.
 *
 * On process restart, any job still in 'running'/'enrich' phase is
 * resumed on first request via `resumeRunningJobs()` — the in-flight
 * row that was being processed when the server died is marked failed
 * with a "interrupted" message so the curator can retry that one row.
 */
import type { PrismaClient } from '@prisma/client';

export type RowStatus =
  | 'queued'
  | 'fetching'
  | 'ready'
  | 'failed'
  | 'creating'
  | 'created'
  | 'create-failed'
  | 'skipped';

export interface JobRow {
  id: string;
  latinName: string;
  nameEn?: string;
  nameFi?: string;
  nameSv?: string;
  family?: string;
  status: RowStatus;
  preview?: unknown;
  keep?: { story: boolean; origin: boolean; status: boolean; image: boolean };
  error?: string;
  createdId?: string;
  createdSlug?: string;
}

export interface JobTotals {
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

const CONCURRENCY = 4;

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** Compute counters from the items array. */
export function computeTotals(items: JobRow[]): JobTotals {
  const t: JobTotals = {
    total: items.length,
    queued: 0,
    fetching: 0,
    ready: 0,
    failed: 0,
    creating: 0,
    created: 0,
    createFailed: 0,
    skipped: 0,
  };
  for (const r of items) {
    if (r.status === 'queued') t.queued++;
    else if (r.status === 'fetching') t.fetching++;
    else if (r.status === 'ready') t.ready++;
    else if (r.status === 'failed') t.failed++;
    else if (r.status === 'creating') t.creating++;
    else if (r.status === 'created') t.created++;
    else if (r.status === 'create-failed') t.createFailed++;
    else if (r.status === 'skipped') t.skipped++;
  }
  return t;
}

/**
 * Track running jobs in-memory so a second request to start the same
 * job doesn't kick off a duplicate processor. Tracks AbortController
 * for cancellation.
 */
const inflight = new Map<string, { abort: AbortController }>();

/** Persist items + totals + status. Uses Prisma — single short xact. */
async function saveJobState(
  prisma: PrismaClient,
  jobId: string,
  items: JobRow[],
  patch?: { status?: string; phase?: string },
): Promise<void> {
  await prisma.bulkAddJob.update({
    where: { id: jobId },
    data: {
      items: items as unknown as object,
      totals: computeTotals(items) as unknown as object,
      ...(patch?.status ? { status: patch.status } : {}),
      ...(patch?.phase ? { phase: patch.phase } : {}),
    },
  });
}

/** Fetch one enrichment preview through the local API (no CORS). */
async function fetchPreview(latinName: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`${apiUrl}/v1/admin/enrichment/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latinName }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { preview: unknown };
  return json.preview;
}

/**
 * Run the enrichment phase: walk every queued row in parallel (capped),
 * persist after each row so the curator's poll sees progress.
 */
export async function runEnrichmentPhase(
  prisma: PrismaClient,
  jobId: string,
): Promise<void> {
  if (inflight.has(jobId)) return;
  const abort = new AbortController();
  inflight.set(jobId, { abort });
  try {
    const job = await prisma.bulkAddJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const items = job.items as unknown as JobRow[];
    let cursor = 0;
    const next = (): number => cursor++;
    const updateRow = async (idx: number, patch: Partial<JobRow>) => {
      items[idx] = { ...items[idx]!, ...patch };
      await saveJobState(prisma, jobId, items);
    };
    const workers = Array.from({ length: CONCURRENCY }).map(async () => {
      while (!abort.signal.aborted) {
        const idx = next();
        if (idx >= items.length) break;
        const row = items[idx]!;
        if (row.status !== 'queued') continue;
        await updateRow(idx, { status: 'fetching' });
        const reqAbort = new AbortController();
        // First-time enrichment for a species can take 50+s (parallel
        // Wikipedia + GBIF + laji.fi + Wikimedia Commons round trips).
        // Subsequent calls hit the per-species cache and return in ms.
        // 90s gives the first call enough room without leaving genuinely
        // stuck requests pinned indefinitely.
        const TIMEOUT_MS = 90_000;
        const timer = setTimeout(() => reqAbort.abort(), TIMEOUT_MS);
        const onOuter = () => reqAbort.abort();
        abort.signal.addEventListener('abort', onOuter);
        try {
          const preview = await fetchPreview(row.latinName, reqAbort.signal);
          await updateRow(idx, { status: 'ready', preview });
        } catch (e) {
          const msg = abort.signal.aborted
            ? 'cancelled'
            : reqAbort.signal.aborted
              ? `timed out after ${TIMEOUT_MS / 1000}s`
              : (e as Error).message;
          await updateRow(idx, { status: 'failed', error: msg });
        } finally {
          clearTimeout(timer);
          abort.signal.removeEventListener('abort', onOuter);
        }
      }
    });
    await Promise.all(workers);
    if (!abort.signal.aborted) {
      await saveJobState(prisma, jobId, items, { status: 'awaiting_review', phase: 'review' });
    } else {
      await saveJobState(prisma, jobId, items, { status: 'cancelled' });
    }
  } finally {
    inflight.delete(jobId);
  }
}

/** Run the creation phase against rows marked 'ready'. */
export async function runCreationPhase(
  prisma: PrismaClient,
  jobId: string,
  createFn: (row: JobRow) => Promise<{ id: string; slug: string }>,
): Promise<void> {
  if (inflight.has(jobId)) return;
  const abort = new AbortController();
  inflight.set(jobId, { abort });
  try {
    const job = await prisma.bulkAddJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const items = job.items as unknown as JobRow[];
    await saveJobState(prisma, jobId, items, { status: 'running', phase: 'create' });
    let cursor = 0;
    const next = (): number => cursor++;
    const updateRow = async (idx: number, patch: Partial<JobRow>) => {
      items[idx] = { ...items[idx]!, ...patch };
      await saveJobState(prisma, jobId, items);
    };
    const workers = Array.from({ length: CONCURRENCY }).map(async () => {
      while (!abort.signal.aborted) {
        const idx = next();
        if (idx >= items.length) break;
        const row = items[idx]!;
        if (row.status !== 'ready') continue;
        await updateRow(idx, { status: 'creating' });
        try {
          const r = await createFn(row);
          await updateRow(idx, { status: 'created', createdId: r.id, createdSlug: r.slug });
        } catch (e) {
          await updateRow(idx, { status: 'create-failed', error: (e as Error).message });
        }
      }
    });
    await Promise.all(workers);
    if (!abort.signal.aborted) {
      await saveJobState(prisma, jobId, items, { status: 'completed', phase: 'done' });
    } else {
      await saveJobState(prisma, jobId, items, { status: 'cancelled' });
    }
  } finally {
    inflight.delete(jobId);
  }
}

/** Cancel any inflight processing for `jobId`. */
export function cancelJob(jobId: string): boolean {
  const tracker = inflight.get(jobId);
  if (!tracker) return false;
  tracker.abort.abort();
  return true;
}

/** Returns true if the job is currently being processed in this process. */
export function isJobRunning(jobId: string): boolean {
  return inflight.has(jobId);
}

/**
 * On process startup, mark any jobs whose status was 'running' but no
 * longer in-memory as 'interrupted' so the curator can resume them.
 * Any row that was 'fetching' or 'creating' at process death is marked
 * 'failed' with an explanatory error.
 */
export async function repairStaleJobs(prisma: PrismaClient): Promise<void> {
  const stale = await prisma.bulkAddJob.findMany({
    where: { status: 'running' },
  });
  for (const job of stale) {
    const items = (job.items as unknown as JobRow[]).map((r) => {
      if (r.status === 'fetching') {
        return { ...r, status: 'queued' as RowStatus, error: undefined };
      }
      if (r.status === 'creating') {
        return {
          ...r,
          status: 'create-failed' as RowStatus,
          error: 'admin server restarted mid-create; retry from the review screen',
        };
      }
      return r;
    });
    await prisma.bulkAddJob.update({
      where: { id: job.id },
      data: {
        items: items as unknown as object,
        totals: computeTotals(items) as unknown as object,
        status: 'interrupted',
      },
    });
  }
}
