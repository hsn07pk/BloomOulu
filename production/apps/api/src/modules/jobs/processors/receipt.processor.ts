/**
 * Render a donation receipt PDF + persist + enqueue the donor email.
 *
 * Triggered after a Payment transitions to `succeeded`. Idempotent by
 * payment id: re-running produces the same receipt number + same PDF.
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { renderReceiptPdf } from '@bloomoulu/emails/pdf';
import { uploadToS3 } from '../../../infra/storage.js';
import { enqueueEmail } from '../enqueue.js';
import { createHash } from 'node:crypto';

export interface ReceiptJob {
  paymentId: string;
}

export async function processReceipt(job: Job<ReceiptJob>): Promise<void> {
  const { paymentId } = job.data;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      donor: { select: { id: true, email: true, name: true, locale: true, postalAddress: true } },
      adoption: { include: { plant: true, tier: true } },
    },
  });
  if (!payment) throw new Error(`No payment ${paymentId}`);
  if (payment.status !== 'succeeded') throw new Error(`Payment ${paymentId} not succeeded`);

  // Idempotency: existing receipt? return it.
  const existing = await prisma.receipt.findUnique({ where: { paymentId } });
  if (existing?.pdfUrl) return;

  const number = await nextReceiptNumber();

  const pdfBuffer = await renderReceiptPdf({
    number,
    locale: payment.donor.locale,
    donorName: payment.donor.name ?? payment.donor.email,
    donorAddress: payment.donor.postalAddress as any,
    amountCents: payment.amountCents,
    currency: payment.currency,
    vatRateBp: payment.vatRateBp,
    vatCents: payment.vatCents,
    netCents: payment.netCents,
    paidAt: payment.receivedAt ?? new Date(),
    plantName: payment.adoption?.plant?.nameEn ?? null,
    tierName: payment.adoption?.tier?.name ?? null,
    orderId: payment.orderId,
  });

  const key = `receipts/${number}.pdf`;
  const pdfUrl = await uploadToS3({ key, body: pdfBuffer, contentType: 'application/pdf' });
  const pdfSha256 = createHash('sha256').update(pdfBuffer).digest('hex');

  await prisma.receipt.upsert({
    where: { paymentId },
    create: {
      number,
      kind: 'donation',
      donorId: payment.donorId,
      paymentId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      vatLineJson: [{ key: 'donation', amount: payment.amountCents, vat: 0 }] as any,
      pdfUrl,
      pdfSha256,
    },
    update: { pdfUrl, pdfSha256 },
  });

  await enqueueEmail({
    template: 'receipt',
    to: payment.donor.email,
    locale: payment.donor.locale,
    variables: {
      donorName: payment.donor.name ?? 'Friend',
      amount: (payment.amountCents / 100).toFixed(2),
      plantName: payment.adoption?.plant?.nameEn ?? '',
      receiptNumber: number,
      receiptUrl: pdfUrl,
    },
    attachments: [{ filename: `${number}.pdf`, url: pdfUrl }],
  });
}

/**
 * Gapless, year-prefixed sequence. Uses a DB advisory lock so two workers
 * never allocate the same number.
 */
async function nextReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = (await getSetting('receipts.prefix', '"BLO"')).replace(/"/g, '');
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(91824)`);
    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "Receipt" WHERE number LIKE $1`,
      `${prefix}-${year}-%`,
    );
    const n = Number(rows[0]?.count ?? 0n) + 1;
    return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
  });
}

async function getSetting(key: string, fallback: string): Promise<string> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    return row ? JSON.stringify(row.value) : fallback;
  } catch {
    return fallback;
  }
}
