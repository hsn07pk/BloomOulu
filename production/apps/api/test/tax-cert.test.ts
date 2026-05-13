/**
 * Annual tax certificate sweep — integration test.
 *
 * Builds a donor with succeeded payments crossing the TVL §57 threshold,
 * runs the processor, asserts that a TaxCertificate row is created with the
 * right scheme + total. Validates idempotency by re-running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

// We don't want the test to hit MinIO + SMTP — mock the storage upload and
// the email enqueue. The PDF still renders end-to-end via react-pdf.
const uploads: Array<{ key: string; size: number; contentType: string }> = [];
const emails: Array<{ template: string; to: string }> = [];
vi.mock('../src/infra/storage.js', () => ({
  uploadToS3: vi.fn(async (input: { key: string; body: Buffer; contentType: string }) => {
    uploads.push({ key: input.key, size: input.body.length, contentType: input.contentType });
    return `s3://bloomoulu-assets/${input.key}`;
  }),
  presign: vi.fn(async (url: string) => url),
}));
vi.mock('../src/modules/jobs/enqueue.js', () => ({
  enqueueEmail: vi.fn(async (data: any) => {
    emails.push(data);
  }),
  enqueuePaymentRetry: vi.fn(async () => {}),
  enqueueReceipt: vi.fn(async () => {}),
}));

const prisma = new PrismaClient();
let donorId: string;
let plantId: string;
const TAX_YEAR = 2025;

beforeAll(async () => {
  await prisma.$connect();
  const donor = await prisma.user.create({
    data: {
      email: `taxcert-${uuidv7()}@bloomoulu.test`,
      name: 'Corporate Donor Oy',
      locale: 'fi',
      postalAddress: { line1: 'Tehtaankatu 12', postalCode: '00120', city: 'Helsinki', country: 'FI' },
    },
  });
  donorId = donor.id;
  const plant = await prisma.plant.findFirst({ where: { status: 'active' } });
  if (!plant) throw new Error('Test requires a seeded plant');
  plantId = plant.id;
});

afterAll(async () => {
  await prisma.taxCertificate.deleteMany({ where: { donorId } });
  await prisma.payment.deleteMany({ where: { donorId } });
  await prisma.receipt.deleteMany({ where: { donorId } });
  await prisma.adoption.deleteMany({ where: { donorId } });
  await prisma.user.deleteMany({ where: { id: donorId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  uploads.length = 0;
  emails.length = 0;
  await prisma.taxCertificate.deleteMany({ where: { donorId } });
  await prisma.payment.deleteMany({ where: { donorId } });
  await prisma.receipt.deleteMany({ where: { donorId } });
  await prisma.adoption.deleteMany({ where: { donorId } });
});

async function makeCorporateAdoption(amountCents: number, paidAt: Date) {
  const adoption = await prisma.adoption.create({
    data: {
      donorId,
      plantId,
      tierId: 'corporate',
      status: 'active',
      intent: 'corporate',
      recurring: false,
      billingInterval: 'one_time',
      amountCents,
      startedAt: paidAt,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: uuidv7(),
      donorId,
      adoptionId: adoption.id,
      provider: 'paytrail',
      amountCents,
      netCents: amountCents,
      currency: 'EUR',
      status: 'succeeded',
      receivedAt: paidAt,
    },
  });
  // Mirror what the receipt processor would normally produce.
  await prisma.receipt.create({
    data: {
      number: `BLO-${TAX_YEAR}-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
      kind: 'donation',
      donorId,
      paymentId: payment.id,
      amountCents,
      currency: 'EUR',
      vatLineJson: [{ key: 'donation', amount: amountCents, vat: 0 }] as any,
      issuedAt: paidAt,
    },
  });
  return adoption;
}

describe('annual tax certificate sweep', () => {
  it('issues a TVL §57 certificate for a corporate donor over €850 / year', async () => {
    await makeCorporateAdoption(60_000, new Date(Date.UTC(TAX_YEAR, 5, 1)));   // €600
    await makeCorporateAdoption(40_000, new Date(Date.UTC(TAX_YEAR, 9, 1)));   // €400, total €1000

    const { processTaxCertAnnual } = await import(
      '../src/modules/jobs/processors/tax-cert-annual.processor.js'
    );
    const result = await processTaxCertAnnual({
      data: { taxYear: TAX_YEAR, donorId },
    } as any);

    expect(result).toMatchObject({ taxYear: TAX_YEAR, issued: 1, skipped: 0 });
    const cert = await prisma.taxCertificate.findUnique({
      where: { donorId_taxYear: { donorId, taxYear: TAX_YEAR } },
    });
    expect(cert?.totalCents).toBe(100_000);
    expect(cert?.scheme).toBe('TVL §57 corporate');
    expect(cert?.pdfUrl).toMatch(/^s3:\/\/bloomoulu-assets\/tax-certs\//);
    expect(uploads[0]!.size).toBeGreaterThan(1000); // a real PDF, not empty
    expect(emails[0]).toMatchObject({ template: 'annual-tax-cert' });
  });

  it('issues an informational certificate when corporate donor < €850', async () => {
    await makeCorporateAdoption(50_000, new Date(Date.UTC(TAX_YEAR, 6, 15))); // €500 only

    const { processTaxCertAnnual } = await import(
      '../src/modules/jobs/processors/tax-cert-annual.processor.js'
    );
    const result = await processTaxCertAnnual({
      data: { taxYear: TAX_YEAR, donorId },
    } as any);

    expect(result.issued).toBe(1);
    const cert = await prisma.taxCertificate.findUnique({
      where: { donorId_taxYear: { donorId, taxYear: TAX_YEAR } },
    });
    expect(cert?.scheme).toBe('individual 2026'); // dominantIntent → corporate is true, but €500 < €850 → individual path
    expect(cert?.totalCents).toBe(50_000);
  });

  it('is idempotent on re-run', async () => {
    await makeCorporateAdoption(120_000, new Date(Date.UTC(TAX_YEAR, 2, 1)));

    const { processTaxCertAnnual } = await import(
      '../src/modules/jobs/processors/tax-cert-annual.processor.js'
    );
    await processTaxCertAnnual({ data: { taxYear: TAX_YEAR, donorId } } as any);
    const second = await processTaxCertAnnual({ data: { taxYear: TAX_YEAR, donorId } } as any);

    expect(second.issued).toBe(0);
    expect(second.skipped).toBe(1);
    const count = await prisma.taxCertificate.count({ where: { donorId, taxYear: TAX_YEAR } });
    expect(count).toBe(1);
  });
});
