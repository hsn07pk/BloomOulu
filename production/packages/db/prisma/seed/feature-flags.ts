import type { PrismaClient } from '@prisma/client';

const FLAGS = [
  { key: 'rag',             enabled: true,  description: 'Enable AskTheGarden RAG chatbot' },
  { key: 'kiosk',           enabled: true,  description: 'Enable the in-garden kiosk routes' },
  { key: 'corporateTier',   enabled: true,  description: 'Show the Corporate adoption tier in /adopt' },
  { key: 'paymentPaytrail', enabled: false, description: 'Enable Paytrail (requires Paytrail merchant account)' },
  { key: 'paymentMobilePay', enabled: false, description: 'Enable Vipps MobilePay (requires merchant approval)' },
  { key: 'paymentBankTransfer', enabled: true, description: 'Enable manual bank transfer (zero fees, default)' },
  { key: 'memorialIntent',  enabled: true,  description: 'Allow memorial dedications' },
  { key: 'classIntent',     enabled: true,  description: 'Allow class / school adoption intent' },
  { key: 'donorWall',       enabled: true,  description: 'Display the donor wall publicly' },
  { key: 'auditViewer',     enabled: true,  description: 'Allow finance role to view audit log' },
];

const VAT = [
  { lineKind: 'donation', rateBp: 0,    description: 'Donations to a Finnish yleishyödyllinen yhteisö — outside VAT scope.' },
  { lineKind: 'perk',     rateBp: 1400, description: 'Printed perks (postcards, prints, books): reduced rate.' },
  { lineKind: 'merch',    rateBp: 2400, description: 'Standard merchandise sales.' },
  { lineKind: 'event',    rateBp: 1000, description: 'Cultural events (e.g. open-day talks).' },
];

export async function seedFlags(prisma: PrismaClient) {
  for (const f of FLAGS) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, create: f, update: f });
  }
  for (const v of VAT) {
    await prisma.vatRule.upsert({ where: { lineKind: v.lineKind }, create: v, update: v });
  }
}
