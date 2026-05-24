import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  activateAdoption,
  pauseAdoption,
  recoverAdoption,
  cancelAdoption,
  expireAdoption,
} from '@bloomoulu/db';

/**
 * Nest DI wrapper around the @bloomoulu/db lifecycle primitives so call
 * sites can `inject` it. The actual transition logic lives in
 * packages/db/src/adoption-lifecycle.ts so the AdminJS process (no Nest)
 * can share it.
 */
@Injectable()
export class AdoptionLifecycleService {
  activate(tx: Prisma.TransactionClient, id: string, startedAt: Date, actorUserId?: string) {
    return activateAdoption(tx, id, startedAt, actorUserId);
  }
  pause(tx: Prisma.TransactionClient, id: string, reason: string, actorUserId?: string) {
    return pauseAdoption(tx, id, reason, actorUserId);
  }
  recover(tx: Prisma.TransactionClient, id: string, actorUserId?: string) {
    return recoverAdoption(tx, id, actorUserId);
  }
  cancel(
    tx: Prisma.TransactionClient,
    id: string,
    opts: { reason: string; cancelledAt: Date },
    actorUserId?: string,
  ) {
    return cancelAdoption(tx, id, opts, actorUserId);
  }
  expire(tx: Prisma.TransactionClient, id: string, actorUserId?: string) {
    return expireAdoption(tx, id, actorUserId);
  }
}
