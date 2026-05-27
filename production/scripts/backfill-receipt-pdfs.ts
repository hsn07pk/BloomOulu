/**
 * One-off backfill: regenerate any Receipt PDF whose blob is missing
 * from local storage (typically because the MinIO bucket was deleted
 * during the move to local-disk storage).
 *
 * Strategy: for each Receipt row whose pdfUrl starts with `s3://` or
 * whose `local://` blob is absent on disk, re-render the PDF from the
 * linked Payment + Donor + Adoption and write it to local storage.
 * Updates pdfUrl + pdfSha256 in the DB. Idempotent; safe to re-run.
 */
import { prisma } from '@bloomoulu/db';
import { renderReceiptPdf } from '@bloomoulu/emails/pdf';
import { uploadToS3, readFile } from '../apps/api/src/infra/storage.js';
import { createHash } from 'node:crypto';

async function main() {
  const rows = await prisma.receipt.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      payment: {
        include: {
          donor: { select: { id: true, email: true, name: true, locale: true, postalAddress: true } },
          adoption: { include: { plant: true, tier: true } },
        },
      },
    },
  });

  let regenerated = 0;
  let skipped = 0;

  for (const r of rows) {
    const ref = r.pdfUrl ?? '';
    const blob = ref ? await readFile(ref) : null;
    if (blob) {
      skipped++;
      console.log(`  skip ${r.number} — already present on disk`);
      continue;
    }

    if (!r.payment) {
      console.warn(`  warn ${r.number} — no linked payment, cannot regenerate`);
      continue;
    }
    const p = r.payment;
    const pdfBuffer = await renderReceiptPdf({
      number: r.number,
      locale: p.donor.locale,
      donorName: p.donor.name ?? p.donor.email,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      donorAddress: p.donor.postalAddress as any,
      amountCents: p.amountCents,
      currency: p.currency,
      vatRateBp: p.vatRateBp,
      vatCents: p.vatCents,
      netCents: p.netCents,
      paidAt: p.receivedAt ?? r.createdAt,
      plantName: p.adoption?.plant?.nameEn ?? null,
      tierName: p.adoption?.tier?.name ?? null,
      orderId: p.orderId,
    });

    const key = `receipts/${r.number}.pdf`;
    const pdfUrl = await uploadToS3({ key, body: pdfBuffer, contentType: 'application/pdf' });
    const pdfSha256 = createHash('sha256').update(pdfBuffer).digest('hex');

    await prisma.receipt.update({
      where: { id: r.id },
      data: { pdfUrl, pdfSha256 },
    });
    regenerated++;
    console.log(`  ok   ${r.number} → ${pdfUrl} (${pdfBuffer.length} bytes)`);
  }

  console.log(`\nDone. Regenerated ${regenerated}, skipped ${skipped} of ${rows.length} receipts.`);
}

main()
  .catch((err) => {
    console.error('backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
