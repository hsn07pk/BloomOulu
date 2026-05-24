/**
 * Adoption status-transition primitives. The only place in the codebase
 * that should mutate `Adoption.status`. Every call atomically maintains the
 * `Plant.adopterCount` / `Plant.fundedCents` denormalised counters and
 * writes an in-transaction `AuditLog` row.
 *
 * Counter semantics: an adoption contributes to its plant's counters while
 * its status is `active` OR `paused`. Transitions:
 *   pending  → active      +1 / +amountCents
 *   cancelled / expired → active  +1 / +amountCents   (rare; e.g. reinstating a cancelled adoption)
 *   active   → paused      no-op (donor still "has" the plant; dunning is temporary)
 *   paused   → active      no-op (already counted)
 *   active / paused → cancelled / expired   -1 / -amountCents
 *
 * Re-entering the same state is a no-op (idempotent) so webhook replays do
 * not double-count.
 *
 * The functions take a `Prisma.TransactionClient` so callers control the
 * surrounding transaction (and can compose multiple transitions atomically,
 * e.g. activating bundle siblings).
 */
import type { Prisma } from '@prisma/client';

async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    actorUserId?: string | null;
    action: string;
    resource: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      resource: entry.resource,
      before: (entry.before as Prisma.InputJsonValue) ?? undefined,
      after: (entry.after as Prisma.InputJsonValue) ?? undefined,
    },
  });
}

export async function activateAdoption(
  tx: Prisma.TransactionClient,
  id: string,
  startedAt: Date,
  actorUserId?: string,
) {
  const before = await tx.adoption.findUniqueOrThrow({ where: { id } });
  if (before.status === 'active') return before;
  const updated = await tx.adoption.update({
    where: { id },
    data: { status: 'active', startedAt },
  });
  if (before.status !== 'paused') {
    await tx.plant.update({
      where: { id: updated.plantId },
      data: {
        adopterCount: { increment: 1 },
        fundedCents:  { increment: updated.amountCents },
      },
    });
  }
  await writeAudit(tx, {
    actorUserId,
    action: 'adoption.activated',
    resource: `Adoption/${id}`,
    before: { status: before.status },
    after:  { status: 'active', startedAt },
  });
  return updated;
}

export async function pauseAdoption(
  tx: Prisma.TransactionClient,
  id: string,
  reason: string,
  actorUserId?: string,
) {
  const before = await tx.adoption.findUniqueOrThrow({ where: { id } });
  if (before.status === 'paused') return before;
  const updated = await tx.adoption.update({
    where: { id },
    data: { status: 'paused' },
  });
  await writeAudit(tx, {
    actorUserId,
    action: 'adoption.paused',
    resource: `Adoption/${id}`,
    before: { status: before.status },
    after:  { status: 'paused', reason },
  });
  return updated;
}

export async function recoverAdoption(
  tx: Prisma.TransactionClient,
  id: string,
  actorUserId?: string,
) {
  const before = await tx.adoption.findUniqueOrThrow({ where: { id } });
  if (before.status === 'active') return before;
  const updated = await tx.adoption.update({
    where: { id },
    data: { status: 'active' },
  });
  await writeAudit(tx, {
    actorUserId,
    action: 'adoption.recovered',
    resource: `Adoption/${id}`,
    before: { status: before.status },
    after:  { status: 'active' },
  });
  return updated;
}

export async function cancelAdoption(
  tx: Prisma.TransactionClient,
  id: string,
  opts: { reason: string; cancelledAt: Date },
  actorUserId?: string,
) {
  const before = await tx.adoption.findUniqueOrThrow({ where: { id } });
  if (before.status === 'cancelled') return before;
  const updated = await tx.adoption.update({
    where: { id },
    data: {
      status: 'cancelled',
      cancelledAt: opts.cancelledAt,
      cancellationReason: opts.reason,
    },
  });
  if (before.status === 'active' || before.status === 'paused') {
    await tx.plant.update({
      where: { id: updated.plantId },
      data: {
        adopterCount: { decrement: 1 },
        fundedCents:  { decrement: updated.amountCents },
      },
    });
  }
  await writeAudit(tx, {
    actorUserId,
    action: 'adoption.cancelled',
    resource: `Adoption/${id}`,
    before: { status: before.status },
    after:  { status: 'cancelled', reason: opts.reason },
  });
  return updated;
}

export async function expireAdoption(
  tx: Prisma.TransactionClient,
  id: string,
  actorUserId?: string,
) {
  const before = await tx.adoption.findUniqueOrThrow({ where: { id } });
  if (before.status === 'expired') return before;
  const updated = await tx.adoption.update({
    where: { id },
    data: { status: 'expired' },
  });
  if (before.status === 'active' || before.status === 'paused') {
    await tx.plant.update({
      where: { id: updated.plantId },
      data: {
        adopterCount: { decrement: 1 },
        fundedCents:  { decrement: updated.amountCents },
      },
    });
  }
  await writeAudit(tx, {
    actorUserId,
    action: 'adoption.expired',
    resource: `Adoption/${id}`,
    before: { status: before.status },
    after:  { status: 'expired' },
  });
  return updated;
}
