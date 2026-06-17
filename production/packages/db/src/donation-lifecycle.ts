/**
 * Donation status-transition primitives. The only place in the codebase that
 * should mutate `Donation.status`. Every call atomically maintains the
 * `Plant.donorCount` / `Plant.fundedCents` denormalised counters (only when
 * the gift is directed to a species) and writes an in-transaction `AuditLog`
 * row.
 *
 * Donations are one-time, so the lifecycle is linear:
 *   pending → completed              +1 / +amountCents on the plant
 *   completed → refunded             -1 / -amountCents on the plant
 *   pending → failed                 no counter change
 *
 * Re-entering the same state is a no-op (idempotent) so webhook replays do
 * not double-count.
 *
 * The functions take a `Prisma.TransactionClient` so callers control the
 * surrounding transaction.
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

/** Mark a donation settled. Bumps the plant counters when directed to a species. */
export async function completeDonation(
  tx: Prisma.TransactionClient,
  id: string,
  startedAt: Date,
  actorUserId?: string,
) {
  const before = await tx.donation.findUniqueOrThrow({ where: { id } });
  // Only a pending gift can complete. Re-completing an already-completed
  // donation, or "completing" one that was already refunded/failed (out-of-
  // order or duplicate provider events), is a no-op — never re-increment the
  // plant counters.
  if (before.status !== 'pending') return before;
  const updated = await tx.donation.update({
    where: { id },
    data: { status: 'completed', startedAt },
  });
  if (updated.plantId) {
    await tx.plant.update({
      where: { id: updated.plantId },
      data: {
        donorCount: { increment: 1 },
        fundedCents: { increment: updated.amountCents },
      },
    });
  }
  await writeAudit(tx, {
    actorUserId,
    action: 'donation.completed',
    resource: `Donation/${id}`,
    before: { status: before.status },
    after: { status: 'completed', startedAt },
  });
  return updated;
}

/** Mark a donation failed/abandoned. No counter change (it never counted). */
export async function failDonation(
  tx: Prisma.TransactionClient,
  id: string,
  reason: string,
  actorUserId?: string,
) {
  const before = await tx.donation.findUniqueOrThrow({ where: { id } });
  // Only a pending gift can fail. A "failed" event arriving after the gift
  // already completed (e.g. MobilePay authorize→abort, or a late/duplicate
  // event) must NOT flip completed→failed, which would strand the plant
  // counters as permanently inflated.
  if (before.status !== 'pending') return before;
  const updated = await tx.donation.update({
    where: { id },
    data: { status: 'failed' },
  });
  await writeAudit(tx, {
    actorUserId,
    action: 'donation.failed',
    resource: `Donation/${id}`,
    before: { status: before.status },
    after: { status: 'failed', reason },
  });
  return updated;
}

/** Reverse a settled donation. Decrements the plant counters if it had counted. */
export async function refundDonation(
  tx: Prisma.TransactionClient,
  id: string,
  refundedAt: Date,
  actorUserId?: string,
) {
  const before = await tx.donation.findUniqueOrThrow({ where: { id } });
  if (before.status === 'refunded') return before;
  const updated = await tx.donation.update({
    where: { id },
    data: { status: 'refunded', refundedAt },
  });
  if (before.status === 'completed' && updated.plantId) {
    await tx.plant.update({
      where: { id: updated.plantId },
      data: {
        donorCount: { decrement: 1 },
        fundedCents: { decrement: updated.amountCents },
      },
    });
  }
  await writeAudit(tx, {
    actorUserId,
    action: 'donation.refunded',
    resource: `Donation/${id}`,
    before: { status: before.status },
    after: { status: 'refunded', refundedAt },
  });
  return updated;
}
