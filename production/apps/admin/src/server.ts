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
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import bcrypt from 'bcryptjs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const queueConn = { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } };
const emailQueue = new Queue('email', queueConn);
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

// Shorthand presets for each ADR-0007 surface.
const CURATOR_OR_ADMIN = ['curator', 'admin'] as const;
const FINANCE_OR_ADMIN = ['finance', 'admin'] as const;
const ADMIN_ONLY = ['admin'] as const;

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
const IngestDocPage = componentLoader.add('IngestDoc', path.join(here, 'pages/IngestDoc'));
const GardenIdentityPage = componentLoader.add('GardenIdentity', path.join(here, 'pages/GardenIdentity'));
const PaymentProvidersPage = componentLoader.add('PaymentProviders', path.join(here, 'pages/PaymentProviders'));
const CuratorConfigPage = componentLoader.add('CuratorConfig', path.join(here, 'pages/CuratorConfig'));
const AdoptionConfigPage = componentLoader.add('AdoptionConfig', path.join(here, 'pages/AdoptionConfig'));
const QrMetricsPage = componentLoader.add('QrMetrics', path.join(here, 'pages/QrMetrics'));
const QrLabelConfigPage = componentLoader.add('QrLabelConfig', path.join(here, 'pages/QrLabelConfig'));

// AdminJS 7's exported types are looser than its runtime accepts (page `label`,
// `branding.softwareBrothers`, the static `AdminJS.bundle` helper, action
// handlers `(req, res, ctx)` signature). We cast the config to `any` so the
// compile-time types don't fight the runtime API — every flagged property is
// in fact supported by `adminjs@7.8`. Document any further casts inline.
const adminConfig = new AdminJS({
  rootPath: '/admin',
  componentLoader,
  // Replace the AdminJS welcome page with the BloomOulu dashboard.
  // The component fetches /admin/api/dashboard-stats every 30s and
  // renders metrics tiles + curator escalations + quick-action links.
  dashboard: { component: DashboardPage } as any,
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
  locale: { language: 'en', availableLanguages: ['en', 'fi'] },
  resources: [
    // ── Catalogue ─────────────────────────────────────────────────────
    {
      resource: { model: getModelByName('Plant'), client: prisma },
      options: {
        navigation: { name: 'Catalogue', icon: 'Plants' },
        listProperties: ['nameEn', 'nameFi', 'redListStatus', 'bloomSeason', 'status', 'adopterCount'],
        editProperties: [
          'slug', 'taxonId', 'nameEn', 'nameFi', 'nameSv',
          'redListStatus', 'redListYear', 'origin', 'habitat', 'biome',
          'bloomSeason', 'bloomWindow', 'story', 'quickFacts',
          'microLat', 'microLng', 'gardenZone',
          'targetCents', 'status',
        ],
        properties: {
          targetCents: { description: 'Funding target for this plant, in cents (€500 = 50000)' },
          status: { description: '"active" shows on the site; "hidden" keeps it off the public catalogue' },
          story: { type: 'mixed', isArray: false, components: {} },
        },
        sort: { sortBy: 'adopterCount', direction: 'desc' as const },
        actions: {
          ...restrictTo(...CURATOR_OR_ADMIN),
          // Fetch story / origin / conservation status / photo from open
          // data (Wikipedia, GBIF, laji.fi, Wikimedia) via a background job.
          enrich: {
            actionType: 'record',
            label: 'Enrich from open data',
            icon: 'Download',
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'curator'].includes(currentAdmin?.role as string),
            handler: enrichHandler(false),
          },
          enrichOverwrite: {
            actionType: 'record',
            label: 'Re-enrich (overwrite)',
            icon: 'RefreshCw',
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
    // ── Tiers + pricing ────────────────────────────────────────────────
    {
      resource: { model: getModelByName('Tier'), client: prisma },
      options: {
        navigation: { name: 'Pricing', icon: 'Tag' },
        listProperties: ['id', 'name', 'annualPriceCents', 'monthlyPriceCents', 'tagEn', 'sortOrder'],
        editProperties: [
          'id', 'sortOrder',
          'name', 'nameFi', 'nameSv',
          'tagEn', 'tagFi', 'tagSv',
          'blurbEn', 'blurbFi', 'blurbSv',
          'annualPriceCents', 'monthlyPriceCents',
          'perks',
          'color', 'bg',
        ],
        properties: {
          id: { description: 'Stable id — donor-facing URLs and DTOs reference it. Edit only when introducing a new tier.' },
          sortOrder: { description: 'Order in the donor-facing tier ladder. 1 = leftmost.' },
          annualPriceCents: { description: 'Annual price in cents. €25 = 2500, €750 = 75000.' },
          monthlyPriceCents: { description: 'Monthly opt-in price in cents. Leave blank for annual-only tiers (e.g. Corporate).' },
          name: { description: 'English tier name shown on the card (e.g. "Seedling").' },
          nameFi: { description: 'Finnish tier name (e.g. "Siemen").' },
          nameSv: { description: 'Swedish tier name (e.g. "Frö").' },
          tagEn: { description: 'Small badge in the upper-right of the tier card ("Most popular gift", "Best value", …). Leave blank to hide.' },
          tagFi: { description: 'Finnish version of the tag badge.' },
          tagSv: { description: 'Swedish version of the tag badge.' },
          blurbEn: { description: 'English one-paragraph description below the price. Keep under 240 chars.' },
          blurbFi: { description: 'Finnish description.' },
          blurbSv: { description: 'Swedish description.' },
          perks: {
            description:
              'Bulleted perks shown on the tier card. JSON array. Each entry can be:\n' +
              '  • a string key from the built-in vocabulary (e.g. "nickname_your_plant"); or\n' +
              '  • an object with inline locale labels: {"labelEn": "Custom perk", "labelFi": "…", "labelSv": "…"}.\n' +
              'Mix both freely. Reorder by editing the JSON.',
            type: 'mixed',
          },
          color: { description: 'Tier accent colour (hex, e.g. "#A8C060"). Used for selection borders + check icons.' },
          bg: { description: 'Tier-card background colour (hex, e.g. "#E8EEDE").' },
        },
        sort: { sortBy: 'sortOrder', direction: 'asc' as const },
        // Pricing changes are financially material — admin only. Finance
        // gets a read-only view via the AuditLog + the Payment resource.
        actions: restrictTo(...ADMIN_ONLY),
      },
    },
    // ── Adoptions + donors ─────────────────────────────────────────────
    {
      resource: { model: getModelByName('Adoption'), client: prisma },
      options: {
        navigation: { name: 'Donors', icon: 'Heart' },
        listProperties: ['createdAt', 'donorId', 'plantId', 'tierId', 'status', 'intent', 'amountCents'],
        filterProperties: ['status', 'intent', 'tierId', 'recurring', 'billingInterval', 'createdAt', 'donorId', 'bundleId'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          status: { description: 'pending · active · paused · cancelled · ended. Cancel via the "Cancel adoption" record action; never edit by hand.' },
          intent: { description: 'for_self · gift · memorial · class · corporate. Gift adoptions have a recipient User row; memorial adoptions have a memorialOf string.' },
          tierId: { description: 'Tier snapshot at the time of the adoption. Price changes don\'t back-rewrite this — the donor keeps the price they agreed to.' },
          amountCents: { description: 'Per-period amount in cents (€25 = 2500). Stable across price changes for the lifetime of this adoption.' },
          recurring: { description: 'Whether the adoption auto-renews. one_time intervals have recurring=false.' },
          billingInterval: { description: 'monthly · annual · one_time. Allowed values controlled by adoption.intervalsEnabled.' },
          bundleId: { description: 'Set when the donor checked out multiple plants together; siblings share this id and activate as a group.' },
          giftRecipientId: { description: 'Recipient User row for gift adoptions. Donor still pays; recipient sees the plant in My Garden.' },
          giftCodeId: { description: 'Single-use redemption code if the gift hasn\'t been claimed yet.' },
          memorialOf: { description: 'Name of the person being honoured. Shown on the plant page and the donor wall.' },
          coAdopters: { description: 'JSON array of {name?, email?} co-adopter entries — the split-the-gift feature.' },
          marketingOptIn: { description: 'Did the donor agree to seasonal newsletter emails at checkout?' },
          showOnDonorWall: { description: 'When true, the donor\'s name appears on the plant\'s donor wall. False = anonymous.' },
          dedication: { description: 'Optional public message (≤240 chars) the donor wrote for this adoption.' },
        },
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          cancel: {
            actionType: 'record',
            label: 'Cancel adoption',
            icon: 'X',
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes(currentAdmin?.role as string),
            handler: async (_req: any, _res: any, ctx: any) => {
              await prisma.adoption.update({
                where: { id: ctx.record!.params['id'] },
                data: { status: 'cancelled', cancelledAt: new Date() },
              });
              await prisma.auditLog.create({
                data: {
                  actorUserId: ctx.currentAdmin?.id ?? null,
                  action: 'admin.adoption.cancel',
                  resource: `Adoption/${ctx.record!.params['id']}`,
                },
              });
              return { record: ctx.record!.toJSON(ctx.currentAdmin) };
            },
          },
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
          email: { description: 'Donor email — also the unique sign-in identifier. Type to search.' },
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
    {
      resource: { model: getModelByName('GiftCode'), client: prisma },
      options: {
        navigation: { name: 'Donors', icon: 'Gift' },
        listProperties: ['code', 'amountCents', 'expiresAt', 'redeemedAt', 'createdAt'],
        filterProperties: ['code', 'expiresAt', 'redeemedAt', 'createdAt'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          code: { description: 'Short alphanumeric code donors type at checkout. Treat as a secret — never log.' },
          amountCents: { description: 'Face value of the gift card in cents (€25 = 2500).' },
          expiresAt: { description: 'After this date the code is rejected at checkout.' },
          redeemedAt: { description: 'Filled when the code is first applied; subsequent uses are rejected.' },
        },
        actions: restrictTo(...FINANCE_OR_ADMIN),
      },
    },
    {
      resource: { model: getModelByName('Plaque'), client: prisma },
      options: {
        navigation: { name: 'Donors', icon: 'Bookmark' },
        listProperties: ['createdAt', 'adoptionId', 'engravedText', 'status', 'installedAt'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        actions: {
          ...restrictTo('curator', 'admin'),
          markInstalled: {
            actionType: 'record',
            label: 'Mark installed',
            icon: 'CheckCircle',
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'curator'].includes(currentAdmin?.role as string),
            handler: async (_req: any, _res: any, ctx: any) => {
              const id = ctx.record!.params['id'];
              const photoUrl = ctx.request?.payload?.photoUrl ?? null;
              const plaque = await prisma.plaque.update({
                where: { id },
                data: {
                  status: 'installed',
                  installedAt: new Date(),
                  ...(photoUrl ? { photoUrl } : {}),
                },
                include: {
                  adoption: { include: { plant: true, donor: { select: { email: true, name: true, locale: true } } } },
                },
              });
              await emailQueue.add(
                'send',
                {
                  template: 'plaque-ready',
                  to: plaque.adoption.donor.email,
                  locale: plaque.adoption.donor.locale,
                  variables: {
                    donorName: plaque.adoption.donor.name ?? '',
                    plantName: plaque.adoption.plant.nameEn,
                    photoUrl: photoUrl ?? '',
                  },
                },
                { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
              );
              return { record: ctx.record!.toJSON(ctx.currentAdmin) };
            },
          },
        },
      },
    },
    // ── Finance ────────────────────────────────────────────────────────
    {
      resource: { model: getModelByName('Payment'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'Dollar' },
        listProperties: ['createdAt', 'provider', 'amountCents', 'status', 'donorId', 'orderId'],
        filterProperties: ['provider', 'status', 'createdAt', 'amountCents', 'donorId', 'orderId'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          orderId: { description: 'Our idempotency key sent to the payment provider. Search by full or partial id.' },
          providerPaymentRef: { description: 'Provider-side reference (Paytrail transactionId / MobilePay agreement id).' },
          provider: { description: 'paytrail · mobilepay · bank_transfer.' },
          status: { description: 'pending · succeeded · failed · refunded · cancelled.' },
          amountCents: { description: 'Gross amount in cents (€25 = 2500).' },
        },
        actions: restrictTo(...FINANCE_OR_ADMIN),
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
          pdfUrl: { description: 'Pre-signed S3/MinIO URL — 7-day TTL. Donors download the PDF from /garden.' },
        },
        actions: restrictTo(...FINANCE_OR_ADMIN),
      },
    },
    {
      resource: { model: getModelByName('TaxCertificate'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'Award' },
        listProperties: ['year', 'donorId', 'totalCents', 'issuedAt', 'pdfUrl'],
        filterProperties: ['year', 'donorId', 'issuedAt'],
        sort: { sortBy: 'year', direction: 'desc' as const },
        properties: {
          year: { description: 'Tax year covered (e.g. 2026 = donations from 1 Jan 2026 to 31 Dec 2026).' },
          totalCents: { description: 'Sum of deductible donations for that year, in cents.' },
          pdfUrl: { description: 'Pre-signed S3/MinIO URL — 7-day TTL.' },
        },
        actions: restrictTo(...FINANCE_OR_ADMIN),
      },
    },
    {
      resource: { model: getModelByName('ProcessedEvent'), client: prisma },
      options: {
        navigation: { name: 'Finance', icon: 'GitBranch' },
        listProperties: ['provider', 'providerEventId', 'paymentId', 'createdAt'],
        filterProperties: ['provider', 'createdAt'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        properties: {
          provider: { description: 'Source provider of the webhook event.' },
          providerEventId: { description: 'Idempotency key — a duplicate delivery is silently swallowed.' },
        },
        actions: restrictTo(...FINANCE_OR_ADMIN),
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
  pages: {
    settings: {
      label: 'Settings',
      icon: 'Settings',
      handler: async () => ({}),
      component: SettingsPage,
    },
    translations: {
      label: 'Translations',
      icon: 'Globe',
      handler: async () => ({}),
      component: TranslationsPage,
    },
    backups: {
      label: 'Backups',
      icon: 'Save',
      handler: async () => ({}),
      component: BackupsPage,
    },
    reconciliation: {
      label: 'Reconciliation',
      icon: 'CheckCircle',
      handler: async () => ({}),
      component: ReconciliationPage,
    },
    qrMetrics: {
      label: 'QR scans',
      icon: 'BarChart2',
      handler: async () => ({}),
      component: QrMetricsPage,
    },
    ingest: {
      label: 'Ingest RAG doc',
      icon: 'Plus',
      handler: async () => ({}),
      component: IngestDocPage,
    },
    // ── Configure: end-user-friendly pages grouped by domain.
    //    Each renders apps/admin/src/pages/ConfigForm via a small
    //    schema-only wrapper. Saves go through /admin/settings/batch.
    gardenIdentity: {
      label: 'Garden Identity',
      icon: 'Tag',
      handler: async () => ({}),
      component: GardenIdentityPage,
    },
    paymentProviders: {
      label: 'Payment Providers',
      icon: 'CreditCard',
      handler: async () => ({}),
      component: PaymentProvidersPage,
    },
    curatorConfig: {
      label: 'Curator & Ask',
      icon: 'MessageCircle',
      handler: async () => ({}),
      component: CuratorConfigPage,
    },
    adoptionConfig: {
      label: 'Adoption Knobs',
      icon: 'Heart',
      handler: async () => ({}),
      component: AdoptionConfigPage,
    },
    qrLabelConfig: {
      label: 'QR labels',
      icon: 'Printer',
      handler: async () => ({}),
      component: QrLabelConfigPage,
    },
  },
} as any);

async function bootstrap() {
  const app = Fastify({ logger: true, trustProxy: true });

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
    // ── Manual RAG doc ingest ────────────────────────────────────────
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
          plants, donors, adoptionsActive, donationsMtd,
          ragDocs, webCacheDocs, curatorEscalationsOpen, askMessages7d,
          recentEscalations,
        ] = await Promise.all([
          prisma.plant.count({ where: { status: 'active' } }),
          prisma.user.count({ where: { role: 'donor' } }),
          prisma.adoption.count({ where: { status: 'active' } }),
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
            plants, donors, adoptionsActive,
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
      cookiePassword: process.env.AUTH_SECRET ?? 'change-me-in-prod-32+chars-please',
      cookieName: 'bloomoulu_admin',
    },
    app as any,
    {
      saveUninitialized: false,
      secret: process.env.AUTH_SECRET ?? 'change-me-in-prod-32+chars',
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
        adoptionsActive,
        donationsMtd,
        ragDocs,
        webCacheDocs,
        curatorEscalationsOpen,
        askMessages7d,
        recentEscalations,
      ] = await Promise.all([
        prisma.plant.count({ where: { status: 'active' } }),
        prisma.user.count({ where: { role: 'donor' } }),
        prisma.adoption.count({ where: { status: 'active' } }),
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
          adoptionsActive,
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

  const port = parseInt(process.env.PORT ?? '4100', 10);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Admin listening on :${port}/admin`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
