/**
 * Annual tax certificate sweep.
 *
 * Cron Jan 5 04:00 UTC (after the final December reconciliations have
 * settled). For each donor with succeeded donations in the previous tax
 * year:
 *
 *   - Corporate donor (any adoption with intent='corporate') AND
 *     total ≥ €850 (current 2026 TVL §57 minimum): issue a TVL §57
 *     certificate; deduction capped at €250,000/year.
 *
 *   - Individual donor (intent ∈ {for_self, gift, memorial, class}) AND
 *     total meets the 2026 individual-donor scheme threshold: issue an
 *     informational certificate. Until Vero finalises the exact wording
 *     (deduction caps, minimum threshold), the certificate carries an
 *     "INFORMATIONAL ONLY — final scheme parameters pending" banner.
 *
 *   - Below the threshold: no certificate issued.
 *
 * Idempotent: TaxCertificate has a UNIQUE (donorId, taxYear) constraint —
 * re-running the sweep is a no-op once certificates exist.
 *
 *   pnpm run job:tax-cert-annual --year 2026   # manual ad-hoc invocation
 */
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { prisma } from '@bloomoulu/db';
import { renderTaxCertificatePdf } from '@bloomoulu/emails/pdf/tax-certificate';
import { uploadToS3 } from '../../../infra/storage.js';
import { enqueueEmail } from '../enqueue.js';

const logger = new Logger('TaxCertAnnual');

const TVL_57_MIN_CENTS = 850_00; // TVL §57 minimum: €850
const INDIVIDUAL_MIN_CENTS = 500_00; // placeholder threshold; tune when finalised

export interface TaxCertAnnualJob {
  /** Tax year to sweep — defaults to (UTC now).year - 1 (i.e. previous year). */
  taxYear?: number;
  /** Optional: just one donor. Useful for back-fills + tests. */
  donorId?: string;
}

export async function processTaxCertAnnual(job: Job<TaxCertAnnualJob>) {
  const taxYear = job.data.taxYear ?? new Date().getUTCFullYear() - 1;
  const donorIdFilter = job.data.donorId;

  // Window: [Jan 1 00:00 UTC, Jan 1 00:00 UTC next year)
  const yearStart = new Date(Date.UTC(taxYear, 0, 1));
  const yearEnd = new Date(Date.UTC(taxYear + 1, 0, 1));

  // Aggregate succeeded payments per donor in the tax year.
  // Group + sum at the DB so we don't pull every Payment row into memory.
  const rows = await prisma.payment.groupBy({
    by: ['donorId'],
    where: {
      status: 'succeeded',
      receivedAt: { gte: yearStart, lt: yearEnd },
      ...(donorIdFilter ? { donorId: donorIdFilter } : {}),
    },
    _sum: { amountCents: true },
    _count: { id: true },
  });

  let issued = 0;
  let skipped = 0;
  for (const r of rows) {
    const total = r._sum.amountCents ?? 0;
    const intent = await dominantIntent(r.donorId, yearStart, yearEnd);
    const scheme: 'TVL §57 corporate' | 'individual 2026' | 'informational' =
      intent === 'corporate' && total >= TVL_57_MIN_CENTS
        ? 'TVL §57 corporate'
        : total >= INDIVIDUAL_MIN_CENTS
          ? 'individual 2026'
          : 'informational';

    if (scheme === 'informational' && total < INDIVIDUAL_MIN_CENTS) {
      // Below any threshold — skip; previous receipts already cover the donation.
      skipped++;
      continue;
    }

    // Idempotency: bail if a certificate for (donor, taxYear) already exists
    // with a non-null pdfUrl.
    const existing = await prisma.taxCertificate.findUnique({
      where: { donorId_taxYear: { donorId: r.donorId, taxYear } },
    });
    if (existing?.pdfUrl) {
      skipped++;
      continue;
    }

    const donor = await prisma.user.findUnique({ where: { id: r.donorId } });
    if (!donor) {
      logger.warn(`Donor ${r.donorId} missing — skip`);
      continue;
    }

    const receipts = await prisma.receipt.findMany({
      where: { donorId: r.donorId, issuedAt: { gte: yearStart, lt: yearEnd } },
      orderBy: { issuedAt: 'asc' },
      select: { number: true },
    });

    const certificateNumber = `CERT-${taxYear}-${r.donorId.slice(0, 8).toUpperCase()}`;
    const pdf = await renderTaxCertificatePdf({
      certificateNumber,
      locale: donor.locale,
      donorName: donor.name ?? donor.email,
      donorAddress: (donor.postalAddress as any) ?? null,
      scheme,
      taxYear,
      totalCents: total,
      currency: 'EUR',
      receiptNumbers: receipts.map((rc) => rc.number),
      issuedAt: new Date(),
    });

    const key = `tax-certs/${taxYear}/${certificateNumber}.pdf`;
    const pdfUrl = await uploadToS3({ key, body: pdf, contentType: 'application/pdf' });
    const pdfSha256 = createHash('sha256').update(pdf).digest('hex');

    await prisma.taxCertificate.upsert({
      where: { donorId_taxYear: { donorId: r.donorId, taxYear } },
      create: {
        donorId: r.donorId,
        taxYear,
        totalCents: total,
        scheme,
        pdfUrl,
      },
      update: { pdfUrl, totalCents: total, scheme },
    });

    await enqueueEmail({
      template: 'annual-tax-cert',
      to: donor.email,
      locale: donor.locale,
      variables: {
        donorName: donor.name ?? '',
        taxYear: String(taxYear),
        total: (total / 100).toFixed(2),
        url: pdfUrl,
      },
      attachments: [{ filename: `${certificateNumber}.pdf`, url: pdfUrl }],
    });

    // The sha256 lives only in our records for now (no schema field on
    // TaxCertificate). Log it so the audit trail captures it.
    logger.log(`Issued ${certificateNumber} (${scheme}, €${(total / 100).toFixed(2)}, sha256=${pdfSha256.slice(0, 16)}…)`);
    issued++;
  }

  return { taxYear, issued, skipped, candidates: rows.length };
}

/**
 * Determine the donor's "primary" intent for the tax year. If they had any
 * corporate-intent adoption that produced a succeeded payment in the year,
 * we treat the whole year as corporate (TVL §57 is by donor entity, not by
 * donation — once the donor opted in as a company, all their donations sit
 * under the corporate scheme).
 */
async function dominantIntent(
  donorId: string,
  yearStart: Date,
  yearEnd: Date,
): Promise<'for_self' | 'gift' | 'memorial' | 'class' | 'corporate'> {
  const corp = await prisma.adoption.count({
    where: {
      donorId,
      intent: 'corporate',
      payments: { some: { status: 'succeeded', receivedAt: { gte: yearStart, lt: yearEnd } } },
    },
  });
  return corp > 0 ? 'corporate' : 'for_self';
}
