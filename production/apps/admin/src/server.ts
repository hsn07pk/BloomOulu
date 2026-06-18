/**
 * BloomOulu Admin — AdminJS + Fastify.
 *
 * Mounted at `/admin`. Behind Caddy's @adminAllowed IP allowlist in production.
 *
 * Provides CRUD over every Prisma resource, with custom panels for:
 *   - Translations editor (Moodle-style key-value bulk editor)
 *   - Pricing editor (effective-dated tier prices)
 *   - Email template editor (MJML)
 *   - Feature flags + system settings
 *   - Webhook log + retry
 *   - Reconciliation (bank CSV upload + match)
 *   - RAG corpus management
 *   - Audit log viewer
 *   - Backup trigger
 *
 * Non-technical-friendly: every field has a description; every settings value
 * has a "Restore default" button (rendered via custom React component); every
 * destructive action prompts for confirmation; locale switcher in the header.
 */
import Fastify from 'fastify';
import AdminJS, { ComponentLoader } from 'adminjs';
import AdminJSFastify from '@adminjs/fastify';
import { Database, Resource, getModelByName } from '@adminjs/prisma';
import { PrismaClient } from '@prisma/client';
import { completeDonation } from '@bloomoulu/db';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import bcrypt from 'bcryptjs';
import { Signer } from '@fastify/cookie';
import { MemoryStore } from '@fastify/session';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import {
  cancelJob as cancelBulkAddJob,
  computeTotals as bulkAddJobTotals,
  isJobRunning as isBulkAddJobRunning,
  repairStaleJobs as repairStaleBulkAddJobs,
  runCreationPhase as runBulkAddCreationPhase,
  runEnrichmentPhase as runBulkAddEnrichmentPhase,
  type JobRow as BulkAddJobRow,
} from './bulk-add-job.js';
import {
  ingestPlantIntoRagAsync,
  ragHookOnPlantWrite,
  reconcilePlantRagDocuments,
} from './rag-ingest.js';
import {
  initObservability,
  installHttpHook,
  obs,
} from './observability.js';

/**
 * Loads the BloomOulu admin global stylesheet from disk.
 *
 * In dev (tsx) `import.meta.url` points at src/server.ts → reads
 * src/styles/global.css. In prod the compiled file is dist/server.js
 * and the build script copies src/styles to dist/styles, so the same
 * relative resolution works. A third candidate covers the case where
 * the dist tree was produced without the copy step (e.g. a stale dev
 * build) — we still ship the design system rather than serve nothing.
 *
 * Cached at startup so each request is a header-only response.
 */
function loadAdminGlobalCss(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../styles/global.css'),
    path.resolve(here, '../../src/styles/global.css'),
    path.resolve(here, 'styles/global.css'),
  ];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  console.warn('[admin] global.css not found — admin UI will render unstyled');
  return '/* BloomOulu admin global.css not found at server start */';
}
const ADMIN_GLOBAL_CSS = loadAdminGlobalCss();

/**
 * Shared Plant-create helper used by both the single-shot
 * /admin/plants/create-from-assistant endpoint AND the bulk-job
 * processor. Encapsulates: slug normalisation, Taxon upsert, enum
 * coercion, optional PlantImage attachment, and audit-log entry.
 */
interface AssistantPlantDto {
  latinName?: string;
  family?: string;
  slug?: string;
  nameEn?: string;
  nameFi?: string;
  nameSv?: string;
  redListStatus?: string;
  origin?: string;
  storyEn?: string;
  storyFi?: string;
  storySv?: string;
  imageUrl?: string;
  attribution?: string;
  licenseSpdx?: string;
}
async function createPlantFromAssistantDto(
  dto: AssistantPlantDto,
  actorUserId: string | null,
): Promise<{ id: string; slug: string; alreadyExisted?: boolean }> {
  const latinName = (dto.latinName ?? '').trim();
  if (!latinName) throw new Error('latinName is required');
  const slug =
    (dto.slug ??
      latinName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) ||
    latinName.toLowerCase();
  const existing = await prisma.plant.findUnique({ where: { slug } });
  if (existing) return { id: existing.id, slug: existing.slug, alreadyExisted: true };
  const taxon = await prisma.taxon.upsert({
    where: { latinName },
    update: dto.family ? { family: dto.family } : {},
    create: { latinName, family: dto.family ?? 'Unknown' },
  });
  const story =
    dto.storyEn || dto.storyFi || dto.storySv
      ? { en: dto.storyEn ?? '', fi: dto.storyFi ?? '', sv: dto.storySv ?? '' }
      : { en: '', fi: '', sv: '' };
  const RED_LIST = new Set(['LC', 'NT', 'VU', 'EN', 'CR', 'EX', 'DD', 'NA']);
  const incoming = (dto.redListStatus ?? '').toUpperCase();
  const safeRedList = RED_LIST.has(incoming) ? incoming : 'NA';
  const plant = await prisma.plant.create({
    data: {
      slug,
      taxonId: taxon.id,
      nameEn: dto.nameEn ?? latinName,
      nameFi: dto.nameFi ?? dto.nameEn ?? latinName,
      nameSv: dto.nameSv ?? dto.nameEn ?? latinName,
      redListStatus: safeRedList as any,
      redListYear: 2019,
      origin: dto.origin ?? '',
      habitat: '',
      biome: '',
      bloomSeason: 'all' as any,
      story,
      quickFacts: [],
      status: 'active',
    },
  });
  if (dto.imageUrl) {
    const image = await prisma.plantImage.create({
      data: {
        plantId: plant.id,
        url: dto.imageUrl,
        altEn: plant.nameEn,
        altFi: plant.nameFi,
        altSv: plant.nameSv,
        attribution: dto.attribution ?? '',
        licenseSpdx: dto.licenseSpdx ?? 'CC-BY-4.0',
      },
    });
    await prisma.plant.update({
      where: { id: plant.id },
      data: { primaryImageId: image.id },
    });
  }
  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'admin.plant.create-from-assistant',
      resource: `Plant/${plant.id}`,
    },
  });
  // Auto-ingest into AskTheGarden RAG corpus. Fire-and-forget so a
  // transient Ollama failure doesn't block the create; the job itself
  // has 5 retries with exponential back-off.
  ingestPlantIntoRagAsync(prisma, plant.id);
  return { id: plant.id, slug: plant.slug };
}

/** Marshal a JobRow's selected fields into the assistant create DTO. */
function jobRowToCreateDto(row: BulkAddJobRow): AssistantPlantDto {
  const dto: AssistantPlantDto = {
    latinName: row.latinName,
    family: row.family,
    nameEn: row.nameEn,
    nameFi: row.nameFi,
    nameSv: row.nameSv,
  };
  const preview = row.preview as
    | {
        story?: { value: { en?: string; fi?: string; sv?: string } } | null;
        origin?: { value: string } | null;
        status?: { value: string } | null;
        image?: { value: { url?: string; attribution?: string; licenseSpdx?: string } } | null;
      }
    | undefined;
  const keep = row.keep ?? { story: true, origin: true, status: true, image: true };
  if (preview) {
    if (keep.origin && preview.origin) dto.origin = preview.origin.value;
    if (keep.status && preview.status) dto.redListStatus = preview.status.value;
    if (keep.story && preview.story) {
      dto.storyEn = preview.story.value.en ?? '';
      dto.storyFi = preview.story.value.fi ?? '';
      dto.storySv = preview.story.value.sv ?? '';
    }
    if (keep.image && preview.image) {
      dto.imageUrl = preview.image.value.url;
      dto.attribution = preview.image.value.attribution;
      dto.licenseSpdx = preview.image.value.licenseSpdx;
    }
  }
  return dto;
}

const queueConn = { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } };
const emailQueue = new Queue('email', queueConn);
const receiptQueue = new Queue('receipt', queueConn);
const eraseQueue = new Queue('gdpr-erase', queueConn);
const enrichQueue = new Queue('plant-enrich', queueConn);

// Redis publisher for real-time propagation. Every CRUD action in the
// admin panel publishes to `admin.changed`, which the API SettingsService
// subscribes to (invalidates its in-memory cache) and the API SSE
// endpoint `/v1/events` fans out to every open browser tab so each
// dashboard refreshes immediately, no hard reload required.
const redisPub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
async function broadcastChange(resource: string, action: 'new' | 'edit' | 'delete' | 'bulkDelete', recordId?: string) {
  try {
    await redisPub.publish(
      'admin.changed',
      JSON.stringify({ resource, action, recordId: recordId ?? null, ts: Date.now() }),
    );
    // SettingsService also subscribes to 'settings.updated' specifically,
    // so when the resource is SystemSetting we publish both channels.
    if (resource === 'SystemSetting') {
      await redisPub.publish(
        'settings.updated',
        JSON.stringify({ key: recordId ?? null, ts: Date.now() }),
      );
    }
  } catch (err) {
    console.warn(`[admin] pubsub publish failed: ${(err as Error).message}`);
  }
}

/** Wrap any existing actions block with broadcast `after` hooks so every
 *  mutation publishes a Redis pub/sub message. We preserve the original
 *  action options and chain a new `after` handler. */
function withBroadcast(actions: Record<string, any> = {}, resourceName: string): Record<string, any> {
  const wrap = (action: 'new' | 'edit' | 'delete' | 'bulkDelete') => {
    const original = actions[action] ?? {};
    const prevAfter = original.after;
    return {
      ...original,
      after: async (response: any, request: any, context: any) => {
        const next = typeof prevAfter === 'function'
          ? await prevAfter(response, request, context)
          : response;
        const recordId =
          next?.record?.params?.id ??
          response?.record?.params?.id ??
          request?.params?.recordId ??
          undefined;
        void broadcastChange(resourceName, action, recordId);
        return next;
      },
    };
  };
  return {
    ...actions,
    new: wrap('new'),
    edit: wrap('edit'),
    delete: wrap('delete'),
    bulkDelete: wrap('bulkDelete'),
  };
}

AdminJS.registerAdapter({ Database, Resource });

// Prisma client wrapped so every write fires a Redis pub/sub broadcast.
// AdminJS uses Prisma for CRUD; intercepting at the client level catches
// every mutation regardless of which resource UI triggered it, with no
// per-resource boilerplate.
const basePrisma = new PrismaClient();
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        const writes = new Set([
          'create', 'createMany', 'update', 'updateMany',
          'upsert', 'delete', 'deleteMany',
        ]);
        if (writes.has(operation)) {
          const id = (result as any)?.id ?? (args as any)?.where?.id ?? undefined;
          void broadcastChange(model, operation as any, id);
          // Auto-re-ingest into AskTheGarden RAG corpus on any write
          // that could change a chatbot-visible fact. Idempotent — the
          // ingest hook hashes the body and skips re-embed when there's
          // no real change.
          //
          // The models below are everything the bot draws on:
          //   • Plant / PlantImage / Taxon → per-plant doc
          //   • Accession / AudioNarration / PlantCitation → per-plant
          //     secondary records embedded in the plant doc body
          //   • ContentBlock → CMS copy (about page etc.)
          //   • SystemSetting → garden config doc (hours, curator, etc.)
          if (
            model === 'Plant' ||
            model === 'PlantImage' ||
            model === 'Taxon' ||
            model === 'Accession' ||
            model === 'AudioNarration' ||
            model === 'PlantCitation' ||
            model === 'ContentBlock' ||
            model === 'SystemSetting'
          ) {
            void ragHookOnPlantWrite(basePrisma as any, model, operation, args, result);
          }
        }
        return result;
      },
    },
  },
}) as unknown as PrismaClient;

type Role = 'donor' | 'curator' | 'finance' | 'admin';

/**
 * Returns the standard `options.actions` block that gates every CRUD action
 * on a resource to the given roles. ADR-0007 mandates the matrix:
 *   • curator → Plant/Accession/Taxon/PlantImage/AudioNarration/Citation/RAG
 *   • finance → Payment/Receipt/TaxCertificate/ProcessedEvent/Reconciliation
 *   • admin   → everything (Settings/Translations/role assignment/audit)
 * Donor-role accounts never see /admin (the bootstrap auth check refuses
 * them at sign-in), but an extra explicit deny keeps the gate defence-in-depth.
 */
function restrictTo(...allowed: Role[]) {
  const allow = new Set<Role>(allowed);
  const guard = ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
    allow.has((currentAdmin?.role as Role) ?? 'donor');
  // Read actions
  const read = { isAccessible: guard };
  // Write actions — also forbidden when the role is read-only for this resource.
  const write = { isAccessible: guard };
  return {
    list: read,
    show: read,
    search: read,
    new: write,
    edit: write,
    delete: write,
    bulkDelete: write,
  };
}

// ── camt.054 reconciliation (inline, no extra deps) ────────────────────
// Pure XML tag-extractor. camt.054 is well-formed enough that a regex
// pass nets every field we care about (Ntry, Amt, BookgDt, EndToEndId,
// CdtrRefInf/Ref, Ustrd). Duplicated here instead of in @bloomoulu/db so
// the admin process stays self-contained — same logic also lives in
// apps/api/src/modules/reconciliation/camt054.ts for API-side use.
async function reconcileCamt054Inline(xml: string): Promise<{
  totalEntries: number;
  matched: number;
  unmatched: number;
  duplicates: number;
  mismatched: number;
  matches: Array<{
    paymentId: string;
    orderId: string;
    amountCents: number;
    endToEndId: string | null;
  }>;
}> {
  if (!/camt\.054|BkToCstmrDbtCdtNtfctn|<Ntry/i.test(xml)) {
    throw new Error('Not a camt.054 document');
  }
  const tag = (s: string, name: string): string | null => {
    const m = new RegExp(`<${name}[^>]*>([^<]+)</${name}>`).exec(s);
    return m ? m[1]!.trim() : null;
  };
  const blocks: string[] = [];
  for (const m of xml.matchAll(/<Ntry[^>]*>([\s\S]*?)<\/Ntry>/g)) blocks.push(m[1]!);

  let matched = 0;
  let duplicates = 0;
  let mismatched = 0;
  const matches: Array<{ paymentId: string; orderId: string; amountCents: number; endToEndId: string | null }> = [];
  let unmatched = 0;
  const toReceipt: string[] = [];

  // Pull pending bank-transfer payments once and match RF references in JS the
  // SAME way the API reconciliation endpoint does — `orderId` is a lowercase
  // dashed UUID while the RF body is uppercase + dash-stripped, so Prisma's
  // case-sensitive `contains` can never match. The RF body is the reference
  // minus the leading "RF" + 2 check digits (4 chars).
  const pending = await prisma.payment.findMany({
    where: { status: 'pending', provider: 'bank_transfer' },
    orderBy: { createdAt: 'desc' },
    take: 2000,
    select: { id: true, orderId: true, donationId: true, amountCents: true },
  });
  const usedIds = new Set<string>();
  const normId = (o: string) => o.replace(/-/g, '').toUpperCase();

  for (const block of blocks) {
    const cdtDbtInd = tag(block, 'CdtDbtInd');
    if (cdtDbtInd && cdtDbtInd.toUpperCase() !== 'CRDT') continue;
    const am = /<Amt[^>]*Ccy="([A-Z]{3})"[^>]*>([0-9.,]+)<\/Amt>/.exec(block);
    if (!am) continue;
    const amountCents = Math.round(Number.parseFloat(am[2]!.replace(',', '.')) * 100);
    const bookedAt = new Date(tag(block, 'BookgDt') ?? tag(block, 'ValDt') ?? new Date().toISOString());
    const endToEndId = tag(block, 'EndToEndId');
    const refM = /<CdtrRefInf>[\s\S]*?<Ref>([^<]+)<\/Ref>[\s\S]*?<\/CdtrRefInf>/.exec(block);
    const rfReference = refM ? refM[1]!.trim() : null;
    const unstructured = tag(block, 'Ustrd');

    if (endToEndId) {
      const dup = await prisma.payment.findFirst({
        where: { providerPaymentRef: endToEndId },
        select: { id: true },
      });
      if (dup) {
        duplicates++;
        continue;
      }
    }

    let payment: { id: string; orderId: string; donationId: string | null; amountCents: number } | null = null;
    if (rfReference) {
      const rfBody = rfReference.replace(/\s/g, '').toUpperCase().slice(4);
      payment = pending.find((p) => !usedIds.has(p.id) && normId(p.orderId).startsWith(rfBody)) ?? null;
    }
    if (!payment && unstructured) {
      const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(unstructured);
      if (uuid) {
        const lc = uuid[1]!.toLowerCase();
        payment = pending.find((p) => !usedIds.has(p.id) && p.orderId === lc) ?? null;
      }
    }

    if (!payment) {
      unmatched++;
      continue;
    }
    // Never auto-complete an under/overpayment — flag it for manual review
    // (mirrors the API reconciliation amount guard).
    if (payment.amountCents !== amountCents) {
      mismatched++;
      await prisma.auditLog.create({
        data: {
          action: 'reconcile.camt054.amountMismatch',
          resource: `Payment/${payment.id}`,
          after: { expected: payment.amountCents, got: amountCents, endToEndId, rfReference },
        },
      });
      continue;
    }
    usedIds.add(payment.id);
    const matchedPayment = payment;
    // Mark the payment succeeded AND complete the donation (which bumps the
    // plant counters) in one transaction — the previous code only flipped the
    // Payment, leaving the Donation stuck 'pending' with no receipt.
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: matchedPayment.id },
        data: { status: 'succeeded', receivedAt: bookedAt, providerPaymentRef: endToEndId },
      });
      if (matchedPayment.donationId) {
        await completeDonation(tx, matchedPayment.donationId, bookedAt);
      }
      await tx.auditLog.create({
        data: {
          action: 'reconcile.camt054.matched',
          resource: `Payment/${matchedPayment.id}`,
          after: { endToEndId, rfReference, amountCents, bookedAt: bookedAt.toISOString() },
        },
      });
    });
    toReceipt.push(matchedPayment.id);
    matched++;
    matches.push({ paymentId: matchedPayment.id, orderId: matchedPayment.orderId, amountCents, endToEndId });
  }

  // Enqueue the donor receipt PDF + email for each completed gift (after the
  // DB commits). Dedup by jobId so a re-upload doesn't double-send.
  for (const pid of toReceipt) {
    await receiptQueue.add(
      'render',
      { paymentId: pid },
      {
        jobId: `receipt-${pid}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 30 * 86_400 },
      },
    );
  }

  return { totalEntries: blocks.length, matched, unmatched, duplicates, mismatched, matches };
}

// Shorthand presets for each ADR-0007 surface.
const CURATOR_OR_ADMIN = ['curator', 'admin'] as const;
const FINANCE_OR_ADMIN = ['finance', 'admin'] as const;
const ADMIN_ONLY = ['admin'] as const;

// ── Disbursement helpers (used by the manual-draft admin actions) ────
// Each returns a [start, end] window in UTC; createDraft uses these to
// scope the included Payments. Pure functions — no side effects.
function prevMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
  return { start, end };
}
function prevWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  // ISO week, Monday-anchored. End = last Sunday 23:59:59.999.
  const dow = now.getUTCDay() || 7;
  const endOfPrevWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  endOfPrevWeek.setUTCHours(23, 59, 59, 999);
  const start = new Date(endOfPrevWeek.getTime() - 6 * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end: endOfPrevWeek };
}
function monthToDateRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: now };
}

/**
 * Allocates a gapless year-prefixed reference and creates a draft
 * Disbursement covering every succeeded Payment in [start, end] that
 * isn't already in a non-cancelled disbursement. Returns an AdminJS
 * notice describing the outcome.
 */
async function draftForRange(
  ctx: any,
  range: { start: Date; end: Date },
  label: string,
): Promise<{ notice: { message: string; type: 'success' | 'info' | 'error' } }> {
  const actorUserId = (ctx?.currentAdmin?.id as string | undefined) ?? null;
  // Allocate DISB-YYYY-NNN sequentially. The year prefix is taken from
  // periodEnd so a Jan disbursement covering December stays in the prior
  // year's counter — matches the api's allocateReference logic.
  const year = range.end.getUTCFullYear();
  const result = await prisma.$transaction(async (tx) => {
    const count = await tx.disbursement.count({
      where: { reference: { startsWith: `DISB-${year}-` } },
    });
    const reference = `DISB-${year}-${String(count + 1).padStart(3, '0')}`;
    const eligible = await tx.payment.findMany({
      where: {
        status: 'succeeded',
        receivedAt: { gte: range.start, lte: range.end },
        NOT: {
          disbursementEntries: {
            some: {
              included: true,
              disbursement: { status: { not: 'cancelled' } },
            },
          },
        },
      },
      select: { id: true, amountCents: true, feeCents: true },
    });
    if (eligible.length === 0) {
      return { reference, count: 0, totalCents: 0 } as const;
    }
    const expected = eligible.reduce((s, p) => s + p.amountCents, 0);
    const fees = eligible.reduce((s, p) => s + p.feeCents, 0);
    const net = expected - fees;
    const d = await tx.disbursement.create({
      data: {
        reference,
        periodStart: range.start,
        periodEnd: range.end,
        status: 'draft',
        expectedCents: expected,
        feeCents: fees,
        netCents: net,
        createdByUserId: actorUserId,
        entries: {
          create: eligible.map((p) => ({
            paymentId: p.id,
            amountCents: p.amountCents,
            feeCents: p.feeCents,
            netCents: p.amountCents - p.feeCents,
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'admin.disbursement.draft',
        resource: `Disbursement/${d.id}`,
      },
    });
    return { reference: d.reference, count: eligible.length, totalCents: expected } as const;
  });

  if (result.count === 0) {
    return {
      notice: {
        message: `No succeeded payments in window (${label}). Nothing drafted.`,
        type: 'info',
      },
    };
  }
  return {
    notice: {
      message: `Drafted ${result.reference} covering ${result.count} payment(s) totalling €${(result.totalCents / 100).toFixed(2)} (${label}).`,
      type: 'success',
    },
  };
}

/**
 * Builds the handler for the Plant "Enrich" record actions. Enqueues a
 * plant-enrich job — the API worker fetches story / origin / conservation
 * status / photo from open data and writes them to the plant — and
 * audit-logs who triggered it. `overwrite` false = fill empty fields only,
 * so a curator's own edits are never clobbered.
 */
function enrichHandler(overwrite: boolean) {
  return async (_req: any, _res: any, ctx: any) => {
    const plantId = ctx.record!.params['id'];
    await enrichQueue.add(
      'enrich',
      { plantId, overwrite, requestedBy: ctx.currentAdmin?.id ?? null },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        // One in-flight enrichment per plant; the id frees on completion.
        jobId: `enrich-${plantId}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    await prisma.auditLog.create({
      data: {
        actorUserId: ctx.currentAdmin?.id ?? null,
        action: overwrite ? 'admin.plant.enrich.overwrite' : 'admin.plant.enrich',
        resource: `Plant/${plantId}`,
      },
    });
    return {
      record: ctx.record!.toJSON(ctx.currentAdmin),
      notice: {
        message:
          'Enrichment queued — it runs in the background (~30 s). Refresh this page to see the ' +
          'filled fields, or check Operations → Job Runs.',
        type: 'success',
      },
    };
  };
}

// AdminJS 7 replaced the static `AdminJS.bundle()` helper with an instance-
// based ComponentLoader. Custom React panels register with the loader; the
// returned token is passed as `component` to page/action definitions.
const here = path.dirname(fileURLToPath(import.meta.url));
const componentLoader = new ComponentLoader();
const SettingsPage = componentLoader.add('Settings', path.join(here, 'pages/Settings'));
const TranslationsPage = componentLoader.add('Translations', path.join(here, 'pages/Translations'));
const BackupsPage = componentLoader.add('Backups', path.join(here, 'pages/Backups'));
const ReconciliationPage = componentLoader.add('Reconciliation', path.join(here, 'pages/Reconciliation'));
const DashboardPage = componentLoader.add('Dashboard', path.join(here, 'pages/Dashboard'));
// Tiny stub component — useEffect → window.location.assign('/admin/downloads')
// so the sidebar Downloads entry bails out of the SPA into the static
// Fastify-rendered page that actually has working download links.
const DownloadsRedirectPage = componentLoader.add('DownloadsRedirect', path.join(here, 'pages/DownloadsRedirect'));
const IngestDocPage = componentLoader.add('IngestDoc', path.join(here, 'pages/IngestDoc'));
const GardenIdentityPage = componentLoader.add('GardenIdentity', path.join(here, 'pages/GardenIdentity'));
const PaymentProvidersPage = componentLoader.add('PaymentProviders', path.join(here, 'pages/PaymentProviders'));
const CuratorConfigPage = componentLoader.add('CuratorConfig', path.join(here, 'pages/CuratorConfig'));
const AdoptionConfigPage = componentLoader.add('AdoptionConfig', path.join(here, 'pages/AdoptionConfig'));
const QrMetricsPage = componentLoader.add('QrMetrics', path.join(here, 'pages/QrMetrics'));
const QrLabelConfigPage = componentLoader.add('QrLabelConfig', path.join(here, 'pages/QrLabelConfig'));
const BulkQrPrintPage = componentLoader.add('BulkQrPrint', path.join(here, 'pages/BulkQrPrint'));
const EnrichmentConfigPage = componentLoader.add('EnrichmentConfig', path.join(here, 'pages/EnrichmentConfig'));
const EnrichmentReviewPage = componentLoader.add('EnrichmentReview', path.join(here, 'pages/EnrichmentReview'));
const EnrichmentAssistantPage = componentLoader.add('EnrichmentAssistant', path.join(here, 'pages/EnrichmentAssistant'));
const BulkAddPlantsPage = componentLoader.add('BulkAddPlants', path.join(here, 'pages/BulkAddPlants'));
// Sidebar-facing hub pages — these wrap the individual panels in Tabs
// so the sidebar shows three uncluttered links instead of fifteen.
const ConfigurePage = componentLoader.add('Configure', path.join(here, 'pages/Configure'));
const PlantToolsPage = componentLoader.add('PlantTools', path.join(here, 'pages/PlantTools'));
const OperationsPage = componentLoader.add('Operations', path.join(here, 'pages/Operations'));
const ObservabilityPage = componentLoader.add('Observability', path.join(here, 'pages/Observability'));
// Silence unused-locals — the loader still has to bundle these so the
// hub pages can import them as React components.
void EnrichmentConfigPage;
void EnrichmentReviewPage;
void EnrichmentAssistantPage;
void BulkAddPlantsPage;
void GardenIdentityPage;
void PaymentProvidersPage;
void CuratorConfigPage;
void AdoptionConfigPage;
void QrLabelConfigPage;
void BulkQrPrintPage;
void SettingsPage;
void TranslationsPage;
void BackupsPage;
void ReconciliationPage;
void IngestDocPage;

// ── Admin → API bearer token ────────────────────────────────────────────────
// The api guards /v1/admin/* with RolesGuard, which requires an HS256 Bearer
// JWT ({ sub, role }) signed with AUTH_SECRET — NOT the AdminJS session cookie.
// AdminJS pages reach the api via authedJson through the public web /v1 proxy,
// so they must attach such a Bearer. We mint one here (admin + api share
// AUTH_SECRET) for the logged-in admin and hand it to the browser via the
// dashboard handler below. Hand-rolled HS256 (node:crypto) so we don't add a
// jose dependency; the byte layout is identical to what the api's jose verify
// expects (key = utf-8 bytes of AUTH_SECRET, unpadded base64url segments).
function mintApiToken(sub: string, role: string): string {
  const secret = process.env.AUTH_SECRET ?? 'dev-secret';
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, role, iat: now, exp: now + 12 * 60 * 60 });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// AdminJS 7's exported types are looser than its runtime accepts (page `label`,
// `branding.softwareBrothers`, the static `AdminJS.bundle` helper, action
// handlers `(req, res, ctx)` signature). We cast the config to `any` so the
// compile-time types don't fight the runtime API — every flagged property is
// in fact supported by `adminjs@7.8`. Document any further casts inline.
const adminConfig = new AdminJS({
  rootPath: '/admin',
  componentLoader,
  // Replace the AdminJS welcome page with the BloomOulu dashboard.
  // The component fetches /admin/dashboard-stats every 30s and renders metrics
  // tiles + curator escalations + quick-action links.
  // The handler (GET /admin/api/dashboard, AdminJS-routed with currentAdmin
  // from the session) mints a short-lived api Bearer for the logged-in admin —
  // pages call ApiClient().getDashboard() to obtain it, then attach it to
  // guarded /v1/admin/* fetches (see pages/QrMetrics.tsx authedJson).
  dashboard: {
    component: DashboardPage,
    handler: async (
      _req: unknown,
      _res: unknown,
      context: { currentAdmin?: { id?: string; role?: string } },
    ) => {
      const ca = context?.currentAdmin;
      if (!ca?.id || !ca.role) return { apiToken: null };
      return { apiToken: mintApiToken(ca.id, ca.role) };
    },
  } as any,
  branding: {
    companyName: 'BloomOulu',
    softwareBrothers: false,
    withMadeWithLove: false,
    favicon: '/admin/static/favicon.ico',
    logo: false,
    theme: {
      colors: {
        primary100: '#2D5440',
        primary80:  '#3D6A52',
        primary60:  '#5FB0A0',
        primary40:  '#88A050',
        primary20:  '#E8EEDE',
        accent:     '#A8C060',
      },
    },
  },
  // Inject the BloomOulu design-system stylesheet on every admin route.
  // The file is served by the onRequest hook at /admin/static/global.css
  // from src/styles/global.css (dev) or dist/styles/global.css (prod —
  // copied by the `build` script). See src/pages/shared/ui.tsx for the
  // matching React primitives.
  assets: {
    styles: ['/admin/static/global.css'],
  } as any,
  locale: { language: 'en', availableLanguages: ['en', 'fi'] },
  resources: [
    // ── Catalogue ─────────────────────────────────────────────────────
    {
      resource: { model: getModelByName('Plant'), client: prisma },
      options: {
        navigation: { name: 'Catalogue', icon: 'Plants' },
        listProperties: [
          'nameEn', 'nameFi', 'redListStatus', 'bloomSeason',
          'gardenZone', 'status', 'donorCount', 'voteCount', 'fundedCents', 'scanCount',
        ],
        // Form rendered on /admin/resources/Plant/actions/new and /…/edit.
        // Every column on the public site (web app PlantCard, kiosk plant
        // page) and every field the open-data enrichment writes is listed
        // here so a curator can fill them all without dropping into the
        // database. Counters (donorCount, voteCount, fundedCents, scanCount) are
        // intentionally read-only — see showProperties + filterProperties.
        editProperties: [
          'slug', 'taxonId',
          'nameEn', 'nameFi', 'nameSv',
          'redListStatus', 'redListYear',
          'origin', 'habitat', 'biome',
          'bloomSeason', 'bloomWindow',
          'story', 'quickFacts',
          'primaryImageId',
          'microLat', 'microLng', 'gardenZone',
          'targetCents', 'status',
        ],
        showProperties: [
          'id', 'slug', 'taxonId',
          'nameEn', 'nameFi', 'nameSv',
          'redListStatus', 'redListYear',
          'origin', 'habitat', 'biome',
          'bloomSeason', 'bloomWindow',
          'story', 'quickFacts',
          'primaryImageId',
          'microLat', 'microLng', 'gardenZone',
          'targetCents', 'fundedCents', 'donorCount', 'voteCount', 'scanCount',
          'status', 'createdAt', 'updatedAt',
        ],
        filterProperties: [
          'nameEn', 'nameFi', 'nameSv', 'slug', 'taxonId',
          'redListStatus', 'bloomSeason', 'status', 'gardenZone',
          'redListYear', 'createdAt', 'updatedAt',
        ],
        properties: {
          slug: { description: 'Short URL slug (kebab-case). Public URL is /plants/{slug}. Must be unique. Once published, do not rename — it breaks external links and QR labels.' },
          taxonId: { description: 'Link to the canonical Taxon row. Create the Taxon first via Catalogue → Taxon → New if it doesn\'t exist yet.' },
          nameEn: { description: 'Common name in English. Shown as the card title on the public site.' },
          nameFi: { description: 'Common name in Finnish (Suomi).' },
          nameSv: { description: 'Common name in Swedish (Svenska).' },
          redListStatus: { description: 'IUCN / Finnish Red List category: CR · EN · VU · NT · LC · DD · NE · NA. Stored at full precision here; the public site collapses it to a two-state badge — "Endangered" (CR/EN/VU) vs "Non-endangered" (everything else).' },
          redListYear: { description: 'Year the Red-List assessment was published. Defaults to 2019 (Suomen lajien uhanalaisuus).' },
          origin: { description: 'Short native-origin description (≤ 240 chars). e.g. "Northern boreal forests, Fennoscandia". Auto-filled by GBIF if blank.' },
          habitat: { description: 'Habitat type: mire, esker, alpine, riparian, etc. Free text.' },
          biome: { description: 'Wide biome label: boreal, temperate, montane, arctic. Drives the home-page biome filter.' },
          bloomSeason: { description: 'Primary season: Spring · Summer · Autumn · Winter · All. Shown as a badge and drives the homepage filter.' },
          bloomWindow: { description: 'Free-text bloom window. e.g. "April – May". Optional.' },
          story: { description: 'Long-form description per language. JSON: { "en": "…", "fi": "…", "sv": "…" }. Auto-filled by the open-data assistant (Wikipedia / EOL).', type: 'mixed', isArray: false, components: {} },
          quickFacts: { description: 'Bulleted highlights on the public card. JSON array of { "labelKey": "origin", "value": "Häme esker" } objects.', type: 'mixed', isArray: true },
          primaryImageId: { description: 'Hero image shown on the public card. Pick from PlantImage rows attached to this plant (create one first via Catalogue → Plant images → New). Auto-suggested by the enrichment worker.' },
          microLat: { description: 'Latitude of the plant inside the garden (WGS84 decimal). Used for the kiosk wayfinder. Leave blank if not staked.' },
          microLng: { description: 'Longitude of the plant inside the garden (WGS84 decimal).' },
          gardenZone: { description: 'Internal zone code: "south esker bed", "romeo greenhouse pond", etc. Used by curators and the bulk-label printer, not shown to donors.' },
          donorCount: { description: 'Number of completed donations directed to this plant. Denormalised counter — read-only; updated automatically as gifts settle or refund.' },
          voteCount: { description: 'Number of favourites (leaderboard votes) for this plant. Read-only counter.' },
          fundedCents: { description: 'Total amount donated to this plant (in cents). Read-only counter — sourced from Donation rows.' },
          scanCount: { description: 'Lifetime QR scan count. Read-only counter — bumped per insert via PlantsService.recordScan.' },
          targetCents: { description: 'Funding target for this plant (in cents). e.g. €500 = 50000. Shown on the public card as a progress bar.' },
          status: { description: '"active" shows on the public site; "hidden" keeps it off the catalogue; "retired" archives it but keeps the donor record.' },
          createdAt: { description: 'Row creation timestamp. Read-only.' },
          updatedAt: { description: 'Most-recent update timestamp. Read-only; bumped automatically.' },
        },
        sort: { sortBy: 'donorCount', direction: 'desc' as const },
        actions: {
          ...restrictTo(...CURATOR_OR_ADMIN),
          // Fetch story / origin / conservation status / photo from open
          // data (Wikipedia, GBIF, laji.fi, Wikimedia) via a background job.
          enrich: {
            actionType: 'record',
            label: 'Enrich from open data',
            icon: 'Download',
            // AdminJS 7 requires a `component` for any action with a
            // dedicated route. Setting `false` tells AdminJS this is a
            // handler-only action — run the handler, apply the
            // returned `notice`, redirect back to the show page. No
            // custom React component needed.
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'curator'].includes(currentAdmin?.role as string),
            handler: enrichHandler(false),
          },
          enrichOverwrite: {
            actionType: 'record',
            label: 'Re-enrich (overwrite)',
            icon: 'RefreshCw',
            component: false,
            guard:
              'Re-fetch story, origin, conservation status and photo from open data, ' +
              'replacing the current values. Continue?',
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'curator'].includes(currentAdmin?.role as string),
            handler: enrichHandler(true),
          },
        },
      },
    },
    { resource: { model: getModelByName('Taxon'), client: prisma }, options: { navigation: { name: 'Catalogue' }, actions: restrictTo(...CURATOR_OR_ADMIN) } },
    { resource: { model: getModelByName('Accession'), client: prisma }, options: { navigation: { name: 'Catalogue' }, actions: restrictTo(...CURATOR_OR_ADMIN) } },
    { resource: { model: getModelByName('PlantImage'), client: prisma }, options: { navigation: { name: 'Catalogue' }, actions: restrictTo(...CURATOR_OR_ADMIN) } },
    { resource: { model: getModelByName('AudioNarration'), client: prisma }, options: { navigation: { name: 'Catalogue' }, actions: restrictTo(...CURATOR_OR_ADMIN) } },
    { resource: { model: getModelByName('Citation'), client: prisma }, options: { navigation: { name: 'Catalogue' }, actions: restrictTo(...CURATOR_OR_ADMIN) } },
    // ── Donations + donors ─────────────────────────────────────────────
    {
      resource: { model: getModelByName('Donation'), client: prisma },
      options: {
        navigation: { name: 'Donors', icon: 'Heart' },
        listProperties: ['createdAt', 'donorId', 'plantId', 'status', 'amountCents'],
        showProperties: [
          'id', 'createdAt', 'updatedAt', 'status',
          'donorId', 'plantId',
          'amountCents', 'currency',
          'dedication', 'publicName', 'showOnWall', 'anonymous', 'marketingOptIn',
          'startedAt', 'refundedAt',
        ],
        filterProperties: ['status', 'createdAt', 'donorId', 'plantId'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          status: { description: 'pending · completed · failed · refunded. Set automatically by the payment webhook; never edit by hand.' },
          amountCents: { description: 'Gift amount in cents (€25 = 2500).' },
          dedication: { description: 'Optional public message (≤240 chars) shown on the donor wall.' },
          showOnWall: { description: 'When true, the donor appears on the public donor wall. False = hidden.' },
          anonymous: { description: 'When true, the gift is hidden from the donor wall entirely.' },
          marketingOptIn: { description: 'Did the donor agree to occasional newsletter emails at checkout?' },
          publicName: { description: 'Override of donor.name on the public donor wall.' },
          // FK references — AdminJS renders these as clickable chips.
          donorId: { description: 'The donor (User) who gave.', reference: 'User' },
          plantId: { description: 'Optional species the gift was directed to (null = a general donation).', reference: 'Plant' },
        },
        // Donations are immutable from the UI — a settled gift is reversed
        // via the Payment refund flow, not by editing or deleting the row.
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          new: { isAccessible: false },
          delete: { isAccessible: false },
          bulkDelete: { isAccessible: false },
        },
      },
    },
    {
      // User management is admin-only (role assignment, deactivation).
      // Finance can find a donor via the Payment list; curator never
      // needs the User table directly.
      resource: { model: getModelByName('User'), client: prisma },
      options: {
        navigation: { name: 'Donors', icon: 'User' },
        listProperties: ['email', 'name', 'role', 'locale', 'emailVerified', 'createdAt'],
        filterProperties: ['email', 'name', 'role', 'locale', 'createdAt', 'emailVerified', 'deactivatedAt'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          // isTitle marks the property AdminJS uses when rendering a
          // reference chip to a User (e.g. on the Payment show view).
          // Without it, FK fields like Payment.donorId render as blank
          // labels instead of "user@example.com".
          email: { isTitle: true, description: 'Donor email — also the unique sign-in identifier. Type to search.' },
          name: { description: 'Display name shown on receipts and the donor wall.' },
          role: { description: 'donor / curator / finance / admin. Changing a role takes effect on the next session refresh.' },
          locale: { description: 'Preferred language for emails and receipts (en / fi / sv).' },
          emailVerified: { description: 'Timestamp of email confirmation. Blank = the donor has never clicked a verify link.' },
          deactivatedAt: { description: 'Set when an admin deactivates the account; the user can no longer sign in.' },
          passwordHash: { isVisible: false },
          ouluUid: { description: 'University of Oulu SSO subject. Populated only when the donor signed in via OIDC.' },
        },
        actions: restrictTo(...ADMIN_ONLY),
      },
    },
    // ── Finance ────────────────────────────────────────────────────────
    {
      resource: { model: getModelByName('Payment'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'Dollar' },
        listProperties: ['createdAt', 'provider', 'amountCents', 'status', 'donorId', 'orderId'],
        // Explicit show list — leaves out the bare relation fields
        // ("donor" / "adoption") which the Prisma adapter cannot render
        // without a titleProperty, and which were rendering as blank
        // labels in the show view. The FK UUIDs below are clickable
        // references to the related resource instead.
        showProperties: [
          'id',
          'createdAt',
          'updatedAt',
          'status',
          'provider',
          'orderId',
          'providerSessionId',
          'providerPaymentRef',
          'providerCustomerId',
          'donorId',
          'donationId',
          'amountCents',
          'netCents',
          'vatCents',
          'vatRateBp',
          'feeCents',
          'refundedCents',
          'currency',
          'receivedAt',
          'refundedAt',
          'failureCode',
          'failureMessage',
        ],
        filterProperties: ['provider', 'status', 'createdAt', 'amountCents', 'donorId', 'orderId'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          orderId: { description: 'Our idempotency key sent to the payment provider. Search by full or partial id.' },
          providerPaymentRef: { description: 'Provider-side reference (Paytrail transactionId / MobilePay agreement id). Populated when the provider confirms the charge.' },
          providerCustomerId: { description: 'Token / stored-credential id returned after a tokenisation flow. Populated only for recurring or saved-card payments.' },
          providerSessionId: { description: 'Provider-side checkout/session id (Paytrail transactionId, MobilePay paymentId). Set when we redirect the donor.' },
          provider: { description: 'paytrail · mobilepay · bank_transfer.' },
          status: { description: 'pending · succeeded · failed · refunded · cancelled. Pending stays until the webhook fires — see PAYTRAIL_CALLBACK_URL in .env.' },
          amountCents: { description: 'Gross amount in cents (€25 = 2500).' },
          netCents: { description: 'Net amount after VAT split (donation portion) in cents. Equals amountCents for pure donations.' },
          vatCents: { description: 'VAT amount in cents. Zero for pure donations under the Finnish yleishyödyllinen yhteisö rules.' },
          vatRateBp: { description: 'VAT rate in basis points (2400 = 24%). Zero for donations to a Finnish non-profit.' },
          feeCents: { description: 'Provider fee in cents (set from the provider webhook payload on succeeded).' },
          refundedCents: { description: 'Total amount refunded in cents. Non-zero only after a refund action.' },
          receivedAt: { description: 'Webhook arrival timestamp. Empty while the payment is still pending.' },
          refundedAt: { description: 'When a refund was issued, if any.' },
          failureCode: { description: 'Provider-side error code (e.g. card_declined, insufficient_funds). Empty unless status=failed.' },
          failureMessage: { description: 'Human-readable failure reason from the provider. Empty unless status=failed.' },
          // Linked-resource references — AdminJS uses these to render the
          // FK UUID as a clickable chip pointing at the related record's
          // show page, instead of leaving the field blank.
          donorId: { description: 'Donor (the User who paid). Click to open the donor record.', reference: 'User' },
          donationId: { description: 'Donation this payment settled (null if unlinked).', reference: 'Donation' },
        },
        // Financial rows MUST be immutable from the UI: deletes break
        // reconciliation + audit trail. Refunds use the dedicated
        // /v1/admin/payments/:id/refund flow, not row delete.
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          delete: { isAccessible: false },
          bulkDelete: { isAccessible: false },
          new: { isAccessible: false },
          // ── Resend receipt ─────────────────────────────────────────────
          // Fires the receipt processor with `resend: true`, which
          // regenerates the PDF if its blob has gone missing and always
          // enqueues the donor-facing email job. Idempotent — duplicate
          // clicks just stack identical jobs (BullMQ dedupes by jobId
          // suffix when fired within a few ms; otherwise nodemailer
          // sends twice, which is the desired behaviour when the donor
          // explicitly asks "can you send the receipt again?").
          resendReceipt: {
            actionType: 'record',
            label: 'Resend receipt',
            icon: 'Mail',
            component: false,
            isAccessible: ({
              currentAdmin,
              record,
            }: {
              currentAdmin?: { role?: string };
              record?: { params?: Record<string, unknown> };
            }) => {
              const role = currentAdmin?.role as string | undefined;
              if (!['admin', 'finance'].includes(role ?? '')) return false;
              const status = record?.params?.['status'] as string | undefined;
              return status === 'succeeded';
            },
            handler: async (_req: any, _res: any, ctx: any) => {
              const paymentId = ctx.record!.params['id'];
              const actorUserId = ctx.currentAdmin?.id ?? null;
              await receiptQueue.add(
                'render',
                { paymentId, resend: true },
                {
                  // Unique jobId per click so BullMQ doesn't dedupe a
                  // legitimate retry against a still-cached completed job.
                  jobId: `receipt-${paymentId}-resend-${Date.now()}`,
                  attempts: 5,
                  backoff: { type: 'exponential', delay: 5_000 },
                },
              );
              await prisma.auditLog.create({
                data: {
                  actorUserId,
                  action: 'admin.receipt.resend',
                  resource: `Payment/${paymentId}`,
                },
              });
              return { record: ctx.record!.toJSON(ctx.currentAdmin) };
            },
          },
        },
      },
    },
    {
      resource: { model: getModelByName('Receipt'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'FileText' },
        listProperties: ['receiptNumber', 'issuedAt', 'donorEmail', 'totalCents', 'pdfUrl'],
        filterProperties: ['receiptNumber', 'donorEmail', 'issuedAt'],
        sort: { sortBy: 'issuedAt', direction: 'desc' as const },
        properties: {
          receiptNumber: { description: 'Sequential id (BLO-YYYY-000001). Resets each year if "Receipt yearReset" is enabled.' },
          donorEmail: { description: 'Snapshot of the donor email at receipt time (still good if the donor renames later).' },
          totalCents: { description: 'Receipt total in cents.' },
          pdfUrl: { description: 'Local /v1/files/* URL — served directly from STORAGE_DIR (no presign).' },
        },
        // Issued receipts are legally binding. Re-issue a corrected copy,
        // never delete.
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          delete: { isAccessible: false },
          bulkDelete: { isAccessible: false },
          new: { isAccessible: false },
        },
      },
    },
    {
      resource: { model: getModelByName('TaxCertificate'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'Award' },
        // Schema column is `taxYear`, not `year` — the old config referenced
        // a non-existent property which rendered as blank in the list view.
        listProperties: ['taxYear', 'donorId', 'totalCents', 'scheme', 'issuedAt'],
        filterProperties: ['taxYear', 'donorId', 'issuedAt', 'scheme'],
        sort: { sortBy: 'taxYear', direction: 'desc' as const },
        properties: {
          taxYear: { description: 'Tax year covered (e.g. 2026 = donations from 1 Jan 2026 to 31 Dec 2026).' },
          totalCents: { description: 'Sum of deductible donations for that year, in cents.' },
          scheme: { description: 'Which Finnish-tax scheme this certificate falls under (TVL §57 corporate · individual 2026 · informational).' },
          pdfUrl: { description: 'local:// URI — viewable via /v1/files/<key>.' },
          // Same FK-display trick as Payment.donorId — without `reference`,
          // AdminJS renders the FK column blank in the show view.
          donorId: { description: 'Donor receiving the certificate. Click to open the donor record.', reference: 'User' },
        },
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          delete: { isAccessible: false },
          bulkDelete: { isAccessible: false },
          new: { isAccessible: false },
          // ── Generate annual sweep ──────────────────────────────────
          // Resource-level action — appears at the top of the list. Runs
          // the tax-cert-annual processor for the year specified in a
          // ?year=YYYY query string (defaults to "previous year" if
          // unspecified, which matches the cron's behaviour).
          generate: {
            actionType: 'resource',
            label: 'Generate annual sweep',
            icon: 'Calendar',
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes((currentAdmin?.role as string) ?? ''),
            handler: async (req: any, _res: any, ctx: any) => {
              const yearStr = req?.query?.['year'] ?? req?.payload?.['year'];
              const taxYear = Number.parseInt(yearStr ?? '', 10) || (new Date().getUTCFullYear() - 1);
              const actorUserId = ctx.currentAdmin?.id ?? null;
              const taxCertQ = new Queue('tax-cert-annual', queueConn);
              const job = await taxCertQ.add(
                'admin-manual',
                { taxYear },
                {
                  jobId: `tax-cert-manual-${taxYear}-all-${Date.now()}`,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 5_000 },
                },
              );
              await prisma.auditLog.create({
                data: {
                  actorUserId,
                  action: 'admin.taxCert.generate',
                  resource: `TaxYear/${taxYear}`,
                },
              });
              return {
                notice: {
                  message: `Tax cert sweep enqueued for ${taxYear} (job ${job.id}). Refresh in ~10s.`,
                  type: 'success',
                },
              };
            },
          },
          // ── Regenerate single certificate ──────────────────────────
          // Record-level action — re-runs the processor scoped to this
          // donor + year. Use when a PDF is missing or the schema needs
          // to be re-applied (e.g. address change after issuance).
          regenerate: {
            actionType: 'record',
            label: 'Regenerate PDF',
            icon: 'RefreshCw',
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes((currentAdmin?.role as string) ?? ''),
            handler: async (_req: any, _res: any, ctx: any) => {
              const taxYear = Number(ctx.record!.params['taxYear']);
              const donorId = ctx.record!.params['donorId'] as string;
              const actorUserId = ctx.currentAdmin?.id ?? null;
              // The processor's idempotency check skips when a cert already
              // exists with a pdfUrl. Strip pdfUrl first so it regenerates.
              await prisma.taxCertificate.updateMany({
                where: { donorId, taxYear },
                data: { pdfUrl: null },
              });
              const taxCertQ = new Queue('tax-cert-annual', queueConn);
              const job = await taxCertQ.add(
                'admin-regen',
                { taxYear, donorId },
                {
                  jobId: `tax-cert-regen-${donorId}-${taxYear}-${Date.now()}`,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 5_000 },
                },
              );
              await prisma.auditLog.create({
                data: {
                  actorUserId,
                  action: 'admin.taxCert.regenerate',
                  resource: `TaxCertificate/${ctx.record!.params['id']}`,
                },
              });
              return { record: ctx.record!.toJSON(ctx.currentAdmin) };
            },
          },
        },
      },
    },
    {
      resource: { model: getModelByName('ProcessedEvent'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'GitBranch' },
        // Schema column is `processedAt`, NOT `createdAt`. Wrong field
        // name on listProperties/sort breaks the AdminJS records fetch
        // with "There was an error fetching records".
        listProperties: ['provider', 'providerEventId', 'paymentId', 'processedAt'],
        filterProperties: ['provider', 'processedAt'],
        sort: { sortBy: 'processedAt', direction: 'desc' as const },
        properties: {
          provider: { description: 'Source provider of the webhook event.' },
          providerEventId: { description: 'Idempotency key — a duplicate delivery is silently swallowed.' },
          processedAt: { description: 'When the webhook was received + recorded. Newest first.' },
          paymentId: { description: 'The Payment this event applied to (null for replayed/no-op events).', reference: 'Payment' },
        },
        actions: restrictTo(...FINANCE_OR_ADMIN),
      },
    },
    {
      // Disbursement claim packets — the channel through which the
      // University of Oulu's central treasury reimburses the Garden for
      // donations it collected on the Garden's behalf. Status flow:
      // draft → ready → submitted → paid → reconciled. Editing entries
      // is only allowed in `draft`; everything else is immutable to
      // preserve the audit trail.
      resource: { model: getModelByName('Disbursement'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'Repeat' },
        listProperties: [
          'reference', 'status', 'periodStart', 'periodEnd',
          'expectedCents', 'paidCents', 'createdAt',
        ],
        filterProperties: ['status', 'reference', 'periodStart', 'periodEnd'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          reference: { description: 'Gapless year-prefixed reference (DISB-YYYY-NNN). Shown on the claim PDF and the University payment reference.' },
          status: { description: 'draft → ready → submitted → paid → reconciled. cancelled is terminal.' },
          expectedCents: { description: 'Sum of included Payment grosses, in cents.' },
          netCents: { description: 'expectedCents − feeCents — what the University owes the Garden.' },
          paidCents: { description: 'Amount the University actually wired. Compare to netCents to spot drift.' },
          csvUrl: { description: 'Download the canonical CSV claim payload.' },
          csvSha256: { description: 'SHA-256 of the last-generated CSV. Tamper-evidence — re-export to refresh.' },
        },
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          // Status transitions go through the api (audit-logged + role-checked).
          // We deliberately disable bulk delete; cancelled rows stay for audit.
          bulkDelete: { isAccessible: false },
          // The `new` flow draft-creates through /v1/disbursements/draft so
          // entries get bundled atomically. Disable the admin shortcut so
          // staff don't create empty rows by accident.
          new: { isAccessible: false },
          // ── Manual draft generators ────────────────────────────────
          // Three convenience buttons matching the three most common
          // cadences. Each calls the disbursements service with a
          // pre-computed [periodStart, periodEnd] window — staff can
          // adjust entries (uncheck refunded items) before marking
          // the draft Ready. Arbitrary ranges still go through the
          // public POST /v1/disbursements/draft.
          generatePrevMonth: {
            actionType: 'resource',
            label: 'Last month',
            icon: 'Calendar',
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes((currentAdmin?.role as string) ?? ''),
            handler: async (_req: any, _res: any, ctx: any) =>
              draftForRange(ctx, prevMonthRange(), 'last month'),
          },
          generatePrevWeek: {
            actionType: 'resource',
            label: 'Last week',
            icon: 'Calendar',
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes((currentAdmin?.role as string) ?? ''),
            handler: async (_req: any, _res: any, ctx: any) =>
              draftForRange(ctx, prevWeekRange(), 'last week'),
          },
          generateMonthToDate: {
            actionType: 'resource',
            label: 'Month-to-date',
            icon: 'Calendar',
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes((currentAdmin?.role as string) ?? ''),
            handler: async (_req: any, _res: any, ctx: any) =>
              draftForRange(ctx, monthToDateRange(), 'month-to-date'),
          },
          generateCustomRange: {
            actionType: 'resource',
            label: 'Custom range',
            icon: 'Sliders',
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes((currentAdmin?.role as string) ?? ''),
            handler: async (req: any, _res: any, ctx: any) => {
              const start = req?.query?.['start'] ?? req?.payload?.['start'];
              const end = req?.query?.['end'] ?? req?.payload?.['end'];
              if (!start || !end) {
                return {
                  notice: {
                    message: 'Pass ?start=YYYY-MM-DD&end=YYYY-MM-DD on the URL or via payload.',
                    type: 'error',
                  },
                };
              }
              const s = new Date(`${start}T00:00:00Z`);
              const e = new Date(`${end}T23:59:59.999Z`);
              if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
                return {
                  notice: { message: 'Invalid date range.', type: 'error' },
                };
              }
              return draftForRange(ctx, { start: s, end: e }, `${start} → ${end}`);
            },
          },
          // ── Download CSV / PDF ──────────────────────────────────────
          // Record actions exposed on a Disbursement's show view. Both
          // redirect to the api routes through the same-origin /v1/*
          // proxy registered on the admin Fastify (so the admin session
          // cookie travels and the api auth-check passes).
          // ── Download CSV / PDF — link to the Downloads page ────────
          // AdminJS's `redirectUrl` goes through react-router's
          // history.push() which TREATS THE URL AS A RELATIVE PATH and
          // concatenates it to the current location, producing nonsense
          // like /admin/resources/.../show/http://localhost.../...
          // After extensive testing, the only reliable way to download
          // is the static /admin/downloads page (rendered outside
          // AdminJS). These two record-action buttons therefore just
          // redirect the user to that page where the file links work.
          downloadCsv: {
            actionType: 'record',
            label: 'Open downloads',
            icon: 'Download',
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes((currentAdmin?.role as string) ?? ''),
            handler: async (_req: any, _res: any, ctx: any) => ({
              redirectUrl: '/admin/downloads',
              record: ctx.record!.toJSON(ctx.currentAdmin),
              notice: {
                message: 'Opening the downloads centre…',
                type: 'success' as const,
              },
            }),
          },
          // ── Lifecycle transitions ──────────────────────────────────
          markReady: {
            actionType: 'record',
            label: 'Mark ready',
            icon: 'CheckCircle',
            component: false,
            isAccessible: ({
              currentAdmin,
              record,
            }: {
              currentAdmin?: { role?: string };
              record?: { params?: Record<string, unknown> };
            }) => {
              if (!['admin', 'finance'].includes((currentAdmin?.role as string) ?? '')) return false;
              return record?.params?.['status'] === 'draft';
            },
            handler: async (_req: any, _res: any, ctx: any) => {
              const id = ctx.record!.params['id'];
              return {
                redirectUrl: `/v1/disbursements/${id}/ready`,
                record: ctx.record!.toJSON(ctx.currentAdmin),
                notice: { message: 'Marked ready', type: 'success' as const },
              };
            },
          },
          markSubmitted: {
            actionType: 'record',
            label: 'Mark submitted',
            icon: 'Send',
            component: false,
            isAccessible: ({
              currentAdmin,
              record,
            }: {
              currentAdmin?: { role?: string };
              record?: { params?: Record<string, unknown> };
            }) => {
              if (!['admin', 'finance'].includes((currentAdmin?.role as string) ?? '')) return false;
              return record?.params?.['status'] === 'ready';
            },
            handler: async (_req: any, _res: any, ctx: any) => {
              const id = ctx.record!.params['id'];
              return {
                redirectUrl: `/v1/disbursements/${id}/submit`,
                record: ctx.record!.toJSON(ctx.currentAdmin),
                notice: { message: 'Marked submitted', type: 'success' as const },
              };
            },
          },
        },
      },
    },
    {
      resource: { model: getModelByName('DisbursementEntry'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'List' },
        listProperties: ['disbursementId', 'paymentId', 'amountCents', 'feeCents', 'netCents', 'included'],
        filterProperties: ['disbursementId', 'included'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          amountCents: { description: 'Snapshot of Payment.amountCents at inclusion time.' },
          feeCents: { description: 'Snapshot of Payment.feeCents (provider fee).' },
          netCents: { description: 'amountCents − feeCents.' },
          included: { description: 'Uncheck via /v1/disbursements/:id/entries to exclude with a reason.' },
        },
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          new: { isAccessible: false },
          delete: { isAccessible: false },
          bulkDelete: { isAccessible: false },
        },
      },
    },
    // ── RAG (curator-owned, ADR-0007) ─────────────────────────────────
    {
      resource: { model: getModelByName('RagDocument'), client: prisma },
      options: { navigation: { name: 'AskTheGarden', icon: 'MessageCircle' }, actions: restrictTo(...CURATOR_OR_ADMIN) },
    },
    {
      resource: { model: getModelByName('RagChunk'), client: prisma },
      options: {
        navigation: { name: 'AskTheGarden' },
        listProperties: ['documentId', 'chunkIndex', 'locale', 'tokenStart', 'tokenEnd'],
        // RagChunk is regenerated by the ingest job, not edited inline.
        actions: { ...restrictTo(...CURATOR_OR_ADMIN), new: { isAccessible: false }, edit: { isAccessible: false } },
        properties: {
          embedding: { isVisible: { list: false, edit: false, show: false, filter: false } },
        },
      },
    },
    {
      resource: { model: getModelByName('AskMessage'), client: prisma },
      options: { navigation: { name: 'AskTheGarden' }, actions: restrictTo(...CURATOR_OR_ADMIN) },
    },
    {
      resource: { model: getModelByName('AskAnswer'), client: prisma },
      options: { navigation: { name: 'AskTheGarden' }, actions: restrictTo(...CURATOR_OR_ADMIN) },
    },
    // ── Kiosk ──────────────────────────────────────────────────────────
    {
      resource: { model: getModelByName('KioskDevice'), client: prisma },
      options: { navigation: { name: 'Kiosk', icon: 'Monitor' }, actions: restrictTo(...ADMIN_ONLY) },
    },
    {
      resource: { model: getModelByName('KioskEvent'), client: prisma },
      options: { navigation: { name: 'Kiosk' }, actions: restrictTo(...ADMIN_ONLY) },
    },
    // ── Audit + GDPR ───────────────────────────────────────────────────
    {
      resource: { model: getModelByName('AuditLog'), client: prisma },
      options: {
        navigation: { name: 'Audit & GDPR', icon: 'Shield' },
        sort: { sortBy: 'occurredAt', direction: 'desc' as const },
        // Audit log is append-only; finance + admin can read, but no one
        // can edit or delete via AdminJS (truncation is a DB-level cron).
        actions: {
          list: { isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
            ['admin', 'finance'].includes(currentAdmin?.role as string) },
          show: { isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
            ['admin', 'finance'].includes(currentAdmin?.role as string) },
          search: { isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
            ['admin', 'finance'].includes(currentAdmin?.role as string) },
          new: { isAccessible: false },
          edit: { isAccessible: false },
          delete: { isAccessible: false },
        },
      },
    },
    {
      resource: { model: getModelByName('DataExportRequest'), client: prisma },
      options: { navigation: { name: 'Audit & GDPR' }, actions: restrictTo(...ADMIN_ONLY) },
    },
    // ── Operations config (admin only per ADR-0007) ────────────────────
    {
      resource: { model: getModelByName('EmailTemplate'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'Mail' },
        listProperties: ['slug', 'subjectEn', 'subjectFi', 'subjectSv', 'updatedAt'],
        properties: {
          slug: { description: 'Stable key referenced by the email worker (e.g. magic-link, adoption-confirmed).' },
          bodyMjmlEn: { description: 'MJML body (English). Use {{variable}} placeholders — they will be substituted at send time.', type: 'textarea' },
          bodyMjmlFi: { description: 'MJML body (Finnish).', type: 'textarea' },
          bodyMjmlSv: { description: 'MJML body (Swedish).', type: 'textarea' },
        },
        actions: restrictTo(...ADMIN_ONLY),
      },
    },
    {
      resource: { model: getModelByName('ContentBlock'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'Layout' },
        listProperties: ['slug', 'kind', 'updatedAt'],
        properties: {
          slug: { description: 'Stable key referenced by the web layer (e.g. hero, funds-flow, donor-wall).' },
          kind: { description: 'Renderer hint — usually one of: hero | callout | wall | story.' },
          payload: { description: 'JSON payload consumed by the matching React component.', type: 'mixed' },
        },
        actions: restrictTo(...ADMIN_ONLY),
      },
    },
    {
      resource: { model: getModelByName('FeatureFlag'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'ToggleRight' },
        listProperties: ['key', 'enabled', 'updatedAt'],
        properties: {
          key: { description: 'Flag identifier (e.g. featurePaytrail, featureMobilePay, featureKiosk).' },
          enabled: { description: 'Boolean toggle. Reads land in /v1/settings/public.' },
        },
        actions: restrictTo(...ADMIN_ONLY),
      },
    },
    {
      resource: { model: getModelByName('VatRule'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'Percent' },
        properties: {
          lineType: { description: 'Donation line type this rule applies to (e.g. donation, plaque, corporate).' },
          ratePct: { description: 'Statutory rate as a percent. Edit only when the Finnish VAT law changes.' },
        },
        actions: restrictTo(...FINANCE_OR_ADMIN),
      },
    },
    {
      resource: { model: getModelByName('SystemSetting'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'Settings' },
        listProperties: ['key', 'description', 'updatedAt'],
        properties: {
          key: { description: 'Setting identifier. Reads are Zod-validated; changes audited.' },
          value: { type: 'mixed', description: 'Typed JSON value. See ADR-0001 table for the catalogue of keys.' },
          description: { description: 'One-sentence explanation shown inline so non-technical staff understand the toggle.' },
        },
        actions: restrictTo(...ADMIN_ONLY),
      },
    },
    {
      resource: { model: getModelByName('Translation'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'Globe' },
        listProperties: ['i18nKey', 'namespace', 'updatedAt'],
        properties: {
          i18nKey: { description: 'Translation key (e.g. Home.heroCta).' },
          namespace: { description: 'next-intl namespace.' },
          en: { type: 'textarea' },
          fi: { type: 'textarea' },
          sv: { type: 'textarea' },
        },
        actions: restrictTo(...ADMIN_ONLY),
      },
    },
    {
      resource: { model: getModelByName('JobRun'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'Activity' },
        listProperties: ['queueName', 'jobName', 'status', 'startedAt', 'finishedAt', 'attempts'],
        actions: { ...restrictTo(...ADMIN_ONLY), new: { isAccessible: false }, edit: { isAccessible: false }, delete: { isAccessible: false } },
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
      },
    },
    {
      resource: { model: getModelByName('DataErasureRequest'), client: prisma },
      options: {
        navigation: { name: 'Audit & GDPR' },
        listProperties: ['createdAt', 'userId', 'status', 'reason', 'completedAt'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        actions: {
          approveAndExecute: {
            actionType: 'record',
            label: 'Approve & execute',
            icon: 'Trash2',
            component: false,
            isAccessible: ({ currentAdmin, record }: { currentAdmin?: { role?: string }; record?: any }) =>
              ['admin'].includes(currentAdmin?.role as string) && record?.params?.status === 'pending',
            handler: async (_req: any, _res: any, ctx: any) => {
              const id = ctx.record!.params['id'];
              const adminId = ctx.currentAdmin?.id;
              await prisma.$transaction(async (tx) => {
                await tx.dataErasureRequest.update({
                  where: { id },
                  data: { status: 'verified', decidedByUserId: adminId ?? null },
                });
                await tx.auditLog.create({
                  data: {
                    actorUserId: adminId ?? null,
                    action: 'gdpr.erase.approved',
                    resource: `DataErasureRequest/${id}`,
                  },
                });
              });
              await eraseQueue.add(
                'erase',
                { requestId: id },
                { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
              );
              return { record: ctx.record!.toJSON(ctx.currentAdmin) };
            },
          },
          reject: {
            actionType: 'record',
            label: 'Reject (legal hold)',
            icon: 'X',
            component: false,
            isAccessible: ({ currentAdmin, record }: { currentAdmin?: { role?: string }; record?: any }) =>
              ['admin'].includes(currentAdmin?.role as string) && record?.params?.status === 'pending',
            handler: async (_req: any, _res: any, ctx: any) => {
              const id = ctx.record!.params['id'];
              const adminId = ctx.currentAdmin?.id;
              await prisma.$transaction(async (tx) => {
                await tx.dataErasureRequest.update({
                  where: { id },
                  data: { status: 'rejected', decidedByUserId: adminId ?? null, completedAt: new Date() },
                });
                await tx.auditLog.create({
                  data: {
                    actorUserId: adminId ?? null,
                    action: 'gdpr.erase.rejected',
                    resource: `DataErasureRequest/${id}`,
                  },
                });
              });
              return { record: ctx.record!.toJSON(ctx.currentAdmin) };
            },
          },
        },
      },
    },
  ],
  // Sidebar pages — kept deliberately small. Each entry below is a hub
  // that contains tabs for related sub-workflows, so the sidebar stays
  // under ten clicks even though the platform exposes 15+ admin panels.
  //
  // Sidebar order (intentional, top-to-bottom most-frequent first):
  //   1. Plant tools  — daily curator workflow (Add / Review / Print / Ingest)
  //   2. QR analytics — read-only QR scan funnel + top plants
  //   3. Configure    — every system setting + translations + advanced
  //   4. Operations   — bank reconciliation + backups
  pages: {
    plantTools: {
      label: 'Plant tools',
      icon: 'Search',
      handler: async () => ({}),
      component: PlantToolsPage,
    },
    qrMetrics: {
      label: 'QR scan analytics',
      icon: 'BarChart2',
      handler: async () => ({}),
      component: QrMetricsPage,
    },
    configure: {
      label: 'Configure',
      icon: 'Sliders',
      handler: async () => ({}),
      component: ConfigurePage,
    },
    operations: {
      label: 'Operations',
      icon: 'Tool',
      handler: async () => ({}),
      component: OperationsPage,
    },
    observability: {
      label: 'Observability',
      icon: 'Activity',
      handler: async () => ({}),
      component: ObservabilityPage,
    },
    // The Downloads page is rendered outside AdminJS by the Fastify
    // onRequest hook (/admin/downloads). The pages registry expects a
    // React component; we use `handler` that returns a redirect via the
    // ` notice` channel — when the user clicks the sidebar entry, the
    // AdminJS frontend opens the static page in a new tab via the
    // bottom-bar redirectUrl. Even with the SPA-routing quirk, the
    // /admin/downloads URL is rendered by the Fastify hook before
    // AdminJS sees it, so the browser gets HTML directly.
    downloads: {
      label: 'Downloads',
      icon: 'Download',
      handler: async () => ({}),
      // The component immediately window.location.assigns to
      // /admin/downloads — the static HTML page rendered by the
      // Fastify hook. This bypasses AdminJS's broken redirectUrl SPA
      // navigation and gets the user to working file-download links.
      component: DownloadsRedirectPage,
    },
  },
} as any);

// ── Admin session secret + shared store/signer (GDPR / security) ─────────
// The custom Fastify routes (camt.054 reconcile, downloads, dashboard
// stats, observability, bulk-jobs) are served from an `onRequest` hook
// that fires BEFORE @adminjs/fastify registers @fastify/session +
// @fastify/cookie inside buildAuthenticatedRouter — so `req.session` is
// not yet populated there. To gate those routes on a valid admin session
// without changing AdminJS's own auth, we own the session store + cookie
// signer here and pass them into buildAuthenticatedRouter. The early hook
// then unsigns the `bloomoulu_admin` cookie with the SAME signer and looks
// the session id up in the SAME store the plugin writes to, so the two
// views of the session are always consistent.
const ADMIN_COOKIE_NAME = 'bloomoulu_admin';
// Must be ≥32 chars (@fastify/session requirement). Keep this fallback in
// sync with the buildAuthenticatedRouter call below; in prod AUTH_SECRET is
// always set (see docs/ENV.md) and the fallback is never used.
const ADMIN_SESSION_SECRET =
  process.env.AUTH_SECRET ?? 'change-me-in-prod-32+chars-please';
const adminSessionStore = new MemoryStore();
const adminCookieSigner = new Signer(ADMIN_SESSION_SECRET);

/** Minimal Cookie-header value reader (avoids relying on @fastify/cookie's
 *  untyped `parse` export). Returns the URL-decoded value or undefined. */
function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/**
 * True when the request carries a valid `bloomoulu_admin` session cookie
 * that resolves to a stored session with an `adminUser`. Used by the early
 * onRequest hook to protect the custom routes, mirroring AdminJS's own
 * `request.session.get('adminUser')` check (which only runs in a later
 * preHandler that the custom routes never reach).
 */
async function hasValidAdminSession(cookieHeader: string | undefined): Promise<boolean> {
  if (!cookieHeader) return false;
  const raw = readCookie(cookieHeader, ADMIN_COOKIE_NAME);
  if (!raw) return false;
  const unsigned = adminCookieSigner.unsign(raw);
  if (!unsigned.valid || !unsigned.value) return false;
  const sessionId = unsigned.value;
  const session = await new Promise<unknown>((resolve) => {
    adminSessionStore.get(sessionId, (err, s) => {
      resolve(err ? null : (s ?? null));
    });
  });
  if (!session || typeof session !== 'object') return false;
  // The session object stores values as plain own-properties (see
  // @fastify/session's Session class) — login sets `adminUser`. Expiry is
  // also enforced by the plugin on decode; if the cookie is stale the store
  // entry will already have been destroyed, so a present adminUser is enough.
  const adminUser = (session as { adminUser?: unknown }).adminUser;
  return Boolean(adminUser);
}

/**
 * The custom routes that must NOT be reachable without an admin session.
 * Matched as a prefix/exact set against the request URL (path only). The
 * favicon shim, AdminJS's own assets/login/logout, and the public health/
 * metrics endpoints are intentionally excluded — they either carry no PII
 * or are needed pre-auth. Anything under one of these prefixes that mutates
 * state or returns donor PII is gated.
 */
function isProtectedCustomRoute(pathname: string): boolean {
  // Exact matches.
  const exact = new Set<string>([
    '/admin/dl/reconcile-camt054',
    '/admin/downloads',
    '/admin/dashboard-stats',
    '/admin/rebuild-summaries',
    '/admin/translations/import',
    '/admin/plants/create-from-assistant',
    '/admin/plants/bulk-jobs',
    '/admin/ingest-doc',
    '/admin/manual-docs',
    '/admin/settings/batch',
    '/admin/backups',
    '/admin/backups/run',
    '/admin/reconciliation/entries',
  ]);
  if (exact.has(pathname)) return true;
  // Prefix matches (sub-resources with ids / actions).
  const prefixes = [
    '/admin/dl/', // disbursement CSV/PDF, receipts, tax certs, gdpr exports
    '/admin/plants/bulk-jobs/',
    '/admin/observability/',
  ];
  return prefixes.some((p) => pathname.startsWith(p));
}

async function bootstrap() {
  const app = Fastify({ logger: true, trustProxy: true });

  // Initialise the persistent event log before any hook runs so the
  // first request that comes in is captured. installHttpHook hangs
  // onRequest/onResponse listeners onto Fastify that auto-log every
  // request with method/url/status/duration and a trace id.
  initObservability(prisma);
  installHttpHook(app);
  obs.info('system', 'admin server starting', {
    nodeEnv: process.env.NODE_ENV,
    pid: process.pid,
  });

  // Favicon shim. AdminJS's plugin registers a catch-all under /admin/*
  // that beats any sibling route, so an `app.get('/admin/static/favicon.ico')`
  // gets redirected to /admin/login instead. An onRequest hook fires
  // BEFORE routing, so we intercept favicon requests there and return
  // 204 No Content silently. The browser auto-requests this URL the
  // moment the login page renders; without this hook every staff sign-in
  // flashes a 404 in the network panel.
  app.addHook('onRequest', async (req, reply) => {
    if (
      req.url === '/admin/static/favicon.ico' ||
      req.url === '/favicon.ico'
    ) {
      reply.header('cache-control', 'public, max-age=86400').code(204).send();
      return;
    }
    // ── Catch AdminJS's broken redirectUrl concatenation ──────────────
    // When a record action returns `redirectUrl: 'http://…/admin/dl/…'`
    // AdminJS's react-router treats it as a relative path and tacks the
    // whole URL onto the current location, producing nonsense like
    //   /admin/resources/X/records/Y/show/http://localhost:4100/admin/dl/…
    // The browser then ends up at that URL after login (history.back).
    // Detect the pattern and redirect to the embedded download URL —
    // or fall back to /admin/downloads if extraction fails. Either way
    // the user lands somewhere useful instead of a 404 page.
    {
      const mangled = /^\/admin\/resources\/[^/]+\/records\/[^/]+\/show\/(http:\/\/[^?]+(?:\?[^#]*)?)$/.exec(
        req.url ?? '',
      );
      if (mangled) {
        const embedded = decodeURIComponent(mangled[1]!);
        // Strip the bogus ?refresh=true that AdminJS appends.
        const clean = embedded.replace(/[?&]refresh=true(&|$)/, (_, sep) => (sep === '&' ? '?' : ''));
        reply
          .code(302)
          .header('location', clean.replace(/\?$/, ''))
          .send();
        return;
      }
    }
    // ── Auth gate for the custom routes (GDPR / security) ────────────
    // This onRequest hook runs BEFORE @adminjs/fastify's session +
    // protected-routes preHandler, so every custom route below would
    // otherwise be reachable with no admin session — including
    // /admin/dl/reconcile-camt054 (marks payments succeeded!) and
    // /admin/downloads (donor PII). Gate them here by verifying the
    // signed bloomoulu_admin session cookie against our shared session
    // store. AdminJS's own resources/login/assets are untouched (they
    // are not in isProtectedCustomRoute and AdminJS guards them itself).
    {
      const pathname = (req.url ?? '').split('?', 1)[0]!;
      if (isProtectedCustomRoute(pathname)) {
        const ok = await hasValidAdminSession(req.headers.cookie);
        if (!ok) {
          obs.warn('admin', 'unauthenticated custom-route blocked', {
            method: req.method,
            url: pathname,
          });
          reply
            .code(401)
            .header('content-type', 'application/json')
            .send({ error: 'unauthorized', message: 'Admin session required.' });
          return;
        }
      }
    }
    // ── camt.054 bank-statement reconciliation ──────────────────────
    // Accepts an ISO 20022 camt.054 XML document as the request body.
    // Parses every credit entry, matches against pending bank_transfer
    // Payments by RF reference (or orderId UUID in unstructured), flips
    // matches to `succeeded`. Idempotent — duplicate endToEndId values
    // are skipped. Returns a JSON summary.
    if (req.url === '/admin/dl/reconcile-camt054' && req.method === 'POST') {
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.raw.on('data', (c) => chunks.push(Buffer.from(c as Uint8Array)));
          req.raw.on('end', resolve);
          req.raw.on('error', reject);
        });
        const xml = Buffer.concat(chunks).toString('utf-8');
        if (!xml.trim()) {
          reply.code(400).send({ error: 'empty body' });
          return;
        }
        const result = await reconcileCamt054Inline(xml);
        reply.header('content-type', 'application/json').send(result);
        return;
      } catch (err) {
        reply
          .code(400)
          .send({ error: 'parse_failed', message: (err as Error).message });
        return;
      }
    }
    // ── Admin download centre ───────────────────────────────────────
    // Plain HTML page listing every downloadable artefact: disbursement
    // CSV/PDFs, receipt PDFs, tax certificate PDFs, GDPR exports. The
    // AdminJS SPA hijacks `redirectUrl` from record actions and routes
    // through react-router so clicks never actually download. This page
    // is rendered outside AdminJS — plain Fastify → plain <a href>
    // anchors → browser triggers download per Content-Disposition. The
    // user can bookmark this URL.
    if (req.url === '/admin/downloads' && req.method === 'GET') {
      try {
        const [disbursements, receipts, taxCerts, gdprExports] = await Promise.all([
          prisma.disbursement.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              reference: true,
              status: true,
              periodStart: true,
              periodEnd: true,
              expectedCents: true,
              netCents: true,
            },
          }),
          prisma.receipt.findMany({
            orderBy: { issuedAt: 'desc' },
            take: 50,
            select: {
              id: true,
              number: true,
              amountCents: true,
              issuedAt: true,
              pdfUrl: true,
              donor: { select: { email: true, name: true } },
            },
          }),
          prisma.taxCertificate.findMany({
            orderBy: { taxYear: 'desc' },
            select: {
              id: true,
              taxYear: true,
              totalCents: true,
              scheme: true,
              pdfUrl: true,
              donor: { select: { email: true, name: true } },
            },
          }),
          prisma.dataExportRequest.findMany({
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: {
              id: true,
              status: true,
              exportUrl: true,
              createdAt: true,
              completedAt: true,
              userId: true,
            },
          }),
        ]);
        const escapeHtml = (s: string): string =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const eur = (cents: number): string => `€${(cents / 100).toFixed(2)}`;
        const date = (d: Date | null | string): string => {
          if (!d) return '—';
          const dt = typeof d === 'string' ? new Date(d) : d;
          return dt.toISOString().slice(0, 10);
        };

        const apiBase = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
        // Derive a browser-fetchable URL from a stored storage ref —
        // never reconstruct a filename (the on-disk name differs per
        // artefact: tax certs are named by donor-id slice, not row id).
        // Handles local://key, s3://bucket/key, /v1/… and absolute http.
        const fileHref = (ref: string | null | undefined): string | null => {
          if (!ref) return null;
          if (ref.startsWith('local://')) return `${apiBase}/v1/files/${ref.slice('local://'.length)}`;
          if (ref.startsWith('s3://')) return `${apiBase}/v1/files/${ref.replace(/^s3:\/\/[^/]+\//, '')}`;
          if (ref.startsWith('/')) return `${apiBase}${ref}`;
          return ref; // already absolute http(s)
        };

        const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>BloomOulu Admin · Downloads</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bo-ink: #1F3C2D;
    --bo-forest-mid: #2D5440;
    --bo-paper: #FCFAF3;
    --bo-cream: #FAF7EE;
    --bo-line: #E5E2D8;
    --bo-line-soft: #EFECDF;
    --bo-ink-mute: #6F7E70;
    --bo-accent: #A86A2B;
    --bo-sage-pale: #F2F0E8;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bo-paper);
    color: var(--bo-ink);
    margin: 0;
    padding: 32px 24px 64px;
    line-height: 1.5;
  }
  .wrap { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 32px; margin: 0 0 4px; color: var(--bo-forest-mid); font-weight: 700; }
  .lead { color: var(--bo-ink-mute); margin: 0 0 32px; font-size: 15px; }
  .back { display: inline-block; margin-bottom: 16px; color: var(--bo-accent); text-decoration: none; }
  .back:hover { text-decoration: underline; }
  section { margin: 40px 0; }
  h2 { font-size: 20px; color: var(--bo-forest-mid); margin: 0 0 12px; }
  .count { font-weight: 400; color: var(--bo-ink-mute); font-size: 14px; margin-left: 8px; }
  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border: 1px solid var(--bo-line);
    border-radius: 8px;
    overflow: hidden;
  }
  th, td {
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid var(--bo-line-soft);
    font-size: 14px;
  }
  th {
    background: var(--bo-sage-pale);
    font-weight: 600;
    color: var(--bo-forest-mid);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  tr:last-child td { border-bottom: none; }
  .ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .btn {
    display: inline-block;
    padding: 6px 12px;
    background: var(--bo-forest-mid);
    color: white;
    text-decoration: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    margin-right: 4px;
  }
  .btn:hover { background: var(--bo-ink); }
  .btn-secondary { background: white; color: var(--bo-ink); border: 1px solid var(--bo-line); }
  .btn-secondary:hover { background: var(--bo-cream); }
  .status {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .status-draft { background: #E8EEDE; color: var(--bo-forest-mid); }
  .status-ready { background: #FBE9B0; color: #8B6914; }
  .status-submitted { background: #C4DDF5; color: #1A5490; }
  .status-paid { background: #B8D8B8; color: #2D5430; }
  .status-reconciled { background: var(--bo-sage-pale); color: var(--bo-ink-mute); }
  .status-cancelled { background: #F4D8D0; color: #8B3A2C; }
  .empty { color: var(--bo-ink-mute); font-style: italic; padding: 16px; text-align: center; }
  .pill {
    display: inline-block;
    padding: 1px 8px;
    background: var(--bo-sage-pale);
    border-radius: 10px;
    font-size: 11px;
    color: var(--bo-ink-mute);
  }
</style>
</head>
<body>
<div class="wrap">
  <a href="/admin" class="back">← Back to dashboard</a>
  <h1>Downloads</h1>
  <p class="lead">
    All artefacts available to finance + admin staff. Click any link to download —
    the browser will trigger a Save dialog. Files are regenerated on request, so
    they always reflect current state.
  </p>

  <section>
    <h2>Disbursement claims <span class="count">${disbursements.length}</span></h2>
    ${disbursements.length === 0
      ? '<p class="empty">No disbursements yet. Use /admin/resources/Disbursement → "Last month" / "Custom range" to create one.</p>'
      : `<table>
      <thead><tr>
        <th>Reference</th>
        <th>Period</th>
        <th>Status</th>
        <th>Net</th>
        <th>Downloads</th>
      </tr></thead>
      <tbody>
        ${disbursements
          .map(
            (d) => `<tr>
          <td class="ref">${escapeHtml(d.reference)}</td>
          <td>${date(d.periodStart)} → ${date(d.periodEnd)}</td>
          <td><span class="status status-${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></td>
          <td>${eur(d.netCents)}</td>
          <td>
            <a href="/admin/dl/disbursement-csv/${d.id}" class="btn" download>CSV</a>
            <a href="/admin/dl/disbursement-pdf/${d.id}" class="btn" download>PDF</a>
            <a href="/admin/resources/Disbursement/records/${d.id}/show" class="btn btn-secondary">Open</a>
          </td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`
    }
  </section>

  <section>
    <h2>Donation receipts <span class="count">${receipts.length}</span></h2>
    ${receipts.length === 0
      ? '<p class="empty">No receipts yet.</p>'
      : `<table>
      <thead><tr>
        <th>Number</th>
        <th>Issued</th>
        <th>Donor</th>
        <th>Amount</th>
        <th>Download</th>
      </tr></thead>
      <tbody>
        ${receipts
          .map(
            (r) => `<tr>
          <td class="ref">${escapeHtml(r.number)}</td>
          <td>${date(r.issuedAt)}</td>
          <td>${escapeHtml(r.donor.name ?? r.donor.email)}</td>
          <td>${eur(r.amountCents)}</td>
          <td>${r.pdfUrl
            ? `<a href="${fileHref(r.pdfUrl)}" class="btn" download target="_blank" rel="noopener">PDF</a>`
            : '<span class="pill">pending</span>'}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`
    }
  </section>

  <section>
    <h2>Tax certificates <span class="count">${taxCerts.length}</span></h2>
    ${taxCerts.length === 0
      ? '<p class="empty">No tax certificates issued yet. /admin/resources/TaxCertificate → "Generate annual sweep" to create.</p>'
      : `<table>
      <thead><tr>
        <th>Tax Year</th>
        <th>Donor</th>
        <th>Scheme</th>
        <th>Total</th>
        <th>Download</th>
      </tr></thead>
      <tbody>
        ${taxCerts
          .map(
            (c) => `<tr>
          <td class="ref">${c.taxYear}</td>
          <td>${escapeHtml(c.donor.name ?? c.donor.email)}</td>
          <td><span class="pill">${escapeHtml(c.scheme)}</span></td>
          <td>${eur(c.totalCents)}</td>
          <td>${c.pdfUrl
            ? `<a href="${fileHref(c.pdfUrl)}" class="btn" download target="_blank" rel="noopener">PDF</a>`
            : '<span class="pill">pending</span>'}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`
    }
  </section>

  <section>
    <h2>GDPR data exports <span class="count">${gdprExports.length}</span></h2>
    ${gdprExports.length === 0
      ? '<p class="empty">No GDPR exports yet. Donors trigger these from My Garden → "Request a copy of my data".</p>'
      : `<table>
      <thead><tr>
        <th>Request</th>
        <th>Requested</th>
        <th>Status</th>
        <th>Completed</th>
        <th>Download</th>
      </tr></thead>
      <tbody>
        ${gdprExports
          .map(
            (e) => `<tr>
          <td class="ref">${e.id.slice(0, 8)}…</td>
          <td>${date(e.createdAt)}</td>
          <td><span class="status status-${escapeHtml(e.status)}">${escapeHtml(e.status)}</span></td>
          <td>${date(e.completedAt)}</td>
          <td>${e.exportUrl
            ? `<a href="${escapeHtml(e.exportUrl)}?download=1" class="btn" target="_blank" rel="noopener">JSON</a>`
            : '<span class="pill">pending</span>'}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`
    }
  </section>

  <p style="margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--bo-line); color: var(--bo-ink-mute); font-size: 12px;">
    Bookmark this page (Cmd-D / Ctrl-D) — it's the canonical home for every downloadable artefact.
  </p>
</div>
</body>
</html>`;
        reply
          .header('content-type', 'text/html; charset=utf-8')
          .header('cache-control', 'no-store')
          .send(html);
        return;
      } catch (err) {
        reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<h1>Error</h1><pre>${(err as Error).message}</pre>`);
        return;
      }
    }

    // ── Disbursement file downloads ───────────────────────────────────
    // The api routes (/v1/disbursements/:id/export.{csv,pdf}) require a
    // Bearer JWT and the admin's cookie is `bloomoulu_admin`, not the
    // api-side `bloomoulu.session`. Rather than mint a JWT here on every
    // click, we just regenerate the file in-process — admin already has
    // Prisma + the email package available.
    {
      const m = /^\/admin\/dl\/disbursement-(csv|pdf)\/([0-9a-f-]{36})\/?$/.exec(req.url ?? '');
      if (m) {
        const [, kind, id] = m;
        try {
          const d = await prisma.disbursement.findUnique({
            where: { id },
            include: {
              entries: {
                include: {
                  payment: {
                    include: {
                      donor: { select: { email: true, name: true } },
                      donation: { include: { plant: { select: { nameEn: true, slug: true } } } },
                    },
                  },
                },
              },
            },
          });
          if (!d) {
            reply.code(404).send({ error: 'Disbursement not found' });
            return;
          }
          if (kind === 'csv') {
            // Build CSV identical to the api's exportCsv shape.
            const csvField = (s: string | null | undefined): string => {
              if (s == null) return '';
              const v = String(s);
              return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            };
            const rows: string[] = [];
            rows.push('reference,periodStart,periodEnd,status,expectedNetEUR,paidEUR,entries');
            rows.push(
              [
                csvField(d.reference),
                csvField(d.periodStart.toISOString().slice(0, 10)),
                csvField(d.periodEnd.toISOString().slice(0, 10)),
                csvField(d.status),
                (d.netCents / 100).toFixed(2),
                (d.paidCents / 100).toFixed(2),
                String(d.entries.filter((e) => e.included).length),
              ].join(','),
            );
            rows.push('');
            rows.push(
              'paymentOrderId,provider,donorEmail,donorName,plantSlug,plantName,paidAt,grossEUR,feeEUR,netEUR,included,excludedReason',
            );
            for (const e of d.entries) {
              const p = e.payment;
              rows.push(
                [
                  csvField(p.orderId),
                  csvField(p.provider),
                  csvField(p.donor.email),
                  csvField(p.donor.name ?? ''),
                  csvField(p.donation?.plant?.slug ?? ''),
                  csvField(p.donation?.plant?.nameEn ?? ''),
                  csvField(p.receivedAt?.toISOString() ?? ''),
                  (e.amountCents / 100).toFixed(2),
                  (e.feeCents / 100).toFixed(2),
                  (e.netCents / 100).toFixed(2),
                  e.included ? 'yes' : 'no',
                  csvField(e.excludedReason ?? ''),
                ].join(','),
              );
            }
            const csv = rows.join('\r\n') + '\r\n';
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { createHash } = await import('node:crypto');
            const sha = createHash('sha256').update(csv).digest('hex');
            await prisma.disbursement.update({ where: { id }, data: { csvSha256: sha } });
            reply
              .header('content-type', 'text/csv; charset=utf-8')
              .header('content-disposition', `attachment; filename="${d.reference}.csv"`)
              .header('x-content-sha256', sha)
              .send(csv);
            return;
          }
          // pdf
          const { renderDisbursementPdf } = await import('@bloomoulu/emails/pdf/disbursement');
          const { createHash } = await import('node:crypto');
          // Mini-CSV inline (avoid duplicating but we need the sha for the PDF).
          const csvForHash =
            `reference,${d.reference}\nperiod,${d.periodStart.toISOString().slice(0, 10)}-${d.periodEnd.toISOString().slice(0, 10)}\nentries,${d.entries.length}\n`;
          const sha = createHash('sha256').update(csvForHash).digest('hex');
          const pdfBuf = await renderDisbursementPdf({
            reference: d.reference,
            locale: 'en',
            periodStart: d.periodStart,
            periodEnd: d.periodEnd,
            status: d.status,
            expectedCents: d.expectedCents,
            feeCents: d.feeCents,
            netCents: d.netCents,
            currency: d.currency,
            csvSha256: sha,
            issuedAt: new Date(),
            entries: d.entries
              .filter((e) => e.included)
              .map((e) => ({
                donorEmail: e.payment.donor.email,
                donorName: e.payment.donor.name,
                provider: e.payment.provider,
                paidAt: e.payment.receivedAt,
                amountCents: e.amountCents,
                feeCents: e.feeCents,
                netCents: e.netCents,
                plantName: e.payment.donation?.plant?.nameEn ?? null,
              })),
          });
          reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `attachment; filename="${d.reference}.pdf"`)
            .send(pdfBuf);
          return;
        } catch (err) {
          reply
            .code(500)
            .send({ error: 'Download failed', message: (err as Error).message });
          return;
        }
      }
    }
    // BloomOulu admin design-system stylesheet. Injected on every page
    // via AdminJSOptions.assets.styles. Same onRequest-precedence
    // workaround as the favicon shim — AdminJS's catch-all at /admin/*
    // would otherwise swallow the route.
    if (req.url === '/admin/static/global.css' && req.method === 'GET') {
      reply
        .header('content-type', 'text/css; charset=utf-8')
        .header('cache-control', 'public, max-age=60')
        .send(ADMIN_GLOBAL_CSS);
      return;
    }
    // Same-origin proxy for the NestJS API. In production Caddy already
    // routes /v1/* → api:4000 on the same hostname so browser calls are
    // same-origin. In standalone dev the admin runs on :4100 and the API
    // on :4000 — a direct browser call cross-ports, the API doesn't echo
    // an Access-Control-Allow-Origin, and the browser blocks the request
    // ("Failed to fetch"). Proxying here keeps the page code identical
    // (relative URLs) in both environments. Forwards method, headers,
    // and body; restreams the upstream response verbatim.
    if (req.url?.startsWith('/v1/')) {
      const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
      const target = `${apiUrl}${req.url}`;
      const fwdHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v !== 'string') continue;
        const lk = k.toLowerCase();
        if (['host', 'connection', 'content-length'].includes(lk)) continue;
        fwdHeaders[k] = v;
      }
      let body: Buffer | undefined;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method!)) {
        body = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.raw.on('data', (c) => chunks.push(Buffer.from(c as Uint8Array)));
          req.raw.on('end', () => resolve(Buffer.concat(chunks)));
          req.raw.on('error', reject);
        });
      }
      try {
        // undici accepts Buffer at runtime but the DOM-lib BodyInit type
        // doesn't include it; cast through unknown for the proxy call.
        const r = await fetch(target, {
          method: req.method,
          headers: fwdHeaders,
          body: (body ? body.toString('utf8') : undefined) as BodyInit | undefined,
        });
        reply.code(r.status);
        for (const [k, v] of r.headers) {
          const lk = k.toLowerCase();
          if (['transfer-encoding', 'connection', 'content-encoding', 'content-length'].includes(lk)) {
            continue;
          }
          reply.header(k, v);
        }
        const buf = Buffer.from(await r.arrayBuffer());
        reply.send(buf);
      } catch (e) {
        reply.code(502).send({ error: `API proxy failed: ${(e as Error).message}` });
      }
      return;
    }
    // ── Manual RAG doc ingest ────────────────────────────────────────
    // ── Plant search for Bulk QR Print picker ───────────────────────
    if (req.url?.startsWith('/admin/plants/search') && req.method === 'GET') {
      try {
        const u = new URL(req.url, 'http://x');
        const q = (u.searchParams.get('q') ?? '').trim();
        const redList = u.searchParams.get('redList') ?? '';
        const limit = Math.min(200, Math.max(1, parseInt(u.searchParams.get('limit') ?? '60', 10) || 60));
        const where: any = { status: 'active' };
        if (redList) where.redListStatus = redList;
        if (q) {
          where.OR = [
            { nameEn: { contains: q, mode: 'insensitive' } },
            { nameFi: { contains: q, mode: 'insensitive' } },
            { nameSv: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
            { taxon: { latinName: { contains: q, mode: 'insensitive' } } },
          ];
        }
        const items = await prisma.plant.findMany({
          where,
          take: limit,
          orderBy: [{ donorCount: 'desc' }, { nameEn: 'asc' }],
          select: {
            id: true, slug: true, nameEn: true, nameFi: true, nameSv: true,
            redListStatus: true, gardenZone: true, donorCount: true,
            taxon: { select: { latinName: true } },
          },
        });
        reply.send({ items });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    // ── Translation bulk import (CSV: i18nKey,en,fi,sv[,status]) ──
    if (req.url === '/admin/translations/import' && req.method === 'POST') {
      try {
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        const payload = JSON.parse(body) as { csv?: string };
        const csv = payload.csv ?? '';
        if (!csv.trim()) {
          reply.code(400).send({ error: 'empty csv' });
          return;
        }
        const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          reply.code(400).send({ error: 'csv needs a header row + at least one data row' });
          return;
        }
        const splitRow = (row: string): string[] => {
          const out: string[] = [];
          let cur = '';
          let inQ = false;
          for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch === '"') {
              if (inQ && row[i + 1] === '"') {
                cur += '"';
                i++;
              } else {
                inQ = !inQ;
              }
            } else if (ch === ',' && !inQ) {
              out.push(cur);
              cur = '';
            } else {
              cur += ch;
            }
          }
          out.push(cur);
          return out;
        };
        const header = splitRow(lines[0]!).map((c) => c.trim().toLowerCase());
        const idx = {
          key: header.indexOf('i18nkey'),
          en: header.indexOf('en'),
          fi: header.indexOf('fi'),
          sv: header.indexOf('sv'),
          status: header.indexOf('status'),
        };
        if (idx.key < 0 || idx.en < 0 || idx.fi < 0 || idx.sv < 0) {
          reply.code(400).send({ error: 'header must include i18nKey,en,fi,sv (status optional)' });
          return;
        }
        let upserted = 0;
        for (let i = 1; i < lines.length; i++) {
          const cols = splitRow(lines[i]!);
          const key = cols[idx.key]?.trim();
          if (!key) continue;
          const en = cols[idx.en] ?? '';
          const fi = cols[idx.fi] ?? '';
          const sv = cols[idx.sv] ?? '';
          const status = idx.status >= 0 ? (cols[idx.status]?.trim() || 'active') : 'active';
          await prisma.translation.upsert({
            where: { i18nKey: key },
            update: { en, fi, sv, status },
            create: { i18nKey: key, en, fi, sv, status },
          });
          upserted++;
        }
        reply.send({ ok: true, upserted });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    // Create a Plant row from the open-data assistant's gathered values.
    // The assistant builds an object with { latinName, family, slug?,
    // nameEn?, nameFi?, nameSv?, redListStatus?, origin?, storyEn?,
    // imageUrl?, attribution?, licenseSpdx? }, the endpoint looks up
    // (or creates) the Taxon then inserts a Plant + optional PlantImage,
    // and the response is { id, slug } so the page can redirect the
    // curator to the AdminJS edit form to finish up.
    if (req.url === '/admin/plants/create-from-assistant' && req.method === 'POST') {
      try {
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.raw.on('data', (c) => chunks.push(Buffer.from(c as Uint8Array)));
          req.raw.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.raw.on('error', reject);
        });
        const dto = JSON.parse(body || '{}') as AssistantPlantDto;
        const actor = (req as any).session?.adminUser?.id ?? null;
        const result = await createPlantFromAssistantDto(dto, actor);
        reply.send(result);
      } catch (err) {
        const msg = (err as Error).message;
        reply.code(msg === 'latinName is required' ? 400 : 500).send({ error: msg });
      }
      return;
    }

    // ── Persistent bulk-add jobs ─────────────────────────────────────
    //
    // POST   /admin/plants/bulk-jobs                   → create + kick off enrichment
    // GET    /admin/plants/bulk-jobs                   → list recent jobs (latest 20)
    // GET    /admin/plants/bulk-jobs/{id}              → fetch one job's full state
    // POST   /admin/plants/bulk-jobs/{id}/create-ready → kick off creation phase
    // POST   /admin/plants/bulk-jobs/{id}/cancel       → abort inflight processing
    // POST   /admin/plants/bulk-jobs/{id}/retry-row    → re-queue a failed row's enrichment
    // POST   /admin/plants/bulk-jobs/{id}/skip-row     → mark a row as skipped (not created)
    // POST   /admin/plants/bulk-jobs/{id}/toggle-keep  → flip a row's keep flag
    // DELETE /admin/plants/bulk-jobs/{id}              → delete the job row
    if (req.url === '/admin/plants/bulk-jobs' && req.method === 'POST') {
      try {
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.raw.on('data', (c) => chunks.push(Buffer.from(c as Uint8Array)));
          req.raw.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.raw.on('error', reject);
        });
        const dto = JSON.parse(body || '{}') as { items?: Array<Partial<BulkAddJobRow>> };
        if (!Array.isArray(dto.items) || dto.items.length === 0) {
          reply.code(400).send({ error: 'items array is required' });
          return;
        }
        const items: BulkAddJobRow[] = dto.items.map((r, i) => ({
          id: r.id ?? `row-${i}-${Math.random().toString(36).slice(2, 8)}`,
          latinName: (r.latinName ?? '').toString().trim(),
          nameEn: r.nameEn?.toString(),
          nameFi: r.nameFi?.toString(),
          nameSv: r.nameSv?.toString(),
          family: r.family?.toString(),
          status: 'queued',
          keep: { story: true, origin: true, status: true, image: true },
        }));
        const job = await prisma.bulkAddJob.create({
          data: {
            createdByUser: (req as any).session?.adminUser?.id ?? null,
            status: 'running',
            phase: 'enrich',
            items: items as unknown as object,
            totals: bulkAddJobTotals(items) as unknown as object,
          },
        });
        // Fire-and-forget. The processor persists progress to the row.
        void runBulkAddEnrichmentPhase(prisma, job.id);
        reply.send({ id: job.id });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url === '/admin/plants/bulk-jobs' && req.method === 'GET') {
      try {
        const jobs = await prisma.bulkAddJob.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            status: true,
            phase: true,
            totals: true,
            createdAt: true,
            updatedAt: true,
            createdByUser: true,
          },
        });
        reply.send({ jobs });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url?.startsWith('/admin/plants/bulk-jobs/') && req.method === 'GET') {
      const id = req.url.slice('/admin/plants/bulk-jobs/'.length).split('?')[0]!;
      try {
        const job = await prisma.bulkAddJob.findUnique({ where: { id } });
        if (!job) {
          reply.code(404).send({ error: 'not found' });
          return;
        }
        reply.send({ ...job, running: isBulkAddJobRunning(id) });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (
      req.url?.startsWith('/admin/plants/bulk-jobs/') &&
      req.url.endsWith('/create-ready') &&
      req.method === 'POST'
    ) {
      const id = req.url.slice('/admin/plants/bulk-jobs/'.length, -'/create-ready'.length);
      try {
        const actor = (req as any).session?.adminUser?.id ?? null;
        // Fire-and-forget — UI polls.
        void runBulkAddCreationPhase(prisma, id, async (row) => {
          const dto = jobRowToCreateDto(row);
          return createPlantFromAssistantDto(dto, actor);
        });
        reply.send({ ok: true });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (
      req.url?.startsWith('/admin/plants/bulk-jobs/') &&
      req.url.endsWith('/cancel') &&
      req.method === 'POST'
    ) {
      const id = req.url.slice('/admin/plants/bulk-jobs/'.length, -'/cancel'.length);
      const stopped = cancelBulkAddJob(id);
      // If the job wasn't inflight in this process (e.g. the user
      // pressed Cancel after a restart), just mark the DB row.
      if (!stopped) {
        try {
          const job = await prisma.bulkAddJob.findUnique({ where: { id } });
          if (job && job.status === 'running') {
            await prisma.bulkAddJob.update({
              where: { id },
              data: { status: 'cancelled' },
            });
          }
        } catch {
          /* ignore */
        }
      }
      reply.send({ ok: true });
      return;
    }
    if (
      req.url?.startsWith('/admin/plants/bulk-jobs/') &&
      (req.url.endsWith('/retry-row') ||
        req.url.endsWith('/skip-row') ||
        req.url.endsWith('/toggle-keep')) &&
      req.method === 'POST'
    ) {
      const action = req.url.endsWith('/retry-row')
        ? 'retry-row'
        : req.url.endsWith('/skip-row')
          ? 'skip-row'
          : 'toggle-keep';
      const id = req.url.slice(
        '/admin/plants/bulk-jobs/'.length,
        -(`/${action}`.length),
      );
      try {
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.raw.on('data', (c) => chunks.push(Buffer.from(c as Uint8Array)));
          req.raw.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.raw.on('error', reject);
        });
        const dto = JSON.parse(body || '{}') as { rowId?: string; field?: string };
        const job = await prisma.bulkAddJob.findUnique({ where: { id } });
        if (!job) {
          reply.code(404).send({ error: 'not found' });
          return;
        }
        const items: BulkAddJobRow[] = (job.items as unknown as BulkAddJobRow[]).map((r) => {
          if (r.id !== dto.rowId) return r;
          if (action === 'retry-row') return { ...r, status: 'queued' as const, error: undefined };
          if (action === 'skip-row')
            return {
              ...r,
              status: (r.status === 'skipped' ? 'ready' : 'skipped') as BulkAddJobRow['status'],
            };
          if (action === 'toggle-keep' && dto.field) {
            const keep = r.keep ?? { story: true, origin: true, status: true, image: true };
            return {
              ...r,
              keep: { ...keep, [dto.field]: !keep[dto.field as keyof typeof keep] },
            };
          }
          return r;
        });
        await prisma.bulkAddJob.update({
          where: { id },
          data: {
            items: items as unknown as object,
            totals: bulkAddJobTotals(items) as unknown as object,
          },
        });
        // If we just re-queued a row and no enrichment phase is in
        // flight, kick one off so the row actually gets fetched.
        if (action === 'retry-row' && !isBulkAddJobRunning(id)) {
          void runBulkAddEnrichmentPhase(prisma, id);
        }
        reply.send({ ok: true });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url?.startsWith('/admin/plants/bulk-jobs/') && req.method === 'DELETE') {
      const id = req.url.slice('/admin/plants/bulk-jobs/'.length).split('?')[0]!;
      try {
        cancelBulkAddJob(id);
        await prisma.bulkAddJob.delete({ where: { id } });
        reply.send({ ok: true });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }

    // ── Observability ────────────────────────────────────────────────
    //
    // GET /admin/observability/events?severity=&source=&q=&traceId=&since=&until=&limit=
    // GET /admin/observability/events/{id}
    // GET /admin/observability/kpis
    if (req.url?.startsWith('/admin/observability/events/') && req.method === 'GET') {
      const id = req.url.slice('/admin/observability/events/'.length).split('?')[0]!;
      try {
        const event = await prisma.observabilityEvent.findUnique({ where: { id } });
        if (!event) {
          reply.code(404).send({ error: 'not found' });
          return;
        }
        // Pull adjacent events with the same trace id so the curator
        // sees the full picture of what surrounded the chosen event.
        const trace = event.traceId
          ? await prisma.observabilityEvent.findMany({
              where: { traceId: event.traceId },
              orderBy: { ts: 'asc' },
              take: 200,
            })
          : [];
        reply.send({ event, trace });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url?.startsWith('/admin/observability/events') && req.method === 'GET') {
      try {
        const u = new URL(req.url, 'http://x');
        const severity = u.searchParams.get('severity') ?? '';
        const source = u.searchParams.get('source') ?? '';
        const q = u.searchParams.get('q')?.trim() ?? '';
        const traceId = u.searchParams.get('traceId')?.trim() ?? '';
        const since = u.searchParams.get('since');
        const until = u.searchParams.get('until');
        const limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get('limit') ?? '200', 10) || 200));
        const where: any = {};
        if (severity) where.severity = severity;
        if (source) where.source = source;
        if (traceId) where.traceId = traceId;
        if (since || until) {
          where.ts = {};
          if (since) where.ts.gte = new Date(since);
          if (until) where.ts.lte = new Date(until);
        }
        if (q) where.message = { contains: q, mode: 'insensitive' };
        const [events, total] = await Promise.all([
          prisma.observabilityEvent.findMany({
            where,
            orderBy: { ts: 'desc' },
            take: limit,
          }),
          prisma.observabilityEvent.count({ where }),
        ]);
        reply.send({ events, total, limit });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url === '/admin/observability/kpis' && req.method === 'GET') {
      try {
        const sinceHour = new Date(Date.now() - 60 * 60 * 1000);
        const sinceDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [
          total24h,
          errors24h,
          warns24h,
          errorsHour,
          recent5xx,
          httpAvgMs,
          bySource,
          bySeverity,
        ] = await Promise.all([
          prisma.observabilityEvent.count({ where: { ts: { gte: sinceDay } } }),
          prisma.observabilityEvent.count({
            where: { ts: { gte: sinceDay }, severity: { in: ['error', 'fatal'] } },
          }),
          prisma.observabilityEvent.count({
            where: { ts: { gte: sinceDay }, severity: 'warn' },
          }),
          prisma.observabilityEvent.count({
            where: { ts: { gte: sinceHour }, severity: { in: ['error', 'fatal'] } },
          }),
          prisma.observabilityEvent.findMany({
            where: { ts: { gte: sinceDay }, severity: { in: ['error', 'fatal'] } },
            orderBy: { ts: 'desc' },
            take: 10,
          }),
          prisma.observabilityEvent.aggregate({
            where: { source: 'http', ts: { gte: sinceHour }, durationMs: { not: null } },
            _avg: { durationMs: true },
            _max: { durationMs: true },
            _count: { _all: true },
          }),
          prisma.observabilityEvent.groupBy({
            by: ['source'],
            where: { ts: { gte: sinceDay } },
            _count: { _all: true },
          }),
          prisma.observabilityEvent.groupBy({
            by: ['severity'],
            where: { ts: { gte: sinceDay } },
            _count: { _all: true },
          }),
        ]);
        const memory = process.memoryUsage();
        reply.send({
          process: {
            uptimeSec: Math.round(process.uptime()),
            pid: process.pid,
            nodeVersion: process.version,
            memRssMb: Math.round(memory.rss / 1024 / 1024),
            memHeapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
            memHeapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
          },
          last24h: { total: total24h, errors: errors24h, warns: warns24h },
          lastHour: { errors: errorsHour },
          http: {
            requestsLastHour: httpAvgMs._count?._all ?? 0,
            avgMsLastHour: httpAvgMs._avg?.durationMs ?? 0,
            maxMsLastHour: httpAvgMs._max?.durationMs ?? 0,
          },
          bySource: bySource.map((b) => ({ source: b.source, count: b._count._all })),
          bySeverity: bySeverity.map((b) => ({ severity: b.severity, count: b._count._all })),
          recentErrors: recent5xx,
        });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }

    if (req.url === '/admin/manual-docs' && req.method === 'GET') {
      try {
        const rows = await prisma.ragDocument.findMany({
          where: { title: { startsWith: '__manual__:' } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true, title: true, locale: true, body: true, createdAt: true,
            _count: { select: { chunks: true } },
          },
        });
        reply.header('content-type', 'application/json').send({
          items: rows.map((r) => ({
            id: r.id,
            title: r.title,
            locale: r.locale,
            bodyPreview: r.body.slice(0, 220),
            chunks: r._count.chunks,
            createdAt: r.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url?.startsWith('/admin/manual-docs/') && req.method === 'DELETE') {
      const id = req.url.split('/').pop()!;
      try {
        const row = await prisma.ragDocument.findUnique({
          where: { id },
          select: { title: true },
        });
        if (!row || !row.title.startsWith('__manual__:')) {
          reply.code(404).send({ error: 'manual doc not found' });
          return;
        }
        await prisma.ragDocument.delete({ where: { id } });
        reply.send({ ok: true });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url === '/admin/ingest-doc' && req.method === 'POST') {
      try {
        // onRequest fires BEFORE Fastify's body parser, so req.body is
        // undefined. Read the raw IncomingMessage stream ourselves.
        const rawChunks: Buffer[] = [];
        for await (const chunk of req.raw) {
          rawChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
        }
        const rawBody = Buffer.concat(rawChunks).toString('utf8');
        let body: { title?: string; body?: string; locale?: 'en' | 'fi' | 'sv' };
        try {
          body = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          reply.code(400).send({ error: 'invalid JSON body' });
          return;
        }
        if (!body?.title || !body?.body) {
          reply.code(400).send({ error: 'title and body required' });
          return;
        }
        const bodyText: string = body.body;
        const locale = body.locale ?? 'en';
        const fullTitle = `__manual__:${body.title.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80)}`;
        // Use the rag package's chunker + Ollama embeddings, same pipeline
        // as the scripts. Inline here to avoid pulling the worker.
        const { chunkText } = await import('@bloomoulu/rag');
        const chunks = chunkText(bodyText, { size: 500, overlap: 50 });
        const ollamaUrl =
          (process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '');
        const embedModel = process.env.OLLAMA_EMBED_MODEL ?? process.env.EMBED_MODEL ?? 'bge-m3';
        const embeddings = await Promise.all(
          chunks.map(async (c) => {
            const res = await fetch(`${ollamaUrl}/api/embeddings`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ model: embedModel, prompt: c }),
            });
            if (!res.ok) throw new Error(`Ollama ${res.status}`);
            const j = (await res.json()) as { embedding: number[] };
            return j.embedding;
          }),
        );
        const { createHash } = await import('node:crypto');
        const bodyHash = createHash('sha256').update(bodyText).digest('hex');
        const docId = await prisma.$transaction(async (tx) => {
          const existing = await tx.ragDocument.findFirst({
            where: { title: fullTitle, locale },
            select: { id: true },
          });
          let doc;
          if (existing) {
            await tx.ragChunk.deleteMany({ where: { documentId: existing.id } });
            doc = await tx.ragDocument.update({
              where: { id: existing.id },
              data: { body: bodyText, bodyHash, isPublished: true },
            });
          } else {
            doc = await tx.ragDocument.create({
              data: { title: fullTitle, locale, body: bodyText, bodyHash, isPublished: true },
            });
          }
          for (let i = 0; i < chunks.length; i++) {
            const vec = `[${embeddings[i]!.join(',')}]`;
            await tx.$executeRawUnsafe(
              `INSERT INTO "RagChunk" (id, "documentId", "chunkIndex", text, "tokenStart", "tokenEnd", locale, embedding)
               VALUES (gen_random_uuid(), $1::uuid, $2::int, $3, $4::int, $5::int, $6::"Locale", $7::vector)`,
              doc.id, i, chunks[i], 0, chunks[i]!.length, locale, vec,
            );
          }
          return doc.id;
        });
        reply.send({ ok: true, id: docId, chunks: chunks.length });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    // ── Batch settings endpoints used by /admin/pages/Config* ───────
    //   GET /admin/settings/batch?keys=a,b,c → { values: { a:..., b:... } }
    //   POST /admin/settings/batch  body { values: { a:..., b:... } } → upserts each
    if (req.url?.startsWith('/admin/settings/batch') && req.method === 'GET') {
      try {
        const url = new URL(req.url, 'http://localhost');
        const keysParam = url.searchParams.get('keys') ?? '';
        const keys = keysParam.split(',').map((k) => k.trim()).filter(Boolean);
        if (keys.length === 0) {
          reply.send({ values: {} });
          return;
        }
        const rows = await prisma.systemSetting.findMany({
          where: { key: { in: keys } },
          select: { key: true, value: true },
        });
        const values: Record<string, unknown> = {};
        for (const r of rows) values[r.key] = r.value;
        reply.send({ values });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url === '/admin/settings/batch' && req.method === 'POST') {
      try {
        const rawChunks: Buffer[] = [];
        for await (const chunk of req.raw) {
          rawChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
        }
        const rawBody = Buffer.concat(rawChunks).toString('utf8');
        const body = rawBody ? JSON.parse(rawBody) : {};
        const values = (body?.values ?? {}) as Record<string, unknown>;
        if (typeof values !== 'object' || Array.isArray(values)) {
          reply.code(400).send({ error: 'body.values must be a key/value object' });
          return;
        }
        // Upsert each setting in a single transaction; broadcast once at the end
        await prisma.$transaction(
          Object.entries(values).map(([key, value]) =>
            prisma.systemSetting.upsert({
              where: { key },
              create: { key, value: value as any, description: null },
              update: { value: value as any },
            }),
          ),
        );
        // Reuse the existing pubsub channel so the api refreshes its cache.
        try {
          await broadcastChange('SystemSetting', 'edit');
        } catch {
          /* best-effort */
        }
        reply.send({ ok: true, updated: Object.keys(values).length });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    // ── Backups (local file dumps under STORAGE_DIR/backups) ─────────
    if (req.url === '/admin/backups' && req.method === 'GET') {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const dir = path.resolve(
          process.env.STORAGE_DIR ?? path.join(process.cwd(), 'var', 'storage'),
          'backups',
        );
        let entries: string[] = [];
        try {
          entries = await fs.readdir(dir);
        } catch {
          entries = [];
        }
        const snapshots = await Promise.all(
          entries
            .filter((f) => f.endsWith('.json'))
            .map(async (f) => {
              const full = path.join(dir, f);
              try {
                const stat = await fs.stat(full);
                const raw = await fs.readFile(full, 'utf-8');
                const data = JSON.parse(raw) as { id: string; createdAt: string; tables: Record<string, number> };
                return {
                  id: data.id,
                  time: data.createdAt,
                  sizeBytes: stat.size,
                  filename: f,
                  tables: data.tables,
                };
              } catch {
                return null;
              }
            }),
        );
        reply.send({
          snapshots: snapshots
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .sort((a, b) => b.time.localeCompare(a.time)),
        });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
    // Stream a stored snapshot back as a downloadable JSON file.
    if (req.url?.startsWith('/admin/backups/') && req.url.endsWith('/download') && req.method === 'GET') {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const id = req.url.split('/')[3] ?? '';
        const dir = path.resolve(
          process.env.STORAGE_DIR ?? path.join(process.cwd(), 'var', 'storage'),
          'backups',
        );
        const filename = `${id}.json`;
        const full = path.join(dir, filename);
        // Path traversal guard — id must match the format we wrote.
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(id)) {
          reply.code(400).send({ error: 'bad id' });
          return;
        }
        const body = await fs.readFile(full);
        reply
          .header('content-type', 'application/json')
          .header('content-disposition', `attachment; filename="bloomoulu-backup-${id}.json"`)
          .send(body);
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url === '/admin/backups/run' && req.method === 'POST') {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const dir = path.resolve(
          process.env.STORAGE_DIR ?? path.join(process.cwd(), 'var', 'storage'),
          'backups',
        );
        await fs.mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const id = stamp;
        const filename = `${stamp}.json`;
        // Per-table snapshot — kept small enough for a single JSON file.
        // Covers the operationally-critical tables; large RAG / Plant
        // image rows stay in the DB (they're the bulk by volume).
        const [
          systemSettings,
          translations,
          plants,
          donations,
          payments,
          plantScans,
        ] = await Promise.all([
          prisma.systemSetting.findMany(),
          prisma.translation.findMany(),
          prisma.plant.findMany({
            select: {
              id: true, slug: true, nameEn: true, nameFi: true, nameSv: true,
              redListStatus: true, status: true, donorCount: true, voteCount: true,
              fundedCents: true, scanCount: true,
            },
          }),
          prisma.donation.findMany({
            select: {
              id: true, plantId: true, donorId: true,
              status: true, amountCents: true, createdAt: true,
            },
          }),
          prisma.payment.findMany({
            select: {
              id: true, donationId: true, provider: true, status: true,
              amountCents: true, currency: true, createdAt: true,
            },
          }),
          prisma.plantScan.findMany({
            select: { id: true, plantId: true, scannedAt: true, locale: true, kioskId: true },
          }),
        ]);
        const payload = {
          id,
          createdAt: new Date().toISOString(),
          version: 1,
          tables: {
            SystemSetting: systemSettings.length,
            Translation: translations.length,
            Plant: plants.length,
            Donation: donations.length,
            Payment: payments.length,
            PlantScan: plantScans.length,
          },
          data: {
            SystemSetting: systemSettings,
            Translation: translations,
            Plant: plants,
            Donation: donations,
            Payment: payments,
            PlantScan: plantScans,
          },
        };
        await fs.writeFile(path.join(dir, filename), JSON.stringify(payload, null, 2));
        reply.send({ ok: true, id, filename, tables: payload.tables });
      } catch (err) {
        reply.code(500).send({ ok: false, message: (err as Error).message });
      }
      return;
    }
    // ── Reconciliation: proxy to the API, which owns the matching logic ──
    if (req.url === '/admin/reconciliation/entries' && req.method === 'POST') {
      try {
        const apiBase = (process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://api:4000').replace(/\/$/, '');
        const upstream = await fetch(`${apiBase}/v1/reconciliation/entries`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
        });
        const text = await upstream.text();
        reply
          .code(upstream.status)
          .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
          .send(text);
      } catch (err) {
        reply.code(502).send({ error: (err as Error).message });
      }
      return;
    }
    if (req.url === '/admin/rebuild-summaries' && req.method === 'POST') {
      void (async () => {
        try {
          await prisma.ragDocument.deleteMany({
            where: {
              OR: [
                { title: { startsWith: '__family__:' } },
                { title: { startsWith: '__conservation__:' } },
              ],
            },
          });
        } catch (err) {
          console.warn('[admin] rebuild-summaries:', (err as Error).message);
        }
      })();
      reply.send({ ok: true, queued: true });
      return;
    }
    if (req.url === '/admin/dashboard-stats' && req.method === 'GET') {
      try {
        const startOfMonth = new Date();
        startOfMonth.setUTCDate(1);
        startOfMonth.setUTCHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [
          plants, donors, donationsCompleted, donationsMtd,
          ragDocs, webCacheDocs, curatorEscalationsOpen, askMessages7d,
          recentEscalations,
        ] = await Promise.all([
          prisma.plant.count({ where: { status: 'active' } }),
          prisma.user.count({ where: { role: 'donor' } }),
          prisma.donation.count({ where: { status: 'completed' } }),
          prisma.payment.aggregate({
            _sum: { amountCents: true },
            where: { status: 'succeeded', createdAt: { gte: startOfMonth } },
          }),
          prisma.ragDocument.count(),
          prisma.ragDocument.count({ where: { title: { startsWith: '__web__:' } } }),
          prisma.askAnswer.count({ where: { reaction: 'escalated' } }),
          prisma.askMessage.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
          prisma.askAnswer.findMany({
            where: { reaction: 'escalated' },
            orderBy: { escalatedAt: 'desc' },
            take: 5,
            select: {
              id: true, escalatedAt: true, createdAt: true,
              message: { select: { text: true, user: { select: { email: true } } } },
            },
          }),
        ]);
        reply.header('content-type', 'application/json').send({
          stats: {
            plants, donors, donationsCompleted,
            donationsMtdCents: donationsMtd._sum.amountCents ?? 0,
            ragDocs, webCacheDocs, curatorEscalationsOpen, askMessages7d,
          },
          recentEscalations: recentEscalations.map((e: any) => ({
            id: e.id,
            email: e.message?.user?.email ?? '',
            question: e.message?.text ?? '',
            createdAt: (e.escalatedAt ?? e.createdAt).toISOString(),
          })),
        });
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
      return;
    }
  });

  // Any persistent bulk-add jobs that were 'running' when the admin
  // process died need to be cleaned up so the curator sees an accurate
  // state when they return. See bulk-add-job.ts.
  try {
    await repairStaleBulkAddJobs(prisma);
  } catch (err) {
    app.log.warn(`[bulk-add] repairStaleJobs failed: ${(err as Error).message}`);
  }

  // Belt-and-braces RAG drift guard. Runs once at startup (catches up
  // any writes that landed while the admin process was down) and every
  // 6 hours thereafter. The hook in the Prisma extension above does
  // the live re-ingest; this just heals any miss.
  const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  void reconcilePlantRagDocuments(prisma).catch((err) =>
    app.log.warn(`[rag] startup reconcile failed: ${(err as Error).message}`),
  );
  setInterval(() => {
    void reconcilePlantRagDocuments(prisma).catch((err) =>
      app.log.warn(`[rag] periodic reconcile failed: ${(err as Error).message}`),
    );
  }, RECONCILE_INTERVAL_MS).unref();

  // AdminJS 7 only bundles user components when NODE_ENV=production OR
  // adminConfig.watch() is called. In dev we MUST opt in or the browser
  // gets the default welcome page instead of the BloomOulu Dashboard, and
  // every custom page falls back to AdminJS' built-in placeholder. In
  // prod the bundle is written once by initialize(); locally the watch
  // call also picks up source-file edits without a server restart.
  if (process.env.NODE_ENV === 'production') {
    await adminConfig.initialize();
  } else {
    void adminConfig.watch();
  }

  // The @adminjs/fastify peer-types target an older Fastify generic shape;
  // cast `app` so the call site compiles. The runtime behaviour is unchanged.
  await AdminJSFastify.buildAuthenticatedRouter(
    adminConfig,
    {
      authenticate: async (email, password) => {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !['admin', 'curator', 'finance'].includes(user.role)) return null;
        // Magic-link only; admin sign-in uses a one-time link emailed to staff
        // Production: integrate Auth.js v5 callback here. For initial bootstrap,
        // an admin password seeded via env ADMIN_BOOTSTRAP_PASSWORD_HASH:
        const bootHash = process.env.ADMIN_BOOTSTRAP_PASSWORD_HASH;
        if (bootHash && (await bcrypt.compare(password, bootHash))) {
          return { id: user.id, email: user.email, role: user.role };
        }
        return null;
      },
      cookiePassword: ADMIN_SESSION_SECRET,
      cookieName: ADMIN_COOKIE_NAME,
    },
    app as any,
    {
      saveUninitialized: false,
      // Use OUR signer + store so the early onRequest auth gate
      // (hasValidAdminSession) reads exactly the same session data the
      // plugin writes on login. The signer doubles as the secret here
      // (@fastify/session accepts a Signer object in `secret`).
      secret: adminCookieSigner,
      store: adminSessionStore,
      cookieName: ADMIN_COOKIE_NAME,
      cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production' },
    },
  );

  app.get('/admin/health', async () => ({ status: 'ok' }));
  app.get('/admin/metrics', async (_, reply) => {
    reply.header('content-type', 'text/plain');
    return 'admin_up 1\n';
  });

  // The /admin/dashboard-stats and /admin/rebuild-summaries handlers
  // are registered above via onRequest because AdminJS's plugin
  // claims everything under /admin/*. The route handlers below would
  // never get reached.
  app.get('/admin/dashboard-stats-unused', async () => {
    try {
      const startOfMonth = new Date();
      startOfMonth.setUTCDate(1);
      startOfMonth.setUTCHours(0, 0, 0, 0);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        plants,
        donors,
        donationsCompleted,
        donationsMtd,
        ragDocs,
        webCacheDocs,
        curatorEscalationsOpen,
        askMessages7d,
        recentEscalations,
      ] = await Promise.all([
        prisma.plant.count({ where: { status: 'active' } }),
        prisma.user.count({ where: { role: 'donor' } }),
        prisma.donation.count({ where: { status: 'completed' } }),
        prisma.payment.aggregate({
          _sum: { amountCents: true },
          where: { status: 'succeeded', createdAt: { gte: startOfMonth } },
        }),
        prisma.ragDocument.count(),
        prisma.ragDocument.count({ where: { title: { startsWith: '__web__:' } } }),
        prisma.askAnswer.count({ where: { reaction: 'escalated' } }),
        prisma.askMessage.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.askAnswer.findMany({
          where: { reaction: 'escalated' },
          orderBy: { escalatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            escalatedAt: true,
            createdAt: true,
            message: { select: { text: true, user: { select: { email: true } } } },
          },
        }),
      ]);

      return {
        stats: {
          plants,
          donors,
          donationsCompleted,
          donationsMtdCents: donationsMtd._sum.amountCents ?? 0,
          ragDocs,
          webCacheDocs,
          curatorEscalationsOpen,
          askMessages7d,
        },
        recentEscalations: recentEscalations.map((e) => ({
          id: e.id,
          email: e.message?.user?.email ?? '',
          question: e.message?.text ?? '',
          createdAt: (e.escalatedAt ?? e.createdAt).toISOString(),
        })),
      };
    } catch (err) {
      return { stats: null, recentEscalations: [], error: (err as Error).message };
    }
  });

  // Rebuild family + conservation summary chunks from the DB. Returns
  // immediately and runs the rebuild fire-and-forget so the request
  // doesn't sit waiting for ~5s of embedding work.
  app.post('/admin/rebuild-summaries', async () => {
    void (async () => {
      try {
        await prisma.ragDocument.deleteMany({
          where: {
            OR: [
              { title: { startsWith: '__family__:' } },
              { title: { startsWith: '__conservation__:' } },
            ],
          },
        });
        console.log('[admin] family + conservation summary docs removed; the next corpus rebuild will repopulate.');
      } catch (err) {
        console.warn('[admin] rebuild-summaries failed:', (err as Error).message);
      }
    })();
    return { ok: true, queued: true };
  });

  // Prefer ADMIN_PORT so we don't collide with API's PORT when both run from
  // the same monorepo .env in `pnpm dev`. Docker containers don't set PORT
  // for admin, so the default still holds in prod.
  const port = parseInt(process.env.ADMIN_PORT ?? '4100', 10);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Admin listening on :${port}/admin`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
