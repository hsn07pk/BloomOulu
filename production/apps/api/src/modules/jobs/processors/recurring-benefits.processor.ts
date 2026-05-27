/**
 * Recurring benefits sweep.
 *
 * Cron: daily 06:00 UTC. Scans `AdoptionBenefit` rows where
 *   - `category` ∈ {recurring}
 *   - the parent Adoption is still active
 *   - `nextDueAt` is in the past
 *   - `status` is anything except `cancelled` (resend is OK for fulfilled
 *     items — that's the whole point of a recurring schedule).
 *
 * For each due row we:
 *   1. Pick the right email template from `benefitKey` (every recurring
 *      benefit has a dedicated template seed; see packages/emails/templates/seed.ts)
 *   2. Enqueue an `email` job with donor name + plant name + amount
 *      personalisation
 *   3. Stamp `lastSentAt = now`
 *   4. Bump `nextDueAt = now + cadenceMonths` (cadence from the catalog)
 *
 * Idempotent within a single firing — the SQL filter excludes anything
 * not actually due. Idempotent across runs — each iteration advances
 * nextDueAt past `now`.
 */
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { prisma } from '@bloomoulu/db';
import { benefitsForTier } from '@bloomoulu/constants';
import { enqueueEmail } from '../enqueue.js';

const logger = new Logger('RecurringBenefits');

/** Maps every recurring benefitKey to its email-template slug. */
const TEMPLATE_BY_KEY: Record<string, string> = {
  'recurring.quarterly_notes': 'quarterly-notes',
  'recurring.seasonal_photos': 'seasonal-photos',
  'recurring.annual_seed_packet': 'annual-seed-packet',
  'digital.csr_quarterly_report': 'csr-quarterly-report',
};

export async function processRecurringBenefits(_job: Job): Promise<{
  swept: number;
  sent: number;
  skipped: number;
}> {
  const now = new Date();
  const due = await prisma.adoptionBenefit.findMany({
    where: {
      category: 'recurring',
      nextDueAt: { not: null, lte: now },
      status: { notIn: ['cancelled', 'not_applicable'] },
      adoption: { status: 'active' },
    },
    include: {
      adoption: {
        include: {
          donor: { select: { id: true, email: true, name: true, locale: true } },
          plant: { select: { nameEn: true, nameFi: true, nameSv: true, slug: true } },
          tier: { select: { id: true, name: true } },
        },
      },
    },
    take: 200, // bounded sweep per tick
  });

  let sent = 0;
  let skipped = 0;
  for (const b of due) {
    const template = TEMPLATE_BY_KEY[b.benefitKey];
    if (!template) {
      logger.warn(`No template for recurring benefitKey=${b.benefitKey}; skipping`);
      skipped++;
      continue;
    }
    // Look up cadence from the catalog so a future tier change in the
    // catalog (3-month → monthly) takes effect on the next sweep.
    const catalog = benefitsForTier(b.adoption.tier.id);
    const def = catalog.find((c) => c.key === b.benefitKey);
    const cadence = def?.cadenceMonths ?? 3;
    const next = new Date(now);
    next.setUTCMonth(next.getUTCMonth() + cadence);

    const donor = b.adoption.donor;
    await enqueueEmail({
      template,
      to: donor.email,
      locale: (donor.locale as 'en' | 'fi' | 'sv') ?? 'en',
      variables: {
        donorName: donor.name ?? '',
        plantName: b.adoption.plant.nameEn,
        plantSlug: b.adoption.plant.slug,
        tierName: b.adoption.tier.name,
        amount: (b.adoption.amountCents / 100).toFixed(2),
        nextDate: next.toISOString().slice(0, 10),
      },
    });
    await prisma.adoptionBenefit.update({
      where: { id: b.id },
      data: {
        status: 'fulfilled',
        lastSentAt: now,
        nextDueAt: next,
        fulfilledAt: now,
      },
    });
    sent++;
  }
  logger.log(`Swept ${due.length} due, sent ${sent}, skipped ${skipped}`);
  return { swept: due.length, sent, skipped };
}
