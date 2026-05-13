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
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache: BloomOuluSettings = DEFAULTS;
  private cacheLoadedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

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
