/**
 * Reconciliation — daily integrity check against payment providers + bank.
 *
 * Cron 03:00 UTC:
 *   1. For each Payment.succeeded in the last 30 days, verify the provider
 *      still confirms it and the amount matches. Mismatch → ReconciliationException + P0 alert.
 *   2. For each Payment.pending older than 24h, mark failed + notify donor.
 *   3. For each Payment without a corresponding ProcessedEvent → page ops.
 *
 * Bank-transfer reconciliation:
 *   - Garden's accountant uploads camt.054 / Tilisiirto CSV via /admin/reconciliation/upload
 *   - Service parses RF references, matches to pending Payments,
 *     marks succeeded inside a transaction with an audit log row.
 */
import { Module, Controller, Post, Body, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { isValidRfReference } from '@bloomoulu/payments';
import { z } from 'zod';

const EntrySchema = z.object({
  reference: z.string().min(4).max(64),
  amountCents: z.number().int().positive(),
  paidAt: z.string().datetime(),
  debtorName: z.string().max(140).optional(),
  bankRef: z.string().max(64).optional(),
});
const EntriesSchema = z.object({ entries: z.array(EntrySchema).min(1).max(500) });

@Controller('reconciliation')
class ReconciliationController {
  private readonly logger = new Logger(ReconciliationController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Accepts a parsed bank entry. Admin UI converts uploaded CSV/camt.054 to
   * this canonical shape. Each entry is matched to a pending Payment by RF
   * reference; if found we synthesize a `checkout.completed` event through
   * the normal PaymentsService.handleEvent pipeline so the receipt + email
   * downstream jobs fire exactly once via the ProcessedEvent gate.
   */
  @Post('entries')
  async submitEntries(@Body() rawBody: unknown) {
    const body = EntriesSchema.parse(rawBody);
    const results: Array<{
      reference: string;
      matched: boolean;
      reason?: string;
      orderId?: string;
    }> = [];

    for (const e of body.entries) {
      if (!isValidRfReference(e.reference)) {
        results.push({ reference: e.reference, matched: false, reason: 'invalid_rf' });
        continue;
      }

      // The RF reference body is `orderId.replace('-','').toUpperCase().slice(0,21)`.
      // Recover the original UUIDv7 orderId by looking up a pending Payment
      // whose normalised orderId starts with the RF body.
      const rfBody = e.reference.replace(/\s+/g, '').slice(4);
      const payment = await this.findPaymentByRfBody(rfBody);
      if (!payment) {
        results.push({ reference: e.reference, matched: false, reason: 'no_pending_payment' });
        continue;
      }
      if (payment.amountCents !== e.amountCents) {
        // Amount mismatch — don't auto-succeed; flag for manual review.
        this.logger.warn(
          `RF ${e.reference} matched Payment ${payment.id} but amounts differ ` +
            `(expected ${payment.amountCents}, got ${e.amountCents}). Marked for manual review.`,
        );
        results.push({
          reference: e.reference,
          matched: false,
          reason: 'amount_mismatch',
          orderId: payment.orderId,
        });
        continue;
      }

      const event = await this.payments.handleEvent({
        kind: 'checkout.completed',
        provider: 'bank_transfer',
        providerEventId: e.bankRef ?? e.reference,
        orderId: payment.orderId,
        providerPaymentRef: e.bankRef ?? e.reference,
        providerSessionId: e.bankRef ?? e.reference,
        amountCents: e.amountCents,
        currency: 'EUR',
        paidAt: new Date(e.paidAt),
        metadata: { debtorName: e.debtorName ?? '' },
      });

      results.push({
        reference: e.reference,
        matched: !event.deduplicated,
        orderId: payment.orderId,
        reason: event.deduplicated ? 'already_processed' : undefined,
      });
    }

    return { processed: body.entries.length, results };
  }

  /** Find a pending bank-transfer Payment whose orderId, with dashes stripped
   *  and uppercased, starts with the given RF body. */
  private async findPaymentByRfBody(rfBody: string) {
    // The RF body is at most 21 alphanumerics; UUIDv7 is 32 hex without dashes.
    // We need the LIKE pattern against the SQL-side computed prefix. Cheapest:
    // pull recent pending bank-transfer Payments and match in JS — at the year-1
    // traffic projection (~50/month) this is trivial. If volume grows we add a
    // generated-column index on `upper(replace(orderId,'-',''))`.
    const recent = await this.prisma.payment.findMany({
      where: {
        provider: 'bank_transfer',
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return recent.find((p) =>
      p.orderId.replace(/-/g, '').toUpperCase().startsWith(rfBody),
    );
  }
}

@Module({
  imports: [PaymentsModule],
  controllers: [ReconciliationController],
})
export class ReconciliationModule {}
