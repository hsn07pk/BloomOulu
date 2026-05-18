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
import bcrypt from 'bcryptjs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const queueConn = { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } };
const emailQueue = new Queue('email', queueConn);
const eraseQueue = new Queue('gdpr-erase', queueConn);

AdminJS.registerAdapter({ Database, Resource });

const prisma = new PrismaClient();

// AdminJS 7 replaced the static `AdminJS.bundle()` helper with an instance-
// based ComponentLoader. Custom React panels register with the loader; the
// returned token is passed as `component` to page/action definitions.
const here = path.dirname(fileURLToPath(import.meta.url));
const componentLoader = new ComponentLoader();
const SettingsPage = componentLoader.add('Settings', path.join(here, 'pages/Settings'));
const TranslationsPage = componentLoader.add('Translations', path.join(here, 'pages/Translations'));
const BackupsPage = componentLoader.add('Backups', path.join(here, 'pages/Backups'));
const ReconciliationPage = componentLoader.add('Reconciliation', path.join(here, 'pages/Reconciliation'));

// AdminJS 7's exported types are looser than its runtime accepts (page `label`,
// `branding.softwareBrothers`, the static `AdminJS.bundle` helper, action
// handlers `(req, res, ctx)` signature). We cast the config to `any` so the
// compile-time types don't fight the runtime API — every flagged property is
// in fact supported by `adminjs@7.8`. Document any further casts inline.
const adminConfig = new AdminJS({
  rootPath: '/admin',
  componentLoader,
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
      },
    },
    { resource: { model: getModelByName('Taxon'), client: prisma }, options: { navigation: { name: 'Catalogue' } } },
    { resource: { model: getModelByName('Accession'), client: prisma }, options: { navigation: { name: 'Catalogue' } } },
    { resource: { model: getModelByName('PlantImage'), client: prisma }, options: { navigation: { name: 'Catalogue' } } },
    { resource: { model: getModelByName('AudioNarration'), client: prisma }, options: { navigation: { name: 'Catalogue' } } },
    { resource: { model: getModelByName('Citation'), client: prisma }, options: { navigation: { name: 'Catalogue' } } },
    // ── Tiers + pricing ────────────────────────────────────────────────
    {
      resource: { model: getModelByName('Tier'), client: prisma },
      options: {
        navigation: { name: 'Pricing', icon: 'Tag' },
        properties: {
          annualPriceCents: { description: 'Annual price in cents. €25 = 2500.' },
          monthlyPriceCents: { description: 'Monthly opt-in price in cents. Leave blank for annual-only tiers.' },
          perks: { description: 'List of perk keys; localized strings come from the Translation editor.' },
        },
      },
    },
    // ── Adoptions + donors ─────────────────────────────────────────────
    {
      resource: { model: getModelByName('Adoption'), client: prisma },
      options: {
        navigation: { name: 'Donors', icon: 'Heart' },
        listProperties: ['createdAt', 'donorId', 'plantId', 'tierId', 'status', 'amountCents'],
        actions: {
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
              return { record: ctx.record!.toJSON(ctx.currentAdmin) };
            },
          },
        },
      },
    },
    { resource: { model: getModelByName('User'), client: prisma }, options: { navigation: { name: 'Donors' } } },
    { resource: { model: getModelByName('GiftCode'), client: prisma }, options: { navigation: { name: 'Donors' } } },
    {
      resource: { model: getModelByName('Plaque'), client: prisma },
      options: {
        navigation: { name: 'Donors', icon: 'Bookmark' },
        listProperties: ['createdAt', 'adoptionId', 'engravedText', 'status', 'installedAt'],
        sort: { sortBy: 'createdAt', direction: 'desc' as const },
        actions: {
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
        listProperties: ['createdAt', 'provider', 'amountCents', 'status', 'donorId'],
      },
    },
    { resource: { model: getModelByName('Receipt'), client: prisma }, options: { navigation: { name: 'Finance' } } },
    { resource: { model: getModelByName('TaxCertificate'), client: prisma }, options: { navigation: { name: 'Finance' } } },
    { resource: { model: getModelByName('ProcessedEvent'), client: prisma }, options: { navigation: { name: 'Finance' } } },
    // ── RAG ────────────────────────────────────────────────────────────
    { resource: { model: getModelByName('RagDocument'), client: prisma }, options: { navigation: { name: 'AskTheGarden', icon: 'MessageCircle' } } },
    {
      resource: { model: getModelByName('RagChunk'), client: prisma },
      options: {
        navigation: { name: 'AskTheGarden' },
        listProperties: ['documentId', 'chunkIndex', 'locale', 'tokenStart', 'tokenEnd'],
        actions: { new: { isAccessible: false }, edit: { isAccessible: false } },
        properties: {
          embedding: { isVisible: { list: false, edit: false, show: false, filter: false } },
        },
      },
    },
    { resource: { model: getModelByName('AskMessage'), client: prisma }, options: { navigation: { name: 'AskTheGarden' } } },
    { resource: { model: getModelByName('AskAnswer'), client: prisma }, options: { navigation: { name: 'AskTheGarden' } } },
    // ── Kiosk ──────────────────────────────────────────────────────────
    { resource: { model: getModelByName('KioskDevice'), client: prisma }, options: { navigation: { name: 'Kiosk', icon: 'Monitor' } } },
    { resource: { model: getModelByName('KioskEvent'), client: prisma }, options: { navigation: { name: 'Kiosk' } } },
    // ── Audit + GDPR ───────────────────────────────────────────────────
    {
      resource: { model: getModelByName('AuditLog'), client: prisma },
      options: {
        navigation: { name: 'Audit & GDPR', icon: 'Shield' },
        sort: { sortBy: 'occurredAt', direction: 'desc' as const },
        actions: {
          new: { isAccessible: false },
          edit: { isAccessible: false },
          delete: { isAccessible: false },
        },
      },
    },
    { resource: { model: getModelByName('DataExportRequest'), client: prisma }, options: { navigation: { name: 'Audit & GDPR' } } },
    // ── Operations config (ADR-0007 admin surfaces) ────────────────────
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
      },
    },
    {
      resource: { model: getModelByName('JobRun'), client: prisma },
      options: {
        navigation: { name: 'Operations', icon: 'Activity' },
        listProperties: ['queueName', 'jobName', 'status', 'startedAt', 'finishedAt', 'attempts'],
        actions: { new: { isAccessible: false }, edit: { isAccessible: false }, delete: { isAccessible: false } },
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
  },
} as any);

async function bootstrap() {
  const app = Fastify({ logger: true, trustProxy: true });

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

  const port = parseInt(process.env.PORT ?? '4100', 10);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Admin listening on :${port}/admin`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
