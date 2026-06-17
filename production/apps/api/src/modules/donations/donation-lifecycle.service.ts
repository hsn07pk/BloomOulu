import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { completeDonation, failDonation, refundDonation } from '@bloomoulu/db';

/**
 * Nest DI wrapper around the @bloomoulu/db donation-lifecycle primitives so
 * call sites can `inject` it. The actual transition logic lives in
 * packages/db/src/donation-lifecycle.ts so the AdminJS process (no Nest) can
 * share it.
 */
@Injectable()
export class DonationLifecycleService {
  complete(tx: Prisma.TransactionClient, id: string, startedAt: Date, actorUserId?: string) {
    return completeDonation(tx, id, startedAt, actorUserId);
  }
  fail(tx: Prisma.TransactionClient, id: string, reason: string, actorUserId?: string) {
    return failDonation(tx, id, reason, actorUserId);
  }
  refund(tx: Prisma.TransactionClient, id: string, refundedAt: Date, actorUserId?: string) {
    return refundDonation(tx, id, refundedAt, actorUserId);
  }
}
