import { Body, Controller, ForbiddenException, NotFoundException, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { PaymentGatewayFactory } from './payment-gateway.factory.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaytrailGateway } from '@bloomoulu/payments';

const FinalizeMockDto = z.object({
  orderId: z.string().min(1).max(64),
  status: z.enum(['ok', 'fail']).default('ok'),
});
type FinalizeMockDto = z.infer<typeof FinalizeMockDto>;

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly gateways: PaymentGatewayFactory,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Paytrail mock: compute a real HMAC-signed return URL for the mock
   * checkout's "Pay" button. We accept the orderId, look up the
   * canonical Payment, build the same `checkout-*` params Paytrail
   * would attach, sign with the merchant secret, and return the
   * fully-signed redirect URL. The donor's browser follows it to
   * /donate/complete, which forwards to GET /webhooks/paytrail, which
   * verifies the signature against the same secret and activates the
   * adoption(s). Same code path as a real Paytrail return, just without
   * Paytrail's hosted UI in front.
   *
   * Gated on PAYTRAIL_MOCK=true so the route does not exist in
   * production. Returns 404 otherwise.
   */
  @Post('paytrail-mock/finalize')
  @ApiOperation({ summary: 'Mock-mode only: mint a signed Paytrail return URL' })
  async finalizePaytrailMock(
    @Body(new ZodValidationPipe(FinalizeMockDto)) dto: FinalizeMockDto,
  ): Promise<{ returnUrl: string }> {
    if (process.env.PAYTRAIL_MOCK !== 'true') {
      throw new NotFoundException('Mock checkout disabled');
    }
    const payment = await this.prisma.payment.findUnique({
      where: { orderId: dto.orderId },
      select: {
        orderId: true,
        amountCents: true,
        status: true,
        adoption: {
          select: {
            id: true,
            bundleId: true,
            donor: { select: { locale: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Order not found');
    if (payment.status !== 'pending') {
      throw new ForbiddenException(`Order already ${payment.status}; cannot re-finalize`);
    }
    const locale = payment.adoption?.donor.locale ?? 'en';

    // Compose the canonical checkout-* params Paytrail puts on the return.
    const params: Record<string, string> = {
      'checkout-account': process.env.PAYTRAIL_MERCHANT_ID ?? '',
      'checkout-algorithm': 'sha256',
      'checkout-amount': String(payment.amountCents),
      'checkout-stamp': payment.orderId,
      'checkout-reference': payment.orderId.replace(/-/g, '').slice(0, 20),
      'checkout-transaction-id': `mock-${payment.orderId}`,
      'checkout-status': dto.status,
      'checkout-provider': 'paytrail',
      'checkout-timestamp': new Date().toISOString(),
    };
    const gateway = this.gateways.for('paytrail') as PaytrailGateway;
    const signature = gateway.signReturnParams(params);

    const webBase = (process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const url = new URL(`${webBase}/${locale}/donate/complete`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('signature', signature);
    return { returnUrl: url.toString() };
  }

}
