/**
 * Render a donation receipt PDF + persist + enqueue the donor email.
 *
 * Triggered after a Payment transitions to `succeeded`. Idempotent by
 * payment id: re-running produces the same receipt number + same PDF.
 */
import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { renderReceiptPdf } from '@bloomoulu/emails/pdf';
import { uploadToS3, readFile } from '../../../infra/storage.js';
import { enqueueEmail } from '../enqueue.js';
import { createHash } from 'node:crypto';

export interface ReceiptJob {
  paymentId: string;
  /** Force regeneration even if a Receipt row + blob already exist.
   *  Used by the admin "Resend receipt" action. */
  resend?: boolean;
}

export async function processReceipt(job: Job<ReceiptJob>): Promise<void> {
  const { paymentId, resend } = job.data;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      donor: { select: { id: true, email: true, name: true, locale: true, postalAddress: true } },
      // The optional directed species + the donor's public dedication are
      // the only personalisation a one-time donation receipt surfaces.
      donation: {
        include: { plant: true },
      },
    },
  });
  if (!payment) throw new Error(`No payment ${paymentId}`);
  if (payment.status !== 'succeeded') throw new Error(`Payment ${paymentId} not succeeded`);

  // Self-healing idempotency:
  //   - If a Receipt row exists AND the PDF blob is on disk AND we're not
  //     in a deliberate resend, skip the render but still re-fire the
  //     email job (the donor may have asked to resend it).
  //   - If the DB row points at a missing blob (e.g. STORAGE_DIR was
  //     wiped, or the bucket migrated), regenerate the PDF in place and
  //     keep the same receipt number.
  const existing = await prisma.receipt.findUnique({ where: { paymentId } });
  if (existing?.pdfUrl && !resend) {
    const blob = await readFile(existing.pdfUrl);
    if (blob) return; // happy path: receipt + blob both present, nothing to do.
  }

  // Allocate the gapless number AND reserve the Receipt row in ONE
  // advisory-locked transaction. Holding the lock across the COUNT + the
  // unique INSERT (to commit) means two concurrent receipt workers — the
  // queue runs concurrency 4 — can never allocate the same number. The PDF
  // is rendered after the number is reserved, then attached.
  const number = await reserveReceiptNumber(payment);

  const donation = payment.donation;
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
    plantName: donation?.plant?.nameEn ?? null,
    orderId: payment.orderId,
    dedication: donation?.dedication ?? null,
  });

  const key = `receipts/${number}.pdf`;
  const pdfUrl = await uploadToS3({ key, body: pdfBuffer, contentType: 'application/pdf' });
  const pdfSha256 = createHash('sha256').update(pdfBuffer).digest('hex');

  await prisma.receipt.update({
    where: { paymentId },
    data: { pdfUrl, pdfSha256 },
  });

  await enqueueEmail({
    template: 'receipt',
    to: payment.donor.email,
    locale: payment.donor.locale,
    variables: {
      donorName: payment.donor.name ?? 'Friend',
      amount: (payment.amountCents / 100).toFixed(2),
      plantName: payment.donation?.plant?.nameEn ?? '',
      receiptNumber: number,
      receiptUrl: pdfUrl,
    },
    attachments: [{ filename: `${number}.pdf`, url: pdfUrl }],
  });
}

/**
 * Allocate a gapless, year-prefixed receipt number and reserve the Receipt
 * row in a single advisory-locked transaction. The lock is held across the
 * COUNT and the unique INSERT (until commit), so concurrent workers serialise
 * and can never mint the same number. Idempotent: if a row already exists for
 * this payment (retry / resend / earlier PDF-render failure), its number is
 * reused and no new row is created.
 */
async function reserveReceiptNumber(payment: {
  id: string;
  donorId: string;
  amountCents: number;
  currency: string;
}): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = (await getSetting('receipts.prefix', '"BLO"')).replace(/"/g, '');
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(91824)`);
    const row = await tx.receipt.findUnique({
      where: { paymentId: payment.id },
      select: { number: true },
    });
    if (row) return row.number;
    const counted = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "Receipt" WHERE number LIKE $1`,
      `${prefix}-${year}-%`,
    );
    const n = Number(counted[0]?.count ?? 0n) + 1;
    const number = `${prefix}-${year}-${String(n).padStart(6, '0')}`;
    await tx.receipt.create({
      data: {
        number,
        kind: 'donation',
        donorId: payment.donorId,
        paymentId: payment.id,
        amountCents: payment.amountCents,
        currency: payment.currency,
        vatLineJson: [{ key: 'donation', amount: payment.amountCents, vat: 0 }] as any,
      },
    });
    return number;
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
