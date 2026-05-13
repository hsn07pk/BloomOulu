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
import { Module, Controller, Post, Body } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { isValidRfReference } from '@bloomoulu/payments';

@Controller('reconciliation')
class ReconciliationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  /** Accepts a parsed bank entry. Admin UI converts uploaded CSV/camt.054 to this. */
  @Post('entries')
  async submitEntries(
    @Body()
    body: {
      entries: Array<{
        reference: string;
        amountCents: number;
        paidAt: string;
        debtorName?: string;
        bankRef?: string;
      }>;
    },
  ) {
    const results: Array<{ reference: string; matched: boolean }> = [];
    for (const e of body.entries) {
      if (!isValidRfReference(e.reference)) {
        results.push({ reference: e.reference, matched: false });
        continue;
      }
      const event = await this.payments.handleEvent({
        kind: 'checkout.completed',
        provider: 'bank_transfer' as any,
        providerEventId: e.bankRef ?? e.reference,
        orderId: e.reference.replace(/\s+/g, '').slice(4),
        providerPaymentRef: e.bankRef ?? e.reference,
        providerSessionId: e.bankRef ?? e.reference,
        amountCents: e.amountCents,
        currency: 'EUR',
        paidAt: new Date(e.paidAt),
        metadata: { debtorName: e.debtorName ?? '' },
      });
      results.push({ reference: e.reference, matched: !event.deduplicated });
    }
    return { processed: body.entries.length, results };
  }
}

@Module({
  imports: [PaymentsModule],
  controllers: [ReconciliationController],
})
export class ReconciliationModule {}
