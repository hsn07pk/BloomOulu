/**
 * DisbursementsService — University-of-Oulu central treasury payout
 * tracking. Bundles settled Payments into Disbursement claims that the
 * Garden's finance staff submit to the University. Drives the full
 * lifecycle:
 *
 *   draft → ready → submitted → paid → reconciled
 *
 * Money model:
 *   - expectedCents = sum of included Payment.amountCents
 *   - feeCents      = sum of provider fees
 *   - netCents      = expectedCents − feeCents (what the University owes)
 *   - paidCents     = what the University actually wired
 *   - reconciliation surfaces drift between net and paid for staff review
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PaymentStatus, DisbursementStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface CreateDraftInput {
  periodStart: Date;
  periodEnd: Date;
  notes?: string;
  /** Override which payment ids land in the draft. When unset, every
   *  succeeded Payment in [periodStart, periodEnd] that isn't already
   *  in an active disbursement is included. */
  paymentIds?: string[];
}

export interface UpdateEntriesInput {
  /** Payment ids to include in this disbursement (additive). */
  include?: string[];
  /** Existing entry ids to remove or mark excluded with a reason. */
  exclude?: Array<{ entryId: string; reason: string }>;
}

@Injectable()
export class DisbursementsService {
  private readonly logger = new Logger(DisbursementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Lookups ───────────────────────────────────────────────────────

  async list(opts: {
    status?: DisbursementStatus;
    page?: number;
    pageSize?: number;
  } = {}) {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 50, 200);
    const where: Prisma.DisbursementWhereInput = opts.status ? { status: opts.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.disbursement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { entries: true } } },
      }),
      this.prisma.disbursement.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async detail(id: string) {
    const d = await this.prisma.disbursement.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: { createdAt: 'asc' },
          include: {
            payment: {
              include: {
                donor: { select: { id: true, name: true, email: true } },
                adoption: {
                  select: {
                    id: true,
                    tierId: true,
                    plant: { select: { nameEn: true, slug: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!d) throw new NotFoundException(`Disbursement ${id} not found`);
    return d;
  }

  async stats() {
    const [draft, submitted, paid, reconciled] = await this.prisma.$transaction([
      this.prisma.disbursement.aggregate({
        where: { status: 'draft' },
        _sum: { netCents: true },
        _count: true,
      }),
      this.prisma.disbursement.aggregate({
        where: { status: 'submitted' },
        _sum: { netCents: true },
        _count: true,
      }),
      this.prisma.disbursement.aggregate({
        where: { status: 'paid' },
        _sum: { paidCents: true },
        _count: true,
      }),
      this.prisma.disbursement.aggregate({
        where: { status: 'reconciled' },
        _sum: { paidCents: true },
        _count: true,
      }),
    ]);
    // Outstanding = succeeded payments not yet in any non-cancelled disbursement.
    const outstanding = await this.prisma.$queryRaw<Array<{ count: bigint; sum: bigint | null }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count, COALESCE(SUM(p."amountCents"), 0)::bigint AS sum
      FROM "Payment" p
      WHERE p."status"::text = 'succeeded'
        AND NOT EXISTS (
          SELECT 1 FROM "DisbursementEntry" e
          JOIN "Disbursement" d ON d.id = e."disbursementId"
          WHERE e."paymentId" = p.id
            AND e.included = TRUE
            AND d.status::text <> 'cancelled'
        )
    `);
    const out = outstanding[0] ?? { count: 0n, sum: 0n };
    return {
      draft: { count: draft._count, netCents: draft._sum.netCents ?? 0 },
      submitted: { count: submitted._count, netCents: submitted._sum.netCents ?? 0 },
      paid: { count: paid._count, paidCents: paid._sum.paidCents ?? 0 },
      reconciled: { count: reconciled._count, paidCents: reconciled._sum.paidCents ?? 0 },
      outstanding: {
        count: Number(out.count),
        amountCents: Number(out.sum ?? 0n),
      },
    };
  }

  // ── Mutations ─────────────────────────────────────────────────────

  /**
   * Create a draft disbursement covering Payments settled in
   * [periodStart, periodEnd]. By default, every succeeded Payment not
   * already in a non-cancelled disbursement is included. Caller can
   * narrow by passing `paymentIds`.
   */
  async createDraft(input: CreateDraftInput, actorUserId?: string) {
    if (input.periodEnd <= input.periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }
    const reference = await this.allocateReference(input.periodEnd);

    return await this.prisma.$transaction(async (tx) => {
      const eligible = await tx.payment.findMany({
        where: {
          status: PaymentStatus.succeeded,
          receivedAt: { gte: input.periodStart, lte: input.periodEnd },
          ...(input.paymentIds ? { id: { in: input.paymentIds } } : {}),
          // Exclude payments already in a non-cancelled disbursement.
          NOT: {
            disbursementEntries: {
              some: {
                included: true,
                disbursement: {
                  status: { not: DisbursementStatus.cancelled },
                },
              },
            },
          },
        },
        select: { id: true, amountCents: true, feeCents: true },
      });

      const expected = eligible.reduce((s, p) => s + p.amountCents, 0);
      const fees = eligible.reduce((s, p) => s + p.feeCents, 0);
      const net = expected - fees;

      const d = await tx.disbursement.create({
        data: {
          reference,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: DisbursementStatus.draft,
          expectedCents: expected,
          feeCents: fees,
          netCents: net,
          notes: input.notes ?? null,
          createdByUserId: actorUserId ?? null,
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
      await this.audit.log(tx, {
        actorUserId,
        action: 'disbursement.draft.create',
        resource: `Disbursement/${d.id}`,
        after: {
          reference,
          periodStart: input.periodStart.toISOString(),
          periodEnd: input.periodEnd.toISOString(),
          entries: eligible.length,
          expectedCents: expected,
          netCents: net,
        },
      });
      this.logger.log(
        `Disbursement ${reference} drafted: ${eligible.length} entries, expected=€${(expected / 100).toFixed(2)}`,
      );
      return d;
    });
  }

  async updateEntries(id: string, input: UpdateEntriesInput, actorUserId?: string) {
    return await this.prisma.$transaction(async (tx) => {
      const d = await tx.disbursement.findUniqueOrThrow({ where: { id } });
      if (d.status !== DisbursementStatus.draft) {
        throw new ConflictException(`Cannot edit entries — disbursement is ${d.status}`);
      }

      if (input.include?.length) {
        const payments = await tx.payment.findMany({
          where: {
            id: { in: input.include },
            status: PaymentStatus.succeeded,
          },
          select: { id: true, amountCents: true, feeCents: true },
        });
        for (const p of payments) {
          await tx.disbursementEntry.upsert({
            where: {
              disbursementId_paymentId: {
                disbursementId: id,
                paymentId: p.id,
              },
            },
            create: {
              disbursementId: id,
              paymentId: p.id,
              amountCents: p.amountCents,
              feeCents: p.feeCents,
              netCents: p.amountCents - p.feeCents,
              included: true,
            },
            update: { included: true, excludedReason: null },
          });
        }
      }

      if (input.exclude?.length) {
        for (const ex of input.exclude) {
          await tx.disbursementEntry.update({
            where: { id: ex.entryId },
            data: { included: false, excludedReason: ex.reason },
          });
        }
      }

      // Recompute totals from included entries.
      const sums = await tx.disbursementEntry.aggregate({
        where: { disbursementId: id, included: true },
        _sum: { amountCents: true, feeCents: true, netCents: true },
      });
      const expected = sums._sum.amountCents ?? 0;
      const fees = sums._sum.feeCents ?? 0;
      const net = sums._sum.netCents ?? 0;
      const updated = await tx.disbursement.update({
        where: { id },
        data: { expectedCents: expected, feeCents: fees, netCents: net },
      });

      await this.audit.log(tx, {
        actorUserId,
        action: 'disbursement.entries.update',
        resource: `Disbursement/${id}`,
        after: {
          added: input.include?.length ?? 0,
          excluded: input.exclude?.length ?? 0,
          expectedCents: expected,
          netCents: net,
        },
      });
      return updated;
    });
  }

  async setReady(id: string, actorUserId?: string) {
    return this.transitionStatus(id, DisbursementStatus.draft, DisbursementStatus.ready, actorUserId);
  }

  async setSubmitted(id: string, actorUserId?: string) {
    return await this.prisma.$transaction(async (tx) => {
      const d = await tx.disbursement.findUniqueOrThrow({ where: { id } });
      if (d.status !== DisbursementStatus.ready) {
        throw new ConflictException(`Cannot submit — disbursement is ${d.status}, expected ready`);
      }
      if (d.expectedCents <= 0) {
        throw new BadRequestException('Disbursement has zero expected total');
      }
      const updated = await tx.disbursement.update({
        where: { id },
        data: { status: DisbursementStatus.submitted, submittedAt: new Date() },
      });
      await this.audit.log(tx, {
        actorUserId,
        action: 'disbursement.submitted',
        resource: `Disbursement/${id}`,
        after: { reference: d.reference, netCents: d.netCents },
      });
      return updated;
    });
  }

  async markPaid(
    id: string,
    paidCents: number,
    paidAt: Date,
    actorUserId?: string,
  ) {
    if (paidCents <= 0) throw new BadRequestException('paidCents must be positive');
    return await this.prisma.$transaction(async (tx) => {
      const d = await tx.disbursement.findUniqueOrThrow({ where: { id } });
      if (d.status !== DisbursementStatus.submitted) {
        throw new ConflictException(`Cannot mark paid — disbursement is ${d.status}, expected submitted`);
      }
      const updated = await tx.disbursement.update({
        where: { id },
        data: { status: DisbursementStatus.paid, paidCents, paidAt },
      });
      await this.audit.log(tx, {
        actorUserId,
        action: 'disbursement.paid',
        resource: `Disbursement/${id}`,
        after: {
          reference: d.reference,
          expectedNet: d.netCents,
          paidCents,
          drift: paidCents - d.netCents,
        },
      });
      return updated;
    });
  }

  async reconcile(id: string, actorUserId?: string) {
    return await this.prisma.$transaction(async (tx) => {
      const d = await tx.disbursement.findUniqueOrThrow({ where: { id } });
      if (d.status !== DisbursementStatus.paid) {
        throw new ConflictException(`Cannot reconcile — disbursement is ${d.status}, expected paid`);
      }
      const updated = await tx.disbursement.update({
        where: { id },
        data: { status: DisbursementStatus.reconciled, reconciledAt: new Date() },
      });
      await this.audit.log(tx, {
        actorUserId,
        action: 'disbursement.reconciled',
        resource: `Disbursement/${id}`,
        after: { reference: d.reference, paidCents: d.paidCents, netCents: d.netCents },
      });
      return updated;
    });
  }

  async cancel(id: string, reason: string, actorUserId?: string) {
    return await this.prisma.$transaction(async (tx) => {
      const d = await tx.disbursement.findUniqueOrThrow({ where: { id } });
      if (d.status === DisbursementStatus.reconciled || d.status === DisbursementStatus.paid) {
        throw new ConflictException(`Cannot cancel — disbursement is ${d.status}`);
      }
      const updated = await tx.disbursement.update({
        where: { id },
        data: {
          status: DisbursementStatus.cancelled,
          cancelledAt: new Date(),
          notes: d.notes ? `${d.notes}\n--\nCancelled: ${reason}` : `Cancelled: ${reason}`,
        },
      });
      await this.audit.log(tx, {
        actorUserId,
        action: 'disbursement.cancelled',
        resource: `Disbursement/${id}`,
        after: { reference: d.reference, reason, priorStatus: d.status },
      });
      return updated;
    });
  }

  // ── Export ────────────────────────────────────────────────────────

  /**
   * Build the CSV payload the Garden's finance office hands to the
   * University of Oulu treasury. One row per included Payment, plus a
   * single-row summary at the top. Fields chosen for cross-system
   * readability — every Finnish accountant expects this layout.
   */
  async exportCsv(id: string): Promise<{ csv: string; sha256: string; filename: string }> {
    const d = await this.detail(id);
    const rows: string[] = [];
    rows.push('reference,periodStart,periodEnd,status,expectedNetEUR,paidEUR,entries');
    rows.push(
      [
        csvField(d.reference),
        csvField(d.periodStart.toISOString().slice(0, 10)),
        csvField(d.periodEnd.toISOString().slice(0, 10)),
        csvField(d.status),
        (d.netCents / 100).toFixed(2),
        (d.paidCents / 100).toFixed(2),
        String(d.entries.filter((e) => e.included).length),
      ].join(','),
    );
    rows.push('');
    rows.push(
      'paymentOrderId,provider,donorEmail,donorName,plantSlug,plantName,paidAt,grossEUR,feeEUR,netEUR,included,excludedReason',
    );
    for (const e of d.entries) {
      const p = e.payment;
      rows.push(
        [
          csvField(p.orderId),
          csvField(p.provider),
          csvField(p.donor.email),
          csvField(p.donor.name ?? ''),
          csvField(p.adoption?.plant.slug ?? ''),
          csvField(p.adoption?.plant.nameEn ?? ''),
          csvField(p.receivedAt?.toISOString() ?? ''),
          (e.amountCents / 100).toFixed(2),
          (e.feeCents / 100).toFixed(2),
          (e.netCents / 100).toFixed(2),
          e.included ? 'yes' : 'no',
          csvField(e.excludedReason ?? ''),
        ].join(','),
      );
    }
    const csv = rows.join('\r\n') + '\r\n';
    const sha256 = createHash('sha256').update(csv).digest('hex');
    const filename = `${d.reference}.csv`;

    // Persist the hash so a later download can prove integrity.
    await this.prisma.disbursement.update({
      where: { id },
      data: { csvSha256: sha256 },
    });

    return { csv, sha256, filename };
  }

  /**
   * Render the human-readable PDF claim letter that goes alongside the
   * CSV. We always re-export the CSV first (cheap, deterministic) so the
   * PDF's footer hash matches the latest CSV bytes — guarantees the two
   * artefacts are integrity-linked.
   */
  async exportPdf(id: string): Promise<{ pdf: Buffer; filename: string }> {
    const { renderDisbursementPdf } = await import('@bloomoulu/emails/pdf/disbursement');
    // Ensure the CSV hash on the row matches what we're about to render.
    const { sha256 } = await this.exportCsv(id);
    const d = await this.detail(id);
    const pdf = await renderDisbursementPdf({
      reference: d.reference,
      locale: 'en',
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      status: d.status,
      expectedCents: d.expectedCents,
      feeCents: d.feeCents,
      netCents: d.netCents,
      currency: d.currency,
      csvSha256: sha256,
      issuedAt: new Date(),
      entries: d.entries
        .filter((e) => e.included)
        .map((e) => ({
          donorEmail: e.payment.donor.email,
          donorName: e.payment.donor.name,
          provider: e.payment.provider,
          paidAt: e.payment.receivedAt,
          amountCents: e.amountCents,
          feeCents: e.feeCents,
          netCents: e.netCents,
          plantName: e.payment.adoption?.plant?.nameEn ?? null,
        })),
    });
    return { pdf, filename: `${d.reference}.pdf` };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async transitionStatus(
    id: string,
    from: DisbursementStatus,
    to: DisbursementStatus,
    actorUserId?: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const d = await tx.disbursement.findUniqueOrThrow({ where: { id } });
      if (d.status !== from) {
        throw new ConflictException(
          `Cannot transition to ${to} — disbursement is ${d.status}, expected ${from}`,
        );
      }
      const updated = await tx.disbursement.update({
        where: { id },
        data: { status: to },
      });
      await this.audit.log(tx, {
        actorUserId,
        action: `disbursement.${to}`,
        resource: `Disbursement/${id}`,
        after: { reference: d.reference, from, to },
      });
      return updated;
    });
  }

  /** Gapless DISB-YYYY-NNN reference, allocated under an advisory lock. */
  private async allocateReference(periodEnd: Date): Promise<string> {
    const year = periodEnd.getUTCFullYear();
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(91826)`);
      const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM "Disbursement" WHERE reference LIKE $1`,
        `DISB-${year}-%`,
      );
      const n = Number(rows[0]?.count ?? 0n) + 1;
      return `DISB-${year}-${String(n).padStart(3, '0')}`;
    });
  }
}

function csvField(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
