import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';

/**
 * Annual / monthly renewal sweep.
 *
 * For every active recurring Adoption whose endsAt < now + 7 days:
 *   - MobilePay: charge the existing agreement via Vipps Recurring API
 *   - Paytrail (tokenised): rebill via stored card token
 *   - Bank-transfer: email reminder with a fresh RF reference
 *
 * The actual provider calls happen via the gateway adapter; this processor
 * orchestrates which adoption gets which path.
 */
export async function processRenewal(_job: Job) {
  const due = await prisma.adoption.findMany({
    where: {
      status: 'active',
      recurring: true,
      endsAt: { lt: new Date(Date.now() + 7 * 86_400_000) },
    },
    include: { tier: true, donor: { select: { email: true, locale: true, name: true } } },
    take: 50,
  });
  // The actual charging step is intentionally minimal in this stub — see
  // packages/payments for the per-provider implementation. Each provider's
  // chargeAgreement / tokenised charge / reminder path is wired up there.
  return { dueCount: due.length };
}
