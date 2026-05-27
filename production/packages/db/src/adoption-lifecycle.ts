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
import { benefitsForTier } from '@bloomoulu/constants';

/**
 * Seed an AdoptionBenefit row for every catalog entry tied to this
 * adoption's tier. Idempotent — uses `skipDuplicates` so re-running on
 * an already-seeded adoption is a no-op. Called from `activateAdoption`
 * and from the one-off backfill script.
 *
 * autoFulfill benefits land directly in 'fulfilled' state (the artefact
 * is always-available, e.g. digital certificate). Everything else
 * lands in 'pending' and surfaces in the admin Benefits to-do list.
 */
async function seedAdoptionBenefits(
  tx: Prisma.TransactionClient,
  adoptionId: string,
  tierId: string,
) {
  const catalog = benefitsForTier(tierId);
  if (catalog.length === 0) return;
  // Pull the donor's current postal address to snapshot onto each
  // physical-category row. If it's null we mark physical benefits
  // `not_applicable` — staff sees them in the admin filter as "blocked
  // on address" and can ping the donor.
  const adoption = await tx.adoption.findUnique({
    where: { id: adoptionId },
    select: { donor: { select: { postalAddress: true } } },
  });
  const addr = (adoption?.donor?.postalAddress ?? null) as Prisma.JsonValue | null;
  const hasAddress =
    addr !== null &&
    typeof addr === 'object' &&
    'line1' in (addr as Record<string, unknown>);
  const now = new Date();
  await tx.adoptionBenefit.createMany({
    data: catalog.map((b) => {
      const isPhysicalBlocked = b.requiresAddress && !hasAddress;
      // Recurring benefits seed with nextDueAt = now + cadenceMonths so
      // the worker fires the first send at that boundary instead of
      // immediately on activation.
      let nextDueAt: Date | null = null;
      if (b.category === 'recurring' && b.cadenceMonths) {
        const d = new Date(now);
        d.setUTCMonth(d.getUTCMonth() + b.cadenceMonths);
        nextDueAt = d;
      }
      return {
        adoptionId,
        benefitKey: b.key,
        category: b.category,
        labelSnapshot: b.label,
        donorLabelSnapshot: b.donorLabel ?? null,
        status: b.autoFulfill
          ? ('fulfilled' as const)
          : isPhysicalBlocked
            ? ('not_applicable' as const)
            : ('pending' as const),
        fulfilledAt: b.autoFulfill ? now : null,
        shippingAddress:
          b.category === 'physical' && hasAddress
            ? (addr as Prisma.InputJsonValue)
            : undefined,
        nextDueAt,
        notes: isPhysicalBlocked
          ? 'No postal address on donor — set to not_applicable. Ask donor to add address, then flip to pending.'
          : null,
      };
    }),
    skipDuplicates: true,
  });
}

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
  // Seed per-benefit fulfilment rows for this tier. Runs once per
  // (Adoption, benefit); subsequent activations (paused → active etc.)
  // hit `skipDuplicates` and are no-ops.
  await seedAdoptionBenefits(tx, id, updated.tierId);
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
