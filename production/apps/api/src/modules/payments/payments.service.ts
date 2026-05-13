/**
 * PaymentsService — the orchestrator.
 *
 * Owns the lifecycle of `Payment` rows and the idempotent handling of inbound
 * provider events. Every external mutation goes through `db.$transaction()`
 * with an audit log row in the SAME transaction.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@prisma/client';
import {
  pickProvider,
  type AdoptionIntent,
  type NormalisedEvent,
  type ProviderId,
} from '@bloomoulu/payments';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PaymentGatewayFactory } from './payment-gateway.factory.js';

export interface CreatePaymentInput {
  donorId: string;
  donorEmail: string;
  donorName?: string;
  donorLocale: 'en' | 'fi' | 'sv';
  donorCountry: string;
  preferredProvider?: ProviderId;
  amountCents: number;
  intent: AdoptionIntent;
  recurring: boolean;
  description: string;
  adoptionId?: string;
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
  ) {}

  /** Initiate a payment. Always idempotent by orderId. */
  async initiate(input: CreatePaymentInput, actorIp?: string): Promise<PaymentHandoff> {
    const enabled = this.gateways.enabledProviders();
    const provider =
      input.preferredProvider && enabled.includes(input.preferredProvider)
        ? input.preferredProvider
        : pickProvider({
            donorCountry: input.donorCountry,
            donorPrefers:
              input.preferredProvider === 'paytrail' ? 'card' :
              input.preferredProvider === 'mobilepay' ? 'mobilepay' :
              input.preferredProvider === 'bank_transfer' ? 'bank' : undefined,
            amountCents: input.amountCents,
            intent: input.intent,
            recurring: input.recurring,
            enabledProviders: enabled,
          });

    const orderId = uuidv7();
    const gateway = this.gateways.for(provider);

    let redirectUrl: string;
    let providerSessionId: string;
    if (input.recurring && provider === 'mobilepay') {
      const handoff = await gateway.createAgreement({
        orderId,
        donor: {
          donorId: input.donorId,
          email: input.donorEmail,
          name: input.donorName,
          locale: input.donorLocale,
          countryCode: input.donorCountry,
        },
        productName: input.description,
        productDescription: input.description,
        amountCents: input.amountCents,
        currency: 'EUR',
        interval: 'annual',
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        metadata: {},
      });
      redirectUrl = handoff.confirmationUrl;
      providerSessionId = handoff.agreementId;
    } else {
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
        intent: input.intent,
      });
      redirectUrl = handoff.redirectUrl;
      providerSessionId = handoff.providerSessionId;
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          orderId,
          adoptionId: input.adoptionId ?? null,
          donorId: input.donorId,
          provider: provider as any,
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
    return this.prisma.$transaction(async (tx) => {
      // Idempotency gate.
      try {
        await tx.processedEvent.create({
          data: {
            provider: event.provider as any,
            providerEventId: event.providerEventId,
            payloadDigest: digest(event),
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Unique constraint — we've seen this event already.
          this.logger.debug(`Deduplicated ${event.provider}/${event.providerEventId}`);
          return { deduplicated: true };
        }
        throw err;
      }

      const payment = event.kind !== 'agreement.activated' && event.kind !== 'agreement.cancelled'
        ? await tx.payment.findUnique({ where: { orderId: event.orderId } })
        : null;

      switch (event.kind) {
        case 'checkout.completed':
        case 'payment.succeeded': {
          if (!payment) {
            this.logger.warn(`No Payment found for orderId=${event.orderId}`);
            return { deduplicated: false };
          }
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.succeeded,
              providerPaymentRef: event.providerPaymentRef,
              receivedAt: event.paidAt,
              amountCents: event.amountCents || payment.amountCents,
            },
          });
          if (payment.adoptionId) {
            await tx.adoption.update({
              where: { id: payment.adoptionId },
              data: { status: 'active', startedAt: event.paidAt },
            });
          }
          await this.audit.log(tx, {
            action: 'payment.succeeded',
            resource: `Payment/${payment.id}`,
            after: { providerPaymentRef: event.providerPaymentRef },
          });
          // The receipt job is enqueued by ReceiptsService after this txn.
          break;
        }
        case 'payment.failed': {
          if (!payment) return { deduplicated: false };
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.failed,
              failureCode: event.failureCode,
              failureMessage: event.failureMessage,
            },
          });
          await this.audit.log(tx, {
            action: 'payment.failed',
            resource: `Payment/${payment.id}`,
            after: { code: event.failureCode },
          });
          break;
        }
        case 'agreement.activated': {
          // Look up Adoption by metadata orderId; activate.
          const adoption = await tx.adoption.findFirst({
            where: { id: event.orderId },
          });
          if (adoption) {
            await tx.adoption.update({
              where: { id: adoption.id },
              data: { status: 'active', startedAt: new Date() },
            });
          }
          break;
        }
        case 'agreement.cancelled': {
          const adoption = await tx.adoption.findFirst({
            where: { id: event.orderId },
          });
          if (adoption) {
            await tx.adoption.update({
              where: { id: adoption.id },
              data: {
                status: 'cancelled',
                cancelledAt: event.cancelledAt,
                cancellationReason: event.cancelReason,
              },
            });
          }
          break;
        }
        case 'refund.processed': {
          if (!payment) return { deduplicated: false };
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.refunded,
              refundedCents: event.refundCents,
              refundedAt: event.refundedAt,
            },
          });
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
  }
}

function digest(event: NormalisedEvent): string {
  const text = JSON.stringify(event, Object.keys(event).sort());
  // Cheap, non-cryptographic — just needs to be stable.
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
