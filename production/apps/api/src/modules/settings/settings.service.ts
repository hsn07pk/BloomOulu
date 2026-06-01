import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  BILLING_INTERVALS,
  DEFAULT_INTERVALS_ENABLED,
  DEFAULT_PLAQUE_ELIGIBLE_TIERS,
  TIER_IDS,
  type BillingInterval,
  type TierId,
} from '@bloomoulu/constants';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Runtime configuration that admins can flip on the fly. Stored in a
 * `SystemSetting` table (key/value, with a typed schema in the admin UI).
 *
 * In production, settings load once on boot, cache in memory for 60s, and
 * refresh on pub/sub notification ("settings.updated" via Redis). For now we
 * lazy-fetch and cache.
 */
export interface BloomOuluSettings {
  /** Which payment providers are enabled — admins toggle these in /admin */
  payments: {
    bank_transfer: boolean;
    paytrail: boolean;
    mobilepay: boolean;
  };
  /** Garden's IBAN config for the bank-transfer rail */
  bankTransfer: {
    iban: string;
    bic: string;
    beneficiaryName: string;
    instructionsUrl: string;
  };
  /** Garden's legal / signage identity. Surfaced on printed receipts,
   *  tax certificates, donation pages, and the public footer. Admins
   *  edit these via /admin → Garden Identity. */
  garden: {
    /** Display name on receipts and the public footer. */
    name: string;
    /** Finnish VAT / Business ID (Y-tunnus) — printed on receipts. */
    vatId: string;
    /** Full postal address, one string with line breaks (\n). */
    address: string;
    /** Optional public contact email. */
    contactEmail: string;
  };
  /** VAT — donations to a Finnish yleishyödyllinen yhteisö are typically
   *  outside VAT scope; configurable per line type. */
  vat: {
    donationRateBp: number; // 0 = exempt
    perkRateBp: number;     // 14% reduced (food/books) | 24% standard
  };
  /** Feature flags */
  features: {
    rag: boolean;
    kiosk: boolean;
    corporateTier: boolean;
    payByBank: boolean;
  };
  /** Receipt numbering + branding */
  receipts: {
    prefix: string;            // "BLO"
    yearReset: boolean;        // counter resets on Jan 1
  };
  /** GDPR retention windows */
  gdpr: {
    auditRetentionDays: number;
    pseudonymiseAfterDays: number;
    /** AskTheGarden chat transcript retention before pseudonymisation.
     *  Privacy policy promises "12 months, then pseudonymised". */
    askMessageRetentionDays: number;
    /** Ephemeral analytics retention (PlantScan / KioskEvent /
     *  ObservabilityEvent). Privacy policy promises 90 days. */
    analyticsRetentionDays: number;
  };
  /** Default donation amount when none is specified (kiosk fallback) */
  defaultAmountCents: number;
  /** Adoption flow steps — admins can reorder/disable in /admin */
  adoptionFlow: string[];
  /** Adopt-page knobs — surfaced to the wizard via /v1/settings/public.
   *  Everything in here is editable from /admin/resources/SystemSetting. */
  adoption: {
    /** Linen-card gift-wrap upgrade, in cents. €4 = 400. */
    giftWrapCents: number;
    /** Share of the gross donation treated as a pure donation (no VAT),
     *  in basis points. 7200 = 72% donation / 28% benefits — used only
     *  in the donor-facing tax-disclosure box. Authoritative VAT
     *  computation still uses vat.donationRateBp / vat.perkRateBp. */
    donationShareBp: number;
    /** Tiers that earn an individually engraved plaque. */
    plaqueEligibleTiers: readonly TierId[];
    /** Max length of the donor-facing dedication string. */
    dedicationMaxChars: number;
    /** Max co-adopters per adoption. */
    coAdopterMax: number;
    /** Which billing intervals the donor sees. Production default is
     *  ['monthly', 'one_time']; an admin can enable 'annual' later
     *  without a deploy by editing SystemSetting `adoption.intervalsEnabled`. */
    intervalsEnabled: readonly BillingInterval[];
  };
  /** AskTheGarden knobs surfaced via /v1/settings/public. Admins edit
   *  these in /admin/resources/SystemSetting. */
  ask: {
    /** Inbox where escalated questions land. */
    curatorEmail: string;
    /** Display name shown in the chat ("Curator <Name>"). */
    curatorName: string;
    /** Reply-time promise we surface to donors. */
    curatorReplySlaDays: number;
    /** RAG min-score floor (basis points). Mirrors MIN_SCORE in ask.service.
     *  7200 = 0.72 cosine similarity, the threshold from ADR-0005. */
    confidenceThresholdBp: number;
    /** Audit error-rate target shown on the right rail. 0.05 = 5% (ADR-0005
     *  "below 5% threshold for public launch"). */
    auditErrorTarget: number;
    /** External link-outs shown in the out-of-domain callout. */
    outOfDomain: {
      bgci: string;
      gbif: string;
      plantnet: string;
    };
  };
  /** 24/7 plant enrichment worker knobs. Controls the continuous
   *  background scheduler that re-enriches plants from open-data sources
   *  (Wikipedia, GBIF, laji.fi, Wikimedia Commons), plus the human-in-
   *  the-loop review gate. */
  enrichment: {
    /** Master switch — when false the cron stops seeding. */
    enabled: boolean;
    /** Per-field auto-apply policy. When `true`, the worker writes the
     *  value directly to Plant; when `false`, it records an
     *  EnrichmentSuggestion the admin must approve in /admin → Review. */
    autoApply: {
      story: boolean;
      origin: boolean;
      status: boolean;
      image: boolean;
    };
    /** Days between automatic refreshes of a single plant. */
    refreshDays: number;
    /** Max plants enqueued per worker tick (rate-limit safe). */
    batchSize: number;
    /** Tick interval (cron pattern). */
    cronPattern: string;
  };
  /** QR / physical-label print knobs. Lets ops tune the printed label
   *  size for different signage formats (small herbarium tag vs. large
   *  greenhouse sign) and toggle which info appears next to the code
   *  without touching code. Surfaced via /v1/settings/public so the
   *  /[locale]/plants/[slug]/print page reads them at request time. */
  qrLabel: {
    /** Physical print size of the QR square in millimetres. */
    sizeMm: number;
    /** Label paper width / height in mm — defines the print area. */
    labelWidthMm: number;
    labelHeightMm: number;
    /** Whether to print the localised common name next to the QR. */
    showCommonName: boolean;
    /** Whether to print the Latin (scientific) name. */
    showLatin: boolean;
    /** Whether to print the IUCN Red List status badge. */
    showRedList: boolean;
    /** Whether to print the garden zone code (helps curators relabel). */
    showGardenZone: boolean;
    /** Whether to print the plant slug as a small footer (helps QA). */
    showSlug: boolean;
    /** Whether to include the kioskId tracking param in the encoded URL. */
    embedKioskId: boolean;
    /** Default kiosk label baked into the QR URL when the curator hasn't
     *  set one per-plant. Leave empty for no tag. */
    defaultKioskId: string;
  };
}

/**
 * Compute the runtime defaults for `BloomOuluSettings` from environment
 * variables. Every value here either reads `process.env.X` (set via
 * docker-compose / your hosting platform) or falls back to a sensible
 * localhost-friendly default. Admin edits via `/admin → SystemSetting`
 * always win at runtime — these are only the boot fallbacks.
 *
 * Goal: flipping to production is `.env` only. No code edits needed.
 */
function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}
function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function buildSettingsDefaults(): BloomOuluSettings {
  return {
    payments: {
      // Defaults align with docker-compose.yml + docs/ENV.md so a fresh
      // checkout has Paytrail on (card method is the dominant FI rail)
      // and MobilePay off (requires Vipps merchant KYC).
      bank_transfer: envBool('PAYMENTS_BANK_TRANSFER_ENABLED', true),
      paytrail: envBool('PAYMENTS_PAYTRAIL_ENABLED', true),
      mobilepay: envBool('PAYMENTS_MOBILEPAY_ENABLED', false),
    },
    bankTransfer: {
      iban: envStr('GARDEN_IBAN', 'FI00 0000 0000 0000 00'),
      bic: envStr('GARDEN_BIC', 'NDEAFIHH'),
      beneficiaryName: envStr(
        'GARDEN_ORG_NAME',
        'Oulun yliopiston kasvitieteellinen puutarha',
      ),
      instructionsUrl: envStr(
        'GARDEN_DONATE_URL',
        `${envStr('NEXT_PUBLIC_WEB_URL', 'http://localhost:3000')}/en/donate/pay`,
      ),
    },
    garden: {
      name: envStr('GARDEN_ORG_NAME', 'Oulun yliopiston kasvitieteellinen puutarha'),
      vatId: envStr('GARDEN_ORG_VAT_ID', 'FI02452579'),
      address: envStr(
        'GARDEN_ADDRESS',
        'Oulun yliopisto\nKasvitieteellinen puutarha\nPL 3000\n90014 Oulu',
      ),
      contactEmail: envStr('GARDEN_CONTACT_EMAIL', 'garden@bloomoulu.fi'),
    },
    vat: {
      donationRateBp: envInt('VAT_DONATION_RATE_BP', 0),
      perkRateBp: envInt('VAT_PERK_RATE_BP', 2400),
    },
    features: {
      rag: envBool('FEATURE_RAG', true),
      kiosk: envBool('FEATURE_KIOSK', true),
      corporateTier: envBool('FEATURE_CORPORATE_TIER', true),
      payByBank: envBool('FEATURE_PAY_BY_BANK', false),
    },
    receipts: {
      prefix: envStr('RECEIPT_PREFIX', 'BLO'),
      yearReset: envBool('RECEIPT_YEAR_RESET', true),
    },
    gdpr: {
      auditRetentionDays: envInt('GDPR_AUDIT_RETENTION_DAYS', 365 * 6),
      pseudonymiseAfterDays: envInt('GDPR_PSEUDONYMISE_AFTER_DAYS', 365 * 6),
      askMessageRetentionDays: envInt('GDPR_ASK_MESSAGE_RETENTION_DAYS', 365),
      analyticsRetentionDays: envInt('GDPR_ANALYTICS_RETENTION_DAYS', 90),
    },
    defaultAmountCents: envInt('KIOSK_DEFAULT_AMOUNT_CENTS', 2500),
    adoptionFlow: [
      'choose_plant',
      'choose_tier',
      'donor_details',
      'gift_options',
      'payment_method',
      'confirm',
    ],
    adoption: {
      giftWrapCents: envInt('ADOPTION_GIFT_WRAP_CENTS', 400),
      donationShareBp: envInt('ADOPTION_DONATION_SHARE_BP', 7200),
      plaqueEligibleTiers: (() => {
        const raw = process.env.ADOPTION_PLAQUE_ELIGIBLE_TIERS;
        if (!raw) return DEFAULT_PLAQUE_ELIGIBLE_TIERS;
        return raw
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is TierId => (TIER_IDS as readonly string[]).includes(s));
      })(),
      dedicationMaxChars: envInt('ADOPTION_DEDICATION_MAX_CHARS', 240),
      coAdopterMax: envInt('ADOPTION_CO_ADOPTER_MAX', 10),
      // Default offering: monthly + one_time. Annual is hidden until an
      // admin explicitly re-enables it in /admin → SystemSetting.
      intervalsEnabled: (() => {
        const raw = process.env.ADOPTION_INTERVALS_ENABLED;
        if (!raw) return DEFAULT_INTERVALS_ENABLED;
        return raw
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is BillingInterval => (BILLING_INTERVALS as readonly string[]).includes(s));
      })(),
    },
    ask: {
      curatorEmail: envStr('ASK_CURATOR_EMAIL', 'curator@bloomoulu.fi'),
      curatorName: envStr('ASK_CURATOR_NAME', 'Anna Liisa Ruotsalainen'),
      curatorReplySlaDays: envInt('ASK_CURATOR_REPLY_SLA_DAYS', 2),
      // BGE-reranker-v2-m3 emits sigmoid logits in [0, 1]. Empirically:
      //   • Exact factual match ("When does X bloom?")     → 0.90+
      //   • Listy/aggregate ("Show me carnivorous plants") → 0.15–0.25
      //     (chunks are per-plant; reranker scores them as "topical, not
      //      directly answering")
      //   • Genuinely unrelated                            → < 0.01
      // We trust the strengthened LLM refusal prompt + citation validator
      // to catch the rare false positive, so a permissive 0.10 floor lets
      // list-style and broad queries through while still blocking noise.
      confidenceThresholdBp: envInt('ASK_CONFIDENCE_THRESHOLD_BP', 1000),
      auditErrorTarget: envFloat('ASK_AUDIT_ERROR_TARGET', 0.05),
      outOfDomain: {
        bgci: envStr('ASK_OUT_OF_DOMAIN_BGCI', 'https://tools.bgci.org/plant_search.php'),
        gbif: envStr('ASK_OUT_OF_DOMAIN_GBIF', 'https://www.gbif.org/species/search'),
        plantnet: envStr('ASK_OUT_OF_DOMAIN_PLANTNET', 'https://identify.plantnet.org/'),
      },
    },
    enrichment: {
      enabled: envBool('ENRICHMENT_ENABLED', true),
      autoApply: {
        story: envBool('ENRICHMENT_AUTO_STORY', false),
        origin: envBool('ENRICHMENT_AUTO_ORIGIN', true),
        status: envBool('ENRICHMENT_AUTO_STATUS', true),
        image: envBool('ENRICHMENT_AUTO_IMAGE', false),
      },
      refreshDays: envInt('ENRICHMENT_REFRESH_DAYS', 30),
      batchSize: envInt('ENRICHMENT_BATCH_SIZE', 20),
      cronPattern: envStr('ENRICHMENT_CRON', '*/15 * * * *'),
    },
    qrLabel: {
      // Defaults match an 80×50 mm laser-printer label sheet with a
      // 35 mm QR. Admins resize in /admin → SystemSetting without
      // a redeploy.
      sizeMm: envInt('QR_LABEL_SIZE_MM', 35),
      labelWidthMm: envInt('QR_LABEL_WIDTH_MM', 80),
      labelHeightMm: envInt('QR_LABEL_HEIGHT_MM', 50),
      showCommonName: envBool('QR_LABEL_SHOW_COMMON_NAME', true),
      showLatin: envBool('QR_LABEL_SHOW_LATIN', true),
      showRedList: envBool('QR_LABEL_SHOW_RED_LIST', true),
      showGardenZone: envBool('QR_LABEL_SHOW_GARDEN_ZONE', false),
      showSlug: envBool('QR_LABEL_SHOW_SLUG', false),
      embedKioskId: envBool('QR_LABEL_EMBED_KIOSK_ID', true),
      defaultKioskId: envStr('QR_LABEL_DEFAULT_KIOSK_ID', ''),
    },
  };
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache: BloomOuluSettings = buildSettingsDefaults();
  private cacheLoadedAt = 0;

  // Late-injected so the SettingsModule itself doesn't have to import
  // EventsModule (which would risk a circular dep if Events ever depends
  // on Settings). The PubsubService is global, so we resolve it through
  // the module-ref shortcut: a setter called from main.ts at boot.
  private pubsub: { on: (ch: string, cb: (p: unknown) => void) => void } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Wire up the pub/sub listener so any admin write to SystemSetting
   *  (or any cross-process broadcast) invalidates this instance's cache
   *  immediately, not after the 60-second TTL expires. Called once from
   *  app boot. */
  attachPubsub(pubsub: { on: (ch: string, cb: (p: unknown) => void) => void }) {
    this.pubsub = pubsub;
    pubsub.on('admin.changed', () => {
      this.logger.log('admin.changed pubsub → invalidating settings cache');
      this.cacheLoadedAt = 0;
      void this.refresh();
    });
    pubsub.on('settings.updated', () => {
      this.cacheLoadedAt = 0;
      void this.refresh();
    });
  }

  async onModuleInit() {
    await this.refresh();
  }

  get(): BloomOuluSettings {
    return this.cache;
  }

  async refresh(): Promise<BloomOuluSettings> {
    // SystemSetting table has rows like { key: "payments.paytrail", value: false }.
    // We collapse into the structured object. Unknown keys are ignored.
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ key: string; value: unknown }>
      >`SELECT key, value FROM "SystemSetting"`;
      const defaults = buildSettingsDefaults();
      const merged: any = JSON.parse(JSON.stringify(defaults));
      for (const { key, value } of rows) {
        setByPath(merged, key, value);
      }
      this.cache = merged;
      this.cacheLoadedAt = Date.now();
      return this.cache;
    } catch (err) {
      // Table doesn't exist yet (first boot before migrations) → use defaults.
      this.logger.warn(
        `Settings table not available; using defaults (${(err as Error).message})`,
      );
      return buildSettingsDefaults();
    }
  }

  async update(key: string, value: unknown, actorUserId?: string) {
    await this.prisma.$executeRaw`
      INSERT INTO "SystemSetting" (key, value, updated_by, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${actorUserId ?? null}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    await this.refresh();
  }

  /** Force a reload right now, used after the pub/sub listener fires. */
  invalidate() {
    this.cacheLoadedAt = 0;
    void this.refresh();
  }
}

function setByPath(obj: any, dottedKey: string, value: unknown) {
  const parts = dottedKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]!] === undefined || typeof cur[parts[i]!] !== 'object') {
      cur[parts[i]!] = {};
    }
    cur = cur[parts[i]!];
  }
  cur[parts[parts.length - 1]!] = value;
}
