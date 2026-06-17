/**
 * Annual tax certificate sweep.
 *
 * Cron Jan 5 04:00 UTC (after the final December reconciliations have
 * settled). For each donor whose settled donations in the previous tax year
 * total at least the minimum threshold, issue a single informational
 * donation summary. The exact Finnish individual-donor deduction scheme is
 * still being finalised, so the certificate carries an "INFORMATIONAL ONLY"
 * banner and there is no tier / corporate branching.
 *
 *   - Below the threshold: no certificate issued (the per-gift receipts
 *     already cover those donations).
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
    // Single informational donation summary — no tier / corporate branching.
    const scheme = 'informational' as const;

    if (total < INDIVIDUAL_MIN_CENTS) {
      // Below the threshold — skip; the per-gift receipts already cover these.
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
