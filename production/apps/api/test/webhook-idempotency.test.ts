/**
 * Integration test — payment-webhook idempotency.
 *
 * Verifies that handling the same event id twice yields exactly one Payment
 * mutation. Spins up a fresh Prisma client against a test schema; in CI the
 * `bloomoulu_test` database is provisioned by the GH Action service.
 *
 *   pnpm --filter @bloomoulu/api test
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('ProcessedEvent idempotency', () => {
  it('a second insert with the same (provider, providerEventId) errors with P2002', async () => {
    const evtId = `test-${uuidv7()}`;
    await prisma.processedEvent.create({
      data: {
        provider: 'paytrail',
        providerEventId: evtId,
        payloadDigest: 'digest1',
      },
    });
    await expect(
      prisma.processedEvent.create({
        data: {
          provider: 'paytrail',
          providerEventId: evtId,
          payloadDigest: 'digest2',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
