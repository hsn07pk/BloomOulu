/**
 * Monthly disbursement-draft creator.
 *
 * Cron: 1st of each month at 05:00 UTC. Looks at the just-ended month
 * and creates a draft Disbursement that bundles every succeeded
 * Payment in that window. Finance staff review, finalise, submit.
 *
 * Idempotency: if a draft / ready / submitted / paid Disbursement
 * already exists overlapping the period, the cron logs and skips.
 * Reconciled and cancelled disbursements don't block a re-draft.
 */
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { prisma } from '@bloomoulu/db';
import { DisbursementStatus, PaymentStatus } from '@prisma/client';

const logger = new Logger('DisbursementMonthly');

export async function processDisbursementMonthly(_job: Job) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(monthStart.getTime() - 1);

  const overlapping = await prisma.disbursement.findFirst({
    where: {
      status: { in: [
        DisbursementStatus.draft,
        DisbursementStatus.ready,
        DisbursementStatus.submitted,
        DisbursementStatus.paid,
      ] },
      AND: [
        { periodStart: { lte: prevMonthEnd } },
        { periodEnd: { gte: prevMonthStart } },
      ],
    },
    select: { id: true, reference: true, status: true },
  });
  if (overlapping) {
    logger.log(
      `Monthly draft skipped — ${overlapping.reference} (${overlapping.status}) already covers the window`,
    );
    return { skipped: true, overlapping: overlapping.reference };
  }

  const eligible = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.succeeded,
      receivedAt: { gte: prevMonthStart, lte: prevMonthEnd },
      NOT: {
        disbursementEntries: {
          some: {
            included: true,
            disbursement: { status: { not: DisbursementStatus.cancelled } },
          },
        },
      },
    },
    select: { id: true, amountCents: true, feeCents: true },
  });

  if (eligible.length === 0) {
    logger.log(`Monthly draft skipped — no settled payments in window`);
    return { skipped: true, reason: 'no_payments' };
  }

  const year = prevMonthEnd.getUTCFullYear();
  const reference = await allocateReference(year);
  const expected = eligible.reduce((s, p) => s + p.amountCents, 0);
  const fees = eligible.reduce((s, p) => s + p.feeCents, 0);
  const net = expected - fees;

  const d = await prisma.$transaction(async (tx) => {
    const row = await tx.disbursement.create({
      data: {
        reference,
        periodStart: prevMonthStart,
        periodEnd: prevMonthEnd,
        status: DisbursementStatus.draft,
        expectedCents: expected,
        feeCents: fees,
        netCents: net,
        notes: 'Auto-created by monthly cron',
        entries: {
          createMany: {
            data: eligible.map((p) => ({
              paymentId: p.id,
              amountCents: p.amountCents,
              feeCents: p.feeCents,
              netCents: p.amountCents - p.feeCents,
              included: true,
            })),
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'disbursement.draft.auto_create',
        resource: `Disbursement/${row.id}`,
        after: {
          reference,
          periodStart: prevMonthStart.toISOString(),
          periodEnd: prevMonthEnd.toISOString(),
          entries: eligible.length,
          expectedCents: expected,
          netCents: net,
        },
      },
    });
    return row;
  });
  logger.log(
    `Monthly draft ${reference}: ${eligible.length} payments, net €${(net / 100).toFixed(2)}`,
  );
  return { id: d.id, reference, entries: eligible.length, netCents: net };
}

async function allocateReference(year: number): Promise<string> {
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(91826)`);
    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "Disbursement" WHERE reference LIKE $1`,
      `DISB-${year}-%`,
    );
    const n = Number(rows[0]?.count ?? 0n) + 1;
    return `DISB-${year}-${String(n).padStart(3, '0')}`;
  });
}
