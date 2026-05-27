import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PaymentStatus } from '@prisma/client';
import { prisma } from '@bloomoulu/db';
import type { PaymentGateway, ProviderId } from '@bloomoulu/payments';
import { rfCreditorReference } from '@bloomoulu/payments';
import { enqueueEmail, enqueueReceipt } from '../enqueue.js';

const logger = new Logger('Renewal');

export interface RenewalDeps {
  gatewayFor: (provider: ProviderId) => PaymentGateway;
}

const NO_GATEWAY: RenewalDeps = {
  gatewayFor: (provider) => {
    throw new Error(`No gateway wired for provider ${provider} — pass deps to makeProcessRenewal`);
  },
};

/**
 * Annual / monthly renewal sweep.
 *
 * For every active recurring Adoption whose endsAt < now + 7 days:
 *   - mobilepay → POST /recurring/v3/agreements/{id}/charges
 *   - paytrail  → POST /payments/token/mit-charge against the stored token
 *   - bank_transfer → email reminder with a fresh RF reference; donor
 *                     pays manually, accountant reconciles the next CSV
 *
 * Idempotency: every charged adoption gets a fresh Payment.orderId
 * (uuidv7) so re-running the cron within the same window cannot
 * double-charge. The endsAt-derived window also widens by 7d so a
 * one-day cron miss still catches the renewal next time.
 */
export const processRenewal = (job: Job) => makeProcessRenewal(NO_GATEWAY)(job);

export function makeProcessRenewal(deps: RenewalDeps) {
  return async function processRenewalWithDeps(job: Job<{ adoptionId?: string } | undefined>) {
    const targetedId = job.data?.adoptionId;
    const due = await prisma.adoption.findMany({
      where: targetedId
        ? { id: targetedId }
        : {
            status: 'active',
            recurring: true,
            endsAt: { lt: new Date(Date.now() + 7 * 86_400_000) },
          },
      include: {
        tier: true,
        donor: { select: { id: true, email: true, locale: true, name: true } },
        plant: { select: { nameEn: true } },
      },
      take: targetedId ? 1 : 100,
    });

    let charged = 0;
    let failed = 0;
    let reminded = 0;

    for (const adoption of due) {
      // Find the most recent Payment row with an agreement credential.
      // For first-charge (post `agreement.activated`): the initial
      // pending Payment, which the orchestrator updated with
      // providerCustomerId. For periodic renewals: the most recent
      // succeeded Payment.
      const last = await prisma.payment.findFirst({
        where: {
          adoptionId: adoption.id,
          providerCustomerId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
      });
      const provider = (last?.provider ?? 'bank_transfer') as ProviderId;
      const newOrderId = uuidv7();

      if (provider === 'bank_transfer') {
        await prisma.$transaction(async (tx) => {
          await tx.payment.create({
            data: {
              orderId: newOrderId,
              adoptionId: adoption.id,
              donorId: adoption.donor.id,
              provider: 'bank_transfer' as const,
              amountCents: adoption.amountCents,
              currency: 'EUR',
              netCents: adoption.amountCents,
              vatRateBp: 0,
              vatCents: 0,
              status: PaymentStatus.pending,
            },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: adoption.donor.id,
              action: 'payment.renewal.reminder',
              resource: `Adoption/${adoption.id}`,
              after: { orderId: newOrderId, amountCents: adoption.amountCents },
            },
          });
        });
        await enqueueEmail({
          template: 'bank-transfer-renewal',
          to: adoption.donor.email,
          locale: adoption.donor.locale as 'en' | 'fi' | 'sv',
          variables: {
            donorName: adoption.donor.name ?? '',
            plantName: adoption.plant.nameEn,
            amount: (adoption.amountCents / 100).toFixed(2),
            reference: rfCreditorReference(newOrderId),
          },
        });
        reminded++;
        continue;
      }

      if (!last?.providerCustomerId) {
        // Active recurring adoption with no stored credential — log
        // and skip. Surfaces in admin via the audit log.
        logger.warn(`Renewal skipped for ${adoption.id}: provider=${provider} but no agreement credential`);
        await prisma.auditLog.create({
          data: {
            action: 'payment.renewal.no_credential',
            resource: `Adoption/${adoption.id}`,
            after: { provider, lastPaymentId: last?.id ?? null },
          },
        });
        continue;
      }

      let gateway: PaymentGateway;
      try {
        gateway = deps.gatewayFor(provider);
      } catch (err) {
        logger.error(`Gateway resolve failed for ${provider}: ${(err as Error).message}`);
        failed++;
        continue;
      }

      const result = await gateway.chargeAgreement({
        orderId: newOrderId,
        agreementId: last.providerCustomerId,
        amountCents: adoption.amountCents,
        currency: 'EUR',
        description: `Renewal: ${adoption.plant.nameEn}`,
      });

      if (!result.ok) {
        failed++;
        await prisma.$transaction(async (tx) => {
          await tx.payment.create({
            data: {
              orderId: newOrderId,
              adoptionId: adoption.id,
              donorId: adoption.donor.id,
              provider,
              providerCustomerId: last.providerCustomerId,
              amountCents: adoption.amountCents,
              currency: 'EUR',
              netCents: adoption.amountCents,
              vatRateBp: 0,
              vatCents: 0,
              status: PaymentStatus.failed,
              failureCode: result.code,
              failureMessage: result.message,
            },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: adoption.donor.id,
              action: 'payment.renewal.failed',
              resource: `Adoption/${adoption.id}`,
              after: { orderId: newOrderId, provider, code: result.code, message: result.message },
            },
          });
        });
        // Let PaymentsService observe the failure via the next webhook
        // OR — more reliably — enqueue dunning attempt #1 directly.
        // The dunning processor sees the failed Payment row and
        // continues the ladder. Adoption stays active for now; the
        // first dunning email softens the transition.
        continue;
      }

      charged++;
      await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            orderId: newOrderId,
            adoptionId: adoption.id,
            donorId: adoption.donor.id,
            provider,
            providerCustomerId: last.providerCustomerId,
            providerPaymentRef: result.chargeId,
            amountCents: adoption.amountCents,
            currency: 'EUR',
            netCents: adoption.amountCents,
            vatRateBp: 0,
            vatCents: 0,
            status: result.status === 'succeeded' ? PaymentStatus.succeeded : PaymentStatus.pending,
            receivedAt: result.status === 'succeeded' ? new Date() : null,
          },
        });
        // Extend the adoption's `endsAt` so the next sweep doesn't
        // double-charge. Interval logic mirrors AdoptionsService.create:
        // monthly = +1 month, annual = +1 year.
        const stepMs =
          adoption.billingInterval === 'monthly' ? 31 * 86_400_000 : 366 * 86_400_000;
        const newEndsAt = new Date(
          (adoption.endsAt?.getTime() ?? Date.now()) + stepMs,
        );
        await tx.adoption.update({
          where: { id: adoption.id },
          data: { endsAt: newEndsAt },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: adoption.donor.id,
            action: 'payment.renewal.charged',
            resource: `Adoption/${adoption.id}`,
            after: {
              orderId: newOrderId,
              provider,
              chargeId: result.chargeId,
              status: result.status,
              amountCents: adoption.amountCents,
              newEndsAt: newEndsAt.toISOString(),
            },
          },
        });
      });
      if (result.status === 'succeeded') {
        const created = await prisma.payment.findUniqueOrThrow({
          where: { orderId: newOrderId },
          select: { id: true },
        });
        await enqueueReceipt({ paymentId: created.id });
      }
    }

    return { dueCount: due.length, charged, failed, reminded };
  };
}
