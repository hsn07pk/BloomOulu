/**
 * Dunning state-machine integration test.
 *
 *   day 0  payment.failed                 → status=failed, retry-1 scheduled +3d
 *   day 3  retry-1 fires (gateway fails)  → retry-2 scheduled +7d
 *   day 10 retry-2 fires (gateway fails)  → retry-3 scheduled +14d
 *   day 24 retry-3 fires (gateway fails)  → status=paused, cancel scheduled +21d
 *   day 45 cancel fires, status=paused    → status=cancelled
 *
 * Pre-emptive recovery: if the donor pays at day 12, the still-scheduled
 * retry jobs become no-ops.
 *
 * We exercise the processor directly (not BullMQ) by faking the job payload,
 * and we capture enqueueX calls so we can assert what *would* have been
 * scheduled in production.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

// Mock the enqueue helpers so we don't need Redis.
const enqueuedRetries: Array<{ adoptionId: string; attempt: number; reason: string; delay?: number }> = [];
const enqueuedEmails: Array<{ template: string; to: string; variables: Record<string, string> }> = [];
vi.mock('../src/modules/jobs/enqueue.js', () => ({
  enqueuePaymentRetry: vi.fn(async (data: any, opts?: any) => {
    enqueuedRetries.push({ ...data, delay: opts?.delay });
  }),
  enqueueEmail: vi.fn(async (data: any) => {
    enqueuedEmails.push(data);
  }),
}));

const prisma = new PrismaClient();

// Test fixtures
let donorId: string;
let plantId: string;
let adoptionId: string;

beforeAll(async () => {
  await prisma.$connect();
  // Use a unique donor email so we never collide with the seed/admin user.
  const donor = await prisma.user.create({
    data: {
      email: `dunning-${uuidv7()}@bloomoulu.test`,
      name: 'Dunning Test',
      locale: 'fi',
    },
  });
  donorId = donor.id;
  const plant = await prisma.plant.findFirst({ where: { status: 'active' } });
  if (!plant) throw new Error('Test requires a seeded plant');
  plantId = plant.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { donorId } });
  await prisma.adoption.deleteMany({ where: { donorId } });
  await prisma.auditLog.deleteMany({ where: { resource: { startsWith: 'Adoption/' } } });
  await prisma.user.deleteMany({ where: { id: donorId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  enqueuedRetries.length = 0;
  enqueuedEmails.length = 0;
  // Adoption is `paused` — i.e. PaymentsService.handleEvent has already
  // recorded a failed payment and paused the adoption; the scheduled
  // payment-retry job is about to fire.
  const adoption = await prisma.adoption.create({
    data: {
      donorId,
      plantId,
      tierId: 'rooted',
      status: 'paused',
      recurring: true,
      billingInterval: 'annual',
      amountCents: 7500,
      currency: 'EUR',
      startedAt: new Date(),
    },
  });
  adoptionId = adoption.id;
  await prisma.payment.create({
    data: {
      orderId: uuidv7(),
      donorId,
      adoptionId,
      provider: 'paytrail',
      amountCents: 7500,
      netCents: 7500,
      currency: 'EUR',
      status: 'failed',
      failureCode: 'card_declined',
      failureMessage: 'Bank declined the charge',
    },
  });
});

describe('dunning state machine', () => {
  it('escalates through retry-1, retry-2, retry-3, then pauses and schedules cancellation', async () => {
    const { processPaymentRetry } = await import('../src/modules/jobs/processors/payment-retry.processor.js');

    // retry-1 fires
    await processPaymentRetry({
      data: { adoptionId, attempt: 1, reason: 'retry' },
    } as any);
    expect(enqueuedRetries[0]).toMatchObject({ attempt: 2, reason: 'retry' });
    expect(enqueuedRetries[0]!.delay).toBe(7 * 24 * 60 * 60 * 1000);
    expect(enqueuedEmails[0]!.template).toBe('dunning-retry');
    let a = await prisma.adoption.findUnique({ where: { id: adoptionId } });
    expect(a?.status).toBe('paused'); // stays paused while retries continue

    // retry-2 fires
    enqueuedRetries.length = 0;
    enqueuedEmails.length = 0;
    await processPaymentRetry({
      data: { adoptionId, attempt: 2, reason: 'retry' },
    } as any);
    expect(enqueuedRetries[0]).toMatchObject({ attempt: 3, reason: 'retry' });
    expect(enqueuedRetries[0]!.delay).toBe(14 * 24 * 60 * 60 * 1000);
    expect(enqueuedEmails[0]!.template).toBe('dunning-retry');

    // retry-3 fires → schedule cancellation grace
    enqueuedRetries.length = 0;
    enqueuedEmails.length = 0;
    await processPaymentRetry({
      data: { adoptionId, attempt: 3, reason: 'retry' },
    } as any);
    a = await prisma.adoption.findUnique({ where: { id: adoptionId } });
    expect(a?.status).toBe('paused'); // still paused; grace job will cancel
    expect(enqueuedRetries[0]).toMatchObject({ attempt: 4, reason: 'cancel_paused' });
    expect(enqueuedRetries[0]!.delay).toBe(21 * 24 * 60 * 60 * 1000);
    expect(enqueuedEmails[0]!.template).toBe('dunning-paused');
  });

  it('cancels the paused adoption when the grace job fires', async () => {
    const { processPaymentRetry } = await import('../src/modules/jobs/processors/payment-retry.processor.js');

    await prisma.adoption.update({ where: { id: adoptionId }, data: { status: 'paused' } });

    await processPaymentRetry({
      data: { adoptionId, attempt: 4, reason: 'cancel_paused' },
    } as any);

    const a = await prisma.adoption.findUnique({ where: { id: adoptionId } });
    expect(a?.status).toBe('cancelled');
    expect(a?.cancelledAt).toBeTruthy();
    expect(a?.cancellationReason).toBe('dunning_grace_expired');
    expect(enqueuedEmails[0]!.template).toBe('dunning-cancelled');
  });

  it('skips scheduled retries when the donor has rescued the adoption (status=active)', async () => {
    const { processPaymentRetry } = await import('../src/modules/jobs/processors/payment-retry.processor.js');

    // Donor paid out-of-band — adoption is back to active.
    await prisma.adoption.update({ where: { id: adoptionId }, data: { status: 'active' } });

    await processPaymentRetry({
      data: { adoptionId, attempt: 2, reason: 'retry' },
    } as any);

    expect(enqueuedRetries.length).toBe(0);
    expect(enqueuedEmails.length).toBe(0);
  });

  it('skips the cancellation step when the adoption is no longer paused', async () => {
    const { processPaymentRetry } = await import('../src/modules/jobs/processors/payment-retry.processor.js');

    // Donor recovered between pause and grace expiry — adoption is active.
    await prisma.adoption.update({ where: { id: adoptionId }, data: { status: 'active' } });

    await processPaymentRetry({
      data: { adoptionId, attempt: 4, reason: 'cancel_paused' },
    } as any);

    const a = await prisma.adoption.findUnique({ where: { id: adoptionId } });
    expect(a?.status).toBe('active');
    expect(enqueuedEmails.length).toBe(0);
  });
});
