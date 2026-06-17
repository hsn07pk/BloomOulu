/**
 * PaymentsService — the orchestrator.
 *
 * Owns the lifecycle of `Payment` rows and the idempotent handling of inbound
 * provider events. Every external mutation goes through `db.$transaction()`
 * with an audit log row in the SAME transaction.
 *
 * Donations are one-time, so there are no recurring agreements, dunning, or
 * renewals here — a payment succeeds, fails, or is refunded, and the linked
 * Donation transitions accordingly.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@prisma/client';
import { pickProvider, type NormalisedEvent, type ProviderId } from '@bloomoulu/payments';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DonationLifecycleService } from '../donations/donation-lifecycle.service.js';
import { PaymentGatewayFactory } from './payment-gateway.factory.js';
import { enqueueReceipt } from '../jobs/enqueue.js';

export interface CreatePaymentInput {
  donorId: string;
  donorEmail: string;
  donorName?: string;
  donorLocale: 'en' | 'fi' | 'sv';
  donorCountry: string;
  preferredProvider?: ProviderId;
  amountCents: number;
  description: string;
  donationId?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentHandoff {
  orderId: string;
  paymentId: string;
  provider: ProviderId;
  redirectUrl: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly gateways: PaymentGatewayFactory,
    private readonly lifecycle: DonationLifecycleService,
  ) {}

  /** Initiate a one-time payment. Always idempotent by orderId. */
  async initiate(input: CreatePaymentInput, actorIp?: string): Promise<PaymentHandoff> {
    const enabled = this.gateways.enabledProviders();
    const provider =
      input.preferredProvider && enabled.includes(input.preferredProvider)
        ? input.preferredProvider
        : pickProvider({
            donorCountry: input.donorCountry,
            donorPrefers:
              input.preferredProvider === 'paytrail'
                ? 'card'
                : input.preferredProvider === 'mobilepay'
                  ? 'mobilepay'
                  : input.preferredProvider === 'bank_transfer'
                    ? 'bank'
                    : undefined,
            enabledProviders: enabled,
          });

    const orderId = uuidv7();
    const gateway = this.gateways.for(provider);

    const handoff = await gateway.createCheckout({
      orderId,
      donor: {
        donorId: input.donorId,
        email: input.donorEmail,
        name: input.donorName,
        locale: input.donorLocale,
        countryCode: input.donorCountry,
      },
      lineItems: [
        {
          description: input.description,
          amountCents: input.amountCents,
          currency: 'EUR',
          vatRateBp: this.settings.get().vat.donationRateBp,
        },
      ],
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      metadata: {},
    });
    const redirectUrl = handoff.redirectUrl;
    const providerSessionId = handoff.providerSessionId;

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          orderId,
          donationId: input.donationId ?? null,
          donorId: input.donorId,
          provider,
          providerSessionId,
          amountCents: input.amountCents,
          currency: 'EUR',
          netCents: input.amountCents,
          vatRateBp: this.settings.get().vat.donationRateBp,
          vatCents: 0,
          status: PaymentStatus.pending,
        },
      });
      await this.audit.log(tx, {
        actorUserId: input.donorId,
        action: 'payment.initiate',
        resource: `Payment/${p.id}`,
        after: { provider, amountCents: input.amountCents, orderId },
        ip: actorIp ?? null,
      });
      return p;
    });

    return { orderId, paymentId: payment.id, provider, redirectUrl };
  }

  /**
   * Handle a normalised webhook event. MUST be idempotent — duplicate events
   * are unconditionally swallowed via the (provider, providerEventId) unique
   * index on `ProcessedEvent`.
   */
  async handleEvent(event: NormalisedEvent): Promise<{ deduplicated: boolean }> {
    if (event.kind === 'unknown') {
      this.logger.warn(`Unknown event from ${event.provider}: ${event.providerEventId}`);
      return { deduplicated: false };
    }
    // Agreement events only arise from recurring rails, which one-time
    // donations never enrol in. Acknowledge + ignore so a stray event can't
    // wedge the webhook endpoint.
    if (event.kind === 'agreement.activated' || event.kind === 'agreement.cancelled') {
      this.logger.warn(`Ignoring recurring-only event ${event.kind} from ${event.provider}`);
      return { deduplicated: false };
    }

    const sideEffects: Array<() => Promise<unknown>> = [];
    const result = await this.prisma.$transaction(async (tx) => {
      // Idempotency gate.
      try {
        await tx.processedEvent.create({
          data: {
            provider: event.provider as ProviderId,
            providerEventId: event.providerEventId,
            payloadDigest: digest(event),
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.debug(`Deduplicated ${event.provider}/${event.providerEventId}`);
          return { deduplicated: true };
        }
        throw err;
      }

      const payment = await tx.payment.findUnique({ where: { orderId: event.orderId } });

      switch (event.kind) {
        case 'checkout.completed':
        case 'payment.succeeded': {
          // Payment row may not exist YET if the provider's webhook beats our
          // own initiate() insert (the gateway call happens before the Payment
          // row is committed). THROW so the ProcessedEvent insert rolls back
          // and the provider retries — returning here would commit the
          // idempotency marker and permanently swallow the real event.
          if (!payment) {
            throw new Error(`No Payment for orderId=${event.orderId} yet; rolling back to retry`);
          }
          // Only a pending payment settles. A duplicate success, or a success
          // arriving after the payment already settled/refunded, is a no-op
          // (the lifecycle guards counters, but we also avoid clobbering a
          // refunded row back to succeeded).
          if (payment.status !== PaymentStatus.pending) {
            this.logger.debug(`Payment ${payment.id} already ${payment.status}; skipping success event`);
            return { deduplicated: false };
          }
          const feeCents = typeof event.feeCents === 'number' ? event.feeCents : payment.feeCents;
          const grossAmount = event.amountCents || payment.amountCents;
          if (grossAmount !== payment.amountCents) {
            // Paytrail/MobilePay should report the exact amount; a bank-transfer
            // under/overpayment is caught upstream by the reconciliation amount
            // guard. Log here as a last line of defence.
            this.logger.warn(
              `Amount mismatch on ${event.orderId}: expected ${payment.amountCents}, got ${grossAmount}`,
            );
          }
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.succeeded,
              providerPaymentRef: event.providerPaymentRef,
              receivedAt: event.paidAt,
              amountCents: grossAmount,
              feeCents,
              // Net = gross − provider fee. VAT is exempt for FI non-profit
              // donations so VAT cents stay zero.
              netCents: grossAmount - feeCents,
            },
          });
          if (payment.donationId) {
            await this.lifecycle.complete(tx, payment.donationId, event.paidAt);
          }
          await this.audit.log(tx, {
            action: 'payment.succeeded',
            resource: `Payment/${payment.id}`,
            after: { providerPaymentRef: event.providerPaymentRef },
          });
          // Receipt PDF + email after the txn commits.
          sideEffects.push(() => enqueueReceipt({ paymentId: payment.id }));
          break;
        }
        case 'payment.failed': {
          if (!payment) {
            throw new Error(`No Payment for orderId=${event.orderId} yet; rolling back to retry`);
          }
          // Don't flip an already-settled (succeeded/refunded) payment to
          // failed — that would strand the plant counters inflated.
          if (payment.status !== PaymentStatus.pending) {
            this.logger.debug(`Payment ${payment.id} already ${payment.status}; ignoring failed event`);
            return { deduplicated: false };
          }
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.failed,
              failureCode: event.failureCode,
              failureMessage: event.failureMessage,
            },
          });
          if (payment.donationId) {
            await this.lifecycle.fail(tx, payment.donationId, event.failureCode ?? 'unknown');
          }
          await this.audit.log(tx, {
            action: 'payment.failed',
            resource: `Payment/${payment.id}`,
            after: { code: event.failureCode },
          });
          break;
        }
        case 'refund.processed': {
          if (!payment) {
            throw new Error(`No Payment for orderId=${event.orderId} yet; rolling back to retry`);
          }
          // Only a settled payment can be refunded. Refunding a pending/failed
          // row (or re-refunding) is a no-op — the lifecycle only decrements
          // the plant counters when the gift had actually completed.
          if (payment.status !== PaymentStatus.succeeded) {
            this.logger.debug(`Payment ${payment.id} is ${payment.status}, not succeeded; skipping refund event`);
            return { deduplicated: false };
          }
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.refunded,
              refundedCents: event.refundCents,
              refundedAt: event.refundedAt,
            },
          });
          if (payment.donationId) {
            await this.lifecycle.refund(tx, payment.donationId, event.refundedAt);
          }
          await this.audit.log(tx, {
            action: 'payment.refunded',
            resource: `Payment/${payment.id}`,
            after: { refundCents: event.refundCents },
          });
          break;
        }
      }
      return { deduplicated: false };
    });
    if (!result.deduplicated) {
      for (const fx of sideEffects) {
        try {
          await fx();
        } catch (err) {
          this.logger.error(`Post-commit side-effect failed: ${(err as Error).message}`);
          // State is committed; the worker DLQ + reconciliation cron reconcile.
        }
      }
    }
    return result;
  }
}

function digest(event: NormalisedEvent): string {
  const text = JSON.stringify(event, Object.keys(event).sort());
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
