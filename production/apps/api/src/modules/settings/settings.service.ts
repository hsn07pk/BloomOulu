import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
    plaqueEligibleTiers: Array<'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate'>;
    /** Max length of the donor-facing dedication string. */
    dedicationMaxChars: number;
    /** Max co-adopters per adoption. */
    coAdopterMax: number;
    /** Link target shown next to the tax-disclosure box. */
    fundsFlowUrl: string;
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
}

const DEFAULTS: BloomOuluSettings = {
  payments: { bank_transfer: true, paytrail: false, mobilepay: true },
  bankTransfer: {
    iban: 'FI00 0000 0000 0000 00',
    bic: 'NDEAFIHH',
    beneficiaryName: 'Oulun yliopiston kasvitieteellinen puutarha',
    instructionsUrl: 'https://bloomoulu.fi/donate/pay',
  },
  vat: { donationRateBp: 0, perkRateBp: 2400 },
  features: { rag: true, kiosk: true, corporateTier: true, payByBank: false },
  receipts: { prefix: 'BLO', yearReset: true },
  gdpr: { auditRetentionDays: 365 * 6, pseudonymiseAfterDays: 365 * 6 },
  defaultAmountCents: 2500,
  adoptionFlow: [
    'choose_plant',
    'choose_tier',
    'donor_details',
    'gift_options',
    'payment_method',
    'confirm',
  ],
  adoption: {
    giftWrapCents: 400,
    donationShareBp: 7200,
    plaqueEligibleTiers: ['endangered', 'corporate'],
    dedicationMaxChars: 240,
    coAdopterMax: 10,
    fundsFlowUrl: '/about#funds-flow',
  },
  ask: {
    curatorEmail: 'curator@bloomoulu.fi',
    curatorName: 'Anna Liisa Ruotsalainen',
    curatorReplySlaDays: 2,
    // BGE-reranker-v2-m3 emits sigmoid logits in [0, 1]. Empirically:
    //   • Exact factual match ("When does X bloom?")     → 0.90+
    //   • Listy/aggregate ("Show me carnivorous plants") → 0.15–0.25
    //     (chunks are per-plant; reranker scores them as "topical, not
    //      directly answering")
    //   • Genuinely unrelated                            → < 0.01
    // We trust the strengthened LLM refusal prompt + citation validator
    // to catch the rare false positive, so a permissive 0.10 floor lets
    // list-style and broad queries through while still blocking noise.
    confidenceThresholdBp: 1000,
    auditErrorTarget: 0.05,
    outOfDomain: {
      bgci: 'https://tools.bgci.org/plant_search.php',
      gbif: 'https://www.gbif.org/species/search',
      plantnet: 'https://identify.plantnet.org/',
    },
  },
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache: BloomOuluSettings = DEFAULTS;
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
      const merged: any = JSON.parse(JSON.stringify(DEFAULTS));
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
      return DEFAULTS;
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
