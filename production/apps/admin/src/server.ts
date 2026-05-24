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
import { cancelAdoption } from '@bloomoulu/db';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import bcrypt from 'bcryptjs';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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
          'gardenZone', 'status', 'adopterCount', 'fundedCents', 'scanCount',
        ],
        // Form rendered on /admin/resources/Plant/actions/new and /…/edit.
        // Every column on the public site (web app PlantCard, kiosk plant
        // page) and every field the open-data enrichment writes is listed
        // here so a curator can fill them all without dropping into the
        // database. Counters (adopterCount, fundedCents, scanCount) are
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
          'targetCents', 'fundedCents', 'adopterCount', 'scanCount',
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
          redListStatus: { description: 'IUCN / Finnish Red List category: CR · EN · VU · NT · LC · DD · NE · NA. Drives the badge on the public card.' },
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
          adopterCount: { description: 'Number of active adoptions. Denormalised counter — read-only; updated automatically when adoptions activate or cancel.' },
          fundedCents: { description: 'Total amount donated (in cents). Read-only counter — sourced from Adoption rows.' },
          scanCount: { description: 'Lifetime QR scan count. Read-only counter — bumped per insert via PlantsService.recordScan.' },
          targetCents: { description: 'Funding target for this plant (in cents). e.g. €500 = 50000. Shown on the public card as a progress bar.' },
          status: { description: '"active" shows on the public site; "hidden" keeps it off the catalogue; "retired" archives it but keeps the donor record.' },
          createdAt: { description: 'Row creation timestamp. Read-only.' },
          updatedAt: { description: 'Most-recent update timestamp. Read-only; bumped automatically.' },
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
            component: false,
            isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
              ['admin', 'finance'].includes(currentAdmin?.role as string),
            handler: async (_req: any, _res: any, ctx: any) => {
              const adoptionId = ctx.record!.params['id'];
              const actorUserId = ctx.currentAdmin?.id ?? null;
              // One transaction: status flip + counter decrement +
              // adoption.cancelled audit (via cancelAdoption) PLUS the
              // admin-specific audit row that records WHO clicked it.
              await prisma.$transaction(async (tx) => {
                await cancelAdoption(
                  tx,
                  adoptionId,
                  { reason: 'admin_cancel', cancelledAt: new Date() },
                  actorUserId ?? undefined,
                );
                await tx.auditLog.create({
                  data: {
                    actorUserId,
                    action: 'admin.adoption.cancel',
                    resource: `Adoption/${adoptionId}`,
                  },
                });
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
            component: false,
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
        // Financial rows MUST be immutable from the UI: deletes break
        // reconciliation + audit trail. Refunds use the dedicated
        // /v1/admin/payments/:id/refund flow, not row delete.
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          delete: { isAccessible: false },
          bulkDelete: { isAccessible: false },
          new: { isAccessible: false },
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
        listProperties: ['year', 'donorId', 'totalCents', 'issuedAt', 'pdfUrl'],
        filterProperties: ['year', 'donorId', 'issuedAt'],
        sort: { sortBy: 'year', direction: 'desc' as const },
        properties: {
          year: { description: 'Tax year covered (e.g. 2026 = donations from 1 Jan 2026 to 31 Dec 2026).' },
          totalCents: { description: 'Sum of deductible donations for that year, in cents.' },
          pdfUrl: { description: 'Local /v1/files/* URL — served directly from STORAGE_DIR.' },
        },
        actions: {
          ...restrictTo(...FINANCE_OR_ADMIN),
          delete: { isAccessible: false },
          bulkDelete: { isAccessible: false },
          new: { isAccessible: false },
        },
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
  },
} as any);

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
          orderBy: [{ adopterCount: 'desc' }, { nameEn: 'asc' }],
          select: {
            id: true, slug: true, nameEn: true, nameFi: true, nameSv: true,
            redListStatus: true, gardenZone: true, adopterCount: true,
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
          tiers,
          plants,
          adoptions,
          payments,
          plantScans,
        ] = await Promise.all([
          prisma.systemSetting.findMany(),
          prisma.translation.findMany(),
          prisma.tier.findMany(),
          prisma.plant.findMany({
            select: {
              id: true, slug: true, nameEn: true, nameFi: true, nameSv: true,
              redListStatus: true, status: true, adopterCount: true,
              fundedCents: true, scanCount: true,
            },
          }),
          prisma.adoption.findMany({
            select: {
              id: true, plantId: true, donorId: true, tierId: true, intent: true,
              status: true, amountCents: true, billingInterval: true, createdAt: true,
              bundleId: true,
            },
          }),
          prisma.payment.findMany({
            select: {
              id: true, adoptionId: true, provider: true, status: true,
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
            Tier: tiers.length,
            Plant: plants.length,
            Adoption: adoptions.length,
            Payment: payments.length,
            PlantScan: plantScans.length,
          },
          data: {
            SystemSetting: systemSettings,
            Translation: translations,
            Tier: tiers,
            Plant: plants,
            Adoption: adoptions,
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
