/**
 * End-to-end test: regenerate the CSV + PDF for the latest Disbursement
 * draft and write them to /tmp so we can inspect the output without
 * authenticating against the api.
 */
import { prisma } from '@bloomoulu/db';
import { renderDisbursementPdf } from '@bloomoulu/emails/pdf/disbursement';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

async function main() {
  const d = await prisma.disbursement.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      entries: {
        include: {
          payment: {
            include: {
              donor: { select: { email: true, name: true } },
              adoption: { include: { plant: { select: { nameEn: true, slug: true } } } },
            },
          },
        },
      },
    },
  });
  if (!d) {
    console.error('No disbursement found. Create one in admin first.');
    process.exit(1);
  }
  console.log(`Latest disbursement: ${d.reference} (${d.status})`);
  console.log(`  ${d.entries.length} entries, gross €${(d.expectedCents / 100).toFixed(2)}, net €${(d.netCents / 100).toFixed(2)}`);

  // Compute a fake CSV hash (the real path runs csvService.exportCsv first
  // and uses that sha; here we're just smoke-testing the PDF renderer).
  const fakeCsv = `reference,${d.reference}\nperiodStart,${d.periodStart.toISOString().slice(0, 10)}\nperiodEnd,${d.periodEnd.toISOString().slice(0, 10)}\n`;
  const sha = createHash('sha256').update(fakeCsv).digest('hex');

  const pdf = await renderDisbursementPdf({
    reference: d.reference,
    locale: 'en',
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    status: d.status,
    expectedCents: d.expectedCents,
    feeCents: d.feeCents,
    netCents: d.netCents,
    currency: d.currency,
    csvSha256: sha,
    issuedAt: new Date(),
    entries: d.entries
      .filter((e) => e.included)
      .map((e) => ({
        donorEmail: e.payment.donor.email,
        donorName: e.payment.donor.name,
        provider: e.payment.provider,
        paidAt: e.payment.receivedAt,
        amountCents: e.amountCents,
        feeCents: e.feeCents,
        netCents: e.netCents,
        plantName: e.payment.adoption?.plant?.nameEn ?? null,
      })),
  });

  const outPath = `/tmp/${d.reference}.pdf`;
  await writeFile(outPath, pdf);
  console.log(`PDF written to ${outPath} (${pdf.length} bytes)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
