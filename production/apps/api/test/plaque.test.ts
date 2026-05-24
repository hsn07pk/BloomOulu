/**
 * Plaque auto-creation on a successful endangered/corporate adoption.
 *
 * Drives a payment.succeeded event through PaymentsService.handleEvent and
 * asserts that a Plaque row appears with status='requested' and the
 * engraved text resolved from nickname → publicName → donor.name → email.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

vi.mock('../src/modules/jobs/enqueue.js', () => ({
  enqueueReceipt: vi.fn(async () => {}),
  enqueueEmail: vi.fn(async () => {}),
  enqueuePaymentRetry: vi.fn(async () => {}),
}));

import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { AdoptionLifecycleService } from '../src/modules/adoptions/adoption-lifecycle.service.js';

// vitest uses esbuild which drops `emitDecoratorMetadata`, so Nest's DI
// container can't introspect the constructor. We bypass DI entirely and
// pass dependencies positionally — PaymentsService never needs the
// container in tests.
const prisma = new PrismaClient();
let donorId: string;
let plantId: string;
let svc: PaymentsService;

beforeAll(async () => {
  await prisma.$connect();
  const donor = await prisma.user.create({
    data: { email: `plaque-${uuidv7()}@bloomoulu.test`, name: 'Plaque Donor', locale: 'fi' },
  });
  donorId = donor.id;
  const plant = await prisma.plant.findFirst({ where: { status: 'active' } });
  if (!plant) throw new Error('Test requires a seeded plant');
  plantId = plant.id;

  svc = new PaymentsService(
    prisma as any,
    { log: vi.fn(async () => {}) } as any,
    {
      get: () => ({
        vat: { donationRateBp: 0 },
        adoption: { plaqueEligibleTiers: ['endangered', 'corporate'] },
      }),
    } as any,
    { enabledProviders: () => [], for: () => null as any } as any,
    new AdoptionLifecycleService(),
  );
});

afterAll(async () => {
  await prisma.plaque.deleteMany({ where: { adoption: { donorId } } });
  await prisma.payment.deleteMany({ where: { donorId } });
  await prisma.adoption.deleteMany({ where: { donorId } });
  await prisma.processedEvent.deleteMany();
  await prisma.user.deleteMany({ where: { id: donorId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.processedEvent.deleteMany();
  await prisma.plaque.deleteMany({ where: { adoption: { donorId } } });
  await prisma.payment.deleteMany({ where: { donorId } });
  await prisma.adoption.deleteMany({ where: { donorId } });
});

async function seedAdoption(tierId: 'endangered' | 'rooted' | 'corporate', nickname?: string) {
  const adoption = await prisma.adoption.create({
    data: {
      donorId,
      plantId,
      tierId,
      status: 'pending',
      recurring: false,
      billingInterval: 'one_time',
      amountCents: tierId === 'corporate' ? 125_000 : tierId === 'endangered' ? 75_000 : 7_500,
      nickname: nickname ?? null,
    },
  });
  const orderId = uuidv7();
  await prisma.payment.create({
    data: {
      orderId,
      donorId,
      adoptionId: adoption.id,
      provider: 'paytrail',
      amountCents: adoption.amountCents,
      netCents: adoption.amountCents,
      currency: 'EUR',
      status: 'pending',
    },
  });
  return { adoption, orderId };
}

describe('plaque auto-creation on adoption activation', () => {
  it('creates a Plaque on endangered tier with the donor nickname', async () => {
    const { adoption, orderId } = await seedAdoption('endangered', 'Kangasvuokko-tuki');

    await svc.handleEvent({
      kind: 'payment.succeeded',
      provider: 'paytrail',
      providerEventId: uuidv7(),
      orderId,
      providerPaymentRef: 'pay-ok-1',
      amountCents: adoption.amountCents,
      currency: 'EUR',
      paidAt: new Date(),
      metadata: {},
    });

    const plaque = await prisma.plaque.findUnique({ where: { adoptionId: adoption.id } });
    expect(plaque).toBeTruthy();
    expect(plaque?.status).toBe('requested');
    expect(plaque?.engravedText).toBe('Kangasvuokko-tuki');
  });

  it('falls back to donor.name when no nickname is set', async () => {
    const { adoption, orderId } = await seedAdoption('corporate');

    await svc.handleEvent({
      kind: 'payment.succeeded',
      provider: 'paytrail',
      providerEventId: uuidv7(),
      orderId,
      providerPaymentRef: 'pay-ok-2',
      amountCents: adoption.amountCents,
      currency: 'EUR',
      paidAt: new Date(),
      metadata: {},
    });

    const plaque = await prisma.plaque.findUnique({ where: { adoptionId: adoption.id } });
    expect(plaque?.engravedText).toBe('Plaque Donor');
  });

  it('does NOT create a plaque on rooted tier', async () => {
    const { adoption, orderId } = await seedAdoption('rooted');

    await svc.handleEvent({
      kind: 'payment.succeeded',
      provider: 'paytrail',
      providerEventId: uuidv7(),
      orderId,
      providerPaymentRef: 'pay-ok-3',
      amountCents: adoption.amountCents,
      currency: 'EUR',
      paidAt: new Date(),
      metadata: {},
    });

    const plaque = await prisma.plaque.findUnique({ where: { adoptionId: adoption.id } });
    expect(plaque).toBeNull();
  });

  it('is idempotent: re-running payment.succeeded does not duplicate the plaque', async () => {
    const { adoption, orderId } = await seedAdoption('endangered');

    const evt = {
      kind: 'payment.succeeded' as const,
      provider: 'paytrail' as const,
      providerEventId: uuidv7(),
      orderId,
      providerPaymentRef: 'pay-ok-4',
      amountCents: adoption.amountCents,
      currency: 'EUR' as const,
      paidAt: new Date(),
      metadata: {},
    };
    await svc.handleEvent(evt);
    await svc.handleEvent({ ...evt, providerEventId: uuidv7() }); // new event id, same orderId

    const count = await prisma.plaque.count({ where: { adoptionId: adoption.id } });
    expect(count).toBe(1);
  });
});
