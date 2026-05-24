/**
 * Observability event logger.
 *
 * Persists every meaningful event (HTTP request, job run, error,
 * external call, RAG ingest, …) into ObservabilityEvent so the admin
 * "Observability" page can search, trace, and replay system history.
 *
 * Two entry points:
 *
 *   • record({ severity, source, message, … }) — explicit call site.
 *   • installHttpHook(app) — attaches Fastify onRequest/onResponse
 *     hooks that auto-log every HTTP request with method, url, status
 *     and duration; correlates DB and external calls via a trace id
 *     stored on the request.
 *
 * Writes are batched + debounced (small in-memory queue flushed every
 * 250 ms) so a busy admin doesn't bottleneck on per-event INSERTs.
 * On process exit we flush whatever is buffered so logs aren't lost.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export type Severity = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type Source = 'http' | 'job' | 'rag' | 'enrich' | 'payment' | 'admin' | 'system' | 'external' | 'db';

export interface ObsEvent {
  severity: Severity;
  source: Source;
  message: string;
  traceId?: string | null;
  userId?: string | null;
  durationMs?: number;
  details?: Record<string, unknown>;
}

let prismaRef: PrismaClient | null = null;
const buffer: ObsEvent[] = [];
const FLUSH_INTERVAL_MS = 250;
const MAX_BUFFER = 500; // flush early if we exceed this many pending

let flushTimer: NodeJS.Timeout | null = null;

async function flushNow(): Promise<void> {
  if (!prismaRef || buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await prismaRef.observabilityEvent.createMany({
      data: batch.map((e) => ({
        severity: e.severity,
        source: e.source,
        message: e.message,
        traceId: e.traceId ?? null,
        userId: e.userId ?? null,
        durationMs: e.durationMs ?? null,
        details: (e.details ?? {}) as unknown as object,
      })),
    });
  } catch (err) {
    // Don't let logging break the host process. Drop the batch but
    // print a console line so the operator notices.
    // eslint-disable-next-line no-console
    console.warn(`[observability] failed to persist ${batch.length} events: ${(err as Error).message}`);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushNow();
  }, FLUSH_INTERVAL_MS);
}

/** Record an event. Returns immediately; writes are batched. */
export function record(event: ObsEvent): void {
  if (!prismaRef) return;
  buffer.push(event);
  if (buffer.length >= MAX_BUFFER) {
    void flushNow();
  } else {
    scheduleFlush();
  }
}

/** Convenience helpers. */
export const obs = {
  info(source: Source, message: string, details?: Record<string, unknown>): void {
    record({ severity: 'info', source, message, details });
  },
  warn(source: Source, message: string, details?: Record<string, unknown>): void {
    record({ severity: 'warn', source, message, details });
  },
  error(source: Source, message: string, err?: unknown, details?: Record<string, unknown>): void {
    const e = err as Error | undefined;
    record({
      severity: 'error',
      source,
      message,
      details: { ...details, errorName: e?.name, errorMessage: e?.message, stack: e?.stack },
    });
  },
};

/** Initialise — must be called once before any record() / installHttpHook(). */
export function initObservability(prisma: PrismaClient): void {
  prismaRef = prisma;
  // Flush remaining events on exit so logs aren't lost.
  const shutdown = () => {
    void flushNow();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('beforeExit', shutdown);
}

/**
 * Attach Fastify hooks that log every request with method, url, status
 * code and duration. Adds a request-scoped traceId so downstream
 * record() calls can correlate.
 */
export function installHttpHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    const r = req as FastifyRequest & { _obs?: { traceId: string; startedAt: number } };
    r._obs = { traceId: randomUUID(), startedAt: Date.now() };
  });
  app.addHook('onResponse', async (req, reply) => {
    const r = req as FastifyRequest & { _obs?: { traceId: string; startedAt: number } };
    if (!r._obs) return;
    const durationMs = Date.now() - r._obs.startedAt;
    const status = reply.statusCode;
    const severity: Severity =
      status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    record({
      severity,
      source: 'http',
      message: `${req.method} ${req.url} → ${status}`,
      traceId: r._obs.traceId,
      durationMs,
      details: {
        method: req.method,
        url: req.url,
        status,
        ip: req.ip,
        ua: req.headers['user-agent'],
      },
    });
  });
  app.addHook('onError', async (req, _reply, err) => {
    const r = req as FastifyRequest & { _obs?: { traceId: string } };
    record({
      severity: 'error',
      source: 'http',
      message: `${req.method} ${req.url} → ${err.name}: ${err.message}`,
      traceId: r._obs?.traceId,
      details: {
        method: req.method,
        url: req.url,
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
      },
    });
  });
}
