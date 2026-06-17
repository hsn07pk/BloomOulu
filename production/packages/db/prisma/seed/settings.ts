import type { PrismaClient } from '@prisma/client';

/**
 * Default values for every admin-editable system setting. Curators / finance /
 * admins flip these from `/admin/pages/settings`; we only seed defaults so the
 * first boot has working values. Re-running the seed never overwrites an
 * operator's change (we use `where: { key }` + `create` only — no `update`).
 *
 * Schema source of truth: SystemSetting model in `schema.prisma` (columns
 * `key`, `value`, `description`, `category`, `type`, `updatedByUserId`,
 * `updatedAt`).
 */
type Setting = {
  key: string;
  value: unknown;
  description: string;
  category: string;
  type: 'boolean' | 'number' | 'string' | 'iban' | 'json';
};

const DEFAULTS: Setting[] = [
  // ── Payments ──────────────────────────────────────────────────────────────
  {
    key: 'payments.bank_transfer',
    value: true,
    description: 'Bank-transfer rail enabled (zero-fee default).',
    category: 'payments',
    type: 'boolean',
  },
  {
    key: 'payments.paytrail',
    value: false,
    description: 'Paytrail rail enabled. Requires PAYTRAIL_* env vars.',
    category: 'payments',
    type: 'boolean',
  },
  {
    key: 'payments.mobilepay',
    value: false,
    description: 'Vipps MobilePay recurring rail enabled. Requires MOBILEPAY_* env vars.',
    category: 'payments',
    type: 'boolean',
  },

  // ── Bank transfer beneficiary (REPLACE BEFORE LAUNCH) ────────────────────
  {
    key: 'bankTransfer.iban',
    value: 'FI00 0000 0000 0000 00',
    description: "Garden's IBAN. Replace with the real Garden account before going live.",
    category: 'payments',
    type: 'iban',
  },
  {
    key: 'bankTransfer.bic',
    value: 'NDEAFIHH',
    description: "Garden's BIC. Verify with the Garden's bank.",
    category: 'payments',
    type: 'string',
  },
  {
    key: 'bankTransfer.beneficiaryName',
    value: 'Oulun yliopiston kasvitieteellinen puutarha',
    description: 'Beneficiary name shown in the donor banking app.',
    category: 'payments',
    type: 'string',
  },
  {
    key: 'bankTransfer.instructionsUrl',
    value: 'https://bloomoulu.fi/donate/pay',
    description: 'Public URL where the donor sees IBAN+RF+QR after starting an adoption.',
    category: 'payments',
    type: 'string',
  },

  // ── VAT ───────────────────────────────────────────────────────────────────
  {
    key: 'vat.donationRateBp',
    value: 0,
    description: 'VAT rate (basis points) for the donation line. 0 = non-profit exempt.',
    category: 'vat',
    type: 'number',
  },
  {
    key: 'vat.perkRateBp',
    value: 2400,
    description: 'VAT rate (bp) on perk fair-value share. 2400 = Finland general rate.',
    category: 'vat',
    type: 'number',
  },

  // ── Feature flags ─────────────────────────────────────────────────────────
  {
    key: 'features.rag',
    value: true,
    description: 'AskTheGarden RAG chat available on the public site.',
    category: 'features',
    type: 'boolean',
  },
  {
    key: 'features.kiosk',
    value: true,
    description: 'Kiosk fleet (greenhouse displays) enabled.',
    category: 'features',
    type: 'boolean',
  },
  {
    key: 'features.corporateTier',
    value: true,
    description: 'Corporate tier (TVL §57) visible in the tier ladder.',
    category: 'features',
    type: 'boolean',
  },
  {
    key: 'features.payByBank',
    value: false,
    description: 'Pay-by-Bank inside Paytrail. Off until the Garden enables it.',
    category: 'features',
    type: 'boolean',
  },

  // ── Receipts ──────────────────────────────────────────────────────────────
  {
    key: 'receipts.prefix',
    value: 'BLO',
    description: 'Receipt number prefix. Final form: <prefix>-<year>-<6-digit>.',
    category: 'receipts',
    type: 'string',
  },
  {
    key: 'receipts.yearReset',
    value: true,
    description: 'If true, receipt counter resets to 1 each calendar year.',
    category: 'receipts',
    type: 'boolean',
  },
  {
    key: 'receipts.counter',
    value: { year: new Date().getUTCFullYear(), next: 1 },
    description: 'Internal counter for the gapless receipt number. Edit with care.',
    category: 'receipts',
    type: 'json',
  },

  // ── GDPR ──────────────────────────────────────────────────────────────────
  {
    key: 'gdpr.auditRetentionDays',
    value: 2190,
    description: 'AuditLog retention. 6 years per Finnish accounting law.',
    category: 'gdpr',
    type: 'number',
  },
  {
    key: 'gdpr.pseudonymiseAfterDays',
    value: 2190,
    description: 'Days after the last donation before pseudonymisation kicks in.',
    category: 'gdpr',
    type: 'number',
  },

  // ── Donation flow (read by /v1/settings/public) ──────────────────────────
  {
    key: 'donation.suggestedAmountsCents',
    value: [500, 1500, 2500, 5000],
    description: 'Quick-pick donation amounts (cents) shown as chips on the donate form. Donors can also enter a custom amount.',
    category: 'donations',
    type: 'json',
  },
  {
    key: 'donation.defaultAmountCents',
    value: 2500,
    description: 'Amount preselected when the donate form / kiosk first paints.',
    category: 'donations',
    type: 'number',
  },
  {
    key: 'donation.allowCustomAmount',
    value: true,
    description: 'Whether donors may type a free amount in addition to the suggested chips.',
    category: 'donations',
    type: 'boolean',
  },
  {
    key: 'donation.minCents',
    value: 100,
    description: 'Minimum self-serve donation in cents (provider floor). €1 = 100.',
    category: 'donations',
    type: 'number',
  },
  {
    key: 'donation.maxCents',
    value: 1000000,
    description: 'Maximum self-serve donation in cents; larger gifts are routed to a human. €10,000 = 1000000.',
    category: 'donations',
    type: 'number',
  },
  {
    key: 'donation.dedicationMaxChars',
    value: 240,
    description: 'Hard limit on the public dedication / tribute text. Matches the Donation.dedication column.',
    category: 'donations',
    type: 'number',
  },
  {
    key: 'donation.fundsFlowUrl',
    value: '/about#funds-flow',
    description: 'Where the "Read where your gift goes" link points. Locale-relative.',
    category: 'donations',
    type: 'string',
  },

  // ── AskTheGarden knobs (read by /v1/settings/public + ask.service) ────────
  {
    key: 'ask.curatorEmail',
    value: 'curator@bloomoulu.fi',
    description: 'Inbox where escalated questions land. Change when the Garden\'s curator handover lands.',
    category: 'ask',
    type: 'string',
  },
  {
    key: 'ask.curatorName',
    value: 'Anna Liisa Ruotsalainen',
    description: 'Curator name shown in the donor-facing footer ("Curator typically replies within X days").',
    category: 'ask',
    type: 'string',
  },
  {
    key: 'ask.curatorReplySlaDays',
    value: 2,
    description: 'Working-day SLA we promise donors after an escalation.',
    category: 'ask',
    type: 'number',
  },
  {
    key: 'ask.confidenceThresholdBp',
    value: 7200,
    description: 'Minimum re-ranker score (basis points) needed to call the LLM. Below this we escalate. Default 7200 = 0.72 cosine similarity (ADR-0005).',
    category: 'ask',
    type: 'number',
  },
  {
    key: 'ask.auditErrorTarget',
    value: 0.05,
    description: 'Audit-error-rate target shown on the right rail. 0.05 = 5% — anything above prompts a curator re-audit.',
    category: 'ask',
    type: 'number',
  },
  {
    key: 'ask.outOfDomain',
    value: {
      bgci: 'https://tools.bgci.org/plant_search.php',
      gbif: 'https://www.gbif.org/species/search',
      plantnet: 'https://identify.plantnet.org/',
    },
    description: 'External services we link to when a question is out-of-domain.',
    category: 'ask',
    type: 'json',
  },
  {
    key: 'ask.staffStarters',
    value: {
      en: [
        'Draft school-tour script for upper grade (Saxifraga hirculus)',
        'Generate signage text — Trollius europaeus (FI/SV/EN)',
        "Summarise this quarter's gardener notes",
        'Find a Kone Foundation grant template',
        'Identify a herbarium sample (image upload)',
      ],
      fi: [
        'Luo opastusrunko yläkoululaisille (Saxifraga hirculus)',
        'Tuota opastetekstin (FI/SV/EN) Trollius europaeus -lajille',
        'Tee yhteenveto tämän vuosineljänneksen puutarhurin muistiinpanoista',
        'Etsi Kone-säätiön apurahapohja',
        'Tunnista herbaarionäyte (kuvalataus)',
      ],
      sv: [
        'Skapa skolturmanus för högstadiet (Saxifraga hirculus)',
        'Generera skyltningstext — Trollius europaeus (FI/SV/EN)',
        'Sammanfatta detta kvartals trädgårdsmästares anteckningar',
        'Hitta en Kone-stiftelsen-bidragsmall',
        'Identifiera ett herbarium-prov (bilduppladdning)',
      ],
    },
    description: 'Quick-start prompts shown to staff in the Ask sidebar. Edit per locale.',
    category: 'ask',
    type: 'json',
  },
];

export async function seedSettings(prisma: PrismaClient) {
  for (const s of DEFAULTS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      // Only set description / category / type on first insert; never overwrite
      // an operator-edited value on re-seed.
      create: {
        key: s.key,
        value: s.value as any,
        description: s.description,
        category: s.category,
        type: s.type,
      },
      update: {},
    });
  }
}
