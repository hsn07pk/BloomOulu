/**
 * CSR quarterly impact report sweep.
 *
 * Fires monthly. Picks every active Corporate-intent adoption whose CSR
 * benefit row has nextDueAt <= now (or is still pending its first send),
 * builds a per-adoption impact PDF, stores it in local storage, and
 * enqueues an email to the corporate donor.
 *
 * Idempotent: each iteration advances the benefit row's lastSentAt +
 * nextDueAt past `now`, so re-runs within the same quarter are no-ops.
 */
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { prisma } from '@bloomoulu/db';
import { uploadToS3 } from '../../../infra/storage.js';
import { enqueueEmail } from '../enqueue.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let renderCsrPdf: any = null;

const logger = new Logger('CsrQuarterly');

export async function processCsrQuarterly(_job: Job): Promise<{ swept: number; sent: number }> {
  if (!renderCsrPdf) {
    const mod = await import('@bloomoulu/emails/pdf/csr-quarterly');
    renderCsrPdf = mod.renderCsrQuarterlyPdf;
  }
  const now = new Date();
  const due = await prisma.adoptionBenefit.findMany({
    where: {
      benefitKey: 'digital.csr_quarterly_report',
      adoption: { status: 'active', intent: 'corporate' },
      OR: [
        { nextDueAt: { lte: now } },
        { nextDueAt: null, lastSentAt: null },
      ],
      status: { notIn: ['cancelled', 'not_applicable'] },
    },
    include: {
      adoption: {
        include: {
          donor: { select: { email: true, name: true, locale: true } },
          plant: { select: { nameEn: true, slug: true } },
          tier: { select: { name: true } },
        },
      },
    },
    take: 50,
  });

  let sent = 0;
  for (const b of due) {
    const a = b.adoption;
    const quarterEnd = new Date(now);
    const quarterStart = new Date(now);
    quarterStart.setUTCMonth(quarterStart.getUTCMonth() - 3);

    // Aggregate funded amount in this quarter for this corporate donor.
    const agg = await prisma.payment.aggregate({
      where: {
        donorId: a.donorId,
        status: 'succeeded',
        receivedAt: { gte: quarterStart, lte: quarterEnd },
      },
      _sum: { amountCents: true },
      _count: { id: true },
    });
    const fundedCents = agg._sum.amountCents ?? 0;
    const paymentCount = agg._count.id ?? 0;

    const pdfBuffer = await renderCsrPdf({
      locale: (a.donor.locale as 'en' | 'fi' | 'sv') ?? 'en',
      donorName: a.donor.name ?? a.donor.email,
      plantName: a.plant.nameEn,
      tierName: a.tier.name,
      quarterStart,
      quarterEnd,
      fundedCents,
      paymentCount,
      issuedAt: now,
    });

    const key = `csr-reports/${a.id}/${now.toISOString().slice(0, 7)}.pdf`;
    const pdfUrl = await uploadToS3({
      key,
      body: pdfBuffer,
      contentType: 'application/pdf',
    });

    await enqueueEmail({
      template: 'csr-quarterly-report',
      to: a.donor.email,
      locale: (a.donor.locale as 'en' | 'fi' | 'sv') ?? 'en',
      variables: {
        donorName: a.donor.name ?? '',
        plantName: a.plant.nameEn,
        quarterLabel: `${quarterStart.toISOString().slice(0, 7)} – ${quarterEnd.toISOString().slice(0, 7)}`,
        amount: (fundedCents / 100).toFixed(2),
        url: pdfUrl,
      },
      attachments: [{ filename: `csr-${now.toISOString().slice(0, 7)}.pdf`, url: pdfUrl }],
    });

    const next = new Date(now);
    next.setUTCMonth(next.getUTCMonth() + 3);
    await prisma.adoptionBenefit.update({
      where: { id: b.id },
      data: { lastSentAt: now, nextDueAt: next, status: 'fulfilled', fulfilledAt: now },
    });
    sent++;
  }
  logger.log(`CSR quarterly sweep: ${due.length} due, ${sent} sent`);
  return { swept: due.length, sent };
}
