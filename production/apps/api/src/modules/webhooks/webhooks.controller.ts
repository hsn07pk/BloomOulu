/**
 * Webhook controllers — one per provider. Each verifies signature against
 * the *raw* HTTP body (captured by @fastify/raw-body at startup) before any
 * parsing, then delegates to PaymentsService.handleEvent for idempotent
 * persistence.
 */
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from '../payments/payments.service.js';
import { PaymentGatewayFactory } from '../payments/payment-gateway.factory.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookSignatureError } from '@bloomoulu/payments';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly gateways: PaymentGatewayFactory,
    private readonly prisma: PrismaService,
  ) {}

  @Post('paytrail')
  @HttpCode(200)
  @Throttle({ short: { ttl: 1000, limit: 100 }, mid: { ttl: 60_000, limit: 5000 } })
  async paytrail(@Req() req: FastifyRequest, @Headers() headers: Record<string, string>) {
    const raw = (req as any).rawBody ?? '';
    return this.process('paytrail', raw, headers, {
      'http.method': req.method,
      'http.path': req.url,
    });
  }

  /**
   * Paytrail's hosted checkout redirects the donor's browser back to our
   * configured `successUrl` with the same `checkout-*` params it would
   * have sent as headers on the server-to-server callback. We accept the
   * query params here, re-shape them into the headers format the
   * gateway's parseWebhook understands, and run the identical
   * signature-verify + activate pipeline. The result is that one code
   * path handles both the redirect AND the callback — whichever Paytrail
   * delivers first wins, the other is silently deduplicated.
   */
  @Get('paytrail')
  @Throttle({ short: { ttl: 1000, limit: 100 }, mid: { ttl: 60_000, limit: 5000 } })
  async paytrailReturn(@Req() req: FastifyRequest, @Query() query: Record<string, string>) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    return this.process('paytrail', '', headers, {
      'http.method': req.method,
      'http.path': req.url,
    });
  }

  @Post('mobilepay')
  @HttpCode(200)
  @Throttle({ short: { ttl: 1000, limit: 100 }, mid: { ttl: 60_000, limit: 5000 } })
  async mobilepay(@Req() req: FastifyRequest, @Headers() headers: Record<string, string>) {
    const raw = (req as any).rawBody ?? '';
    return this.process('mobilepay', raw, headers, {
      'http.method': req.method,
      'http.path': req.url,
    });
  }

  /** Bank transfer reconciliation — staff posts a CSV row or JSON entry. */
  @Post('bank-transfer')
  @HttpCode(200)
  async bankTransfer(@Req() req: FastifyRequest, @Body() body: any, @Headers() headers: Record<string, string>) {
    const raw = (req as any).rawBody ?? JSON.stringify(body);
    return this.process('bank_transfer', raw, headers, {
      'http.method': req.method,
      'http.path': req.url,
    });
  }

  private async process(
    provider: 'paytrail' | 'mobilepay' | 'bank_transfer',
    rawBody: string,
    headers: Record<string, string>,
    metadata: Record<string, string> = {},
  ) {
    try {
      const gateway = this.gateways.for(provider);
      const event = await gateway.parseWebhook({ rawBody, headers, metadata });
      // Bank-transfer RF references are derived from the canonical
      // orderId (uppercase + no dashes + truncated to 21 chars). The
      // gateway can't reverse that lossy transform on its own, so we
      // look up the matching pending Payment by RF body prefix here.
      // This keeps the gateway stateless and the lookup auditable.
      if (provider === 'bank_transfer' && event.kind !== 'unknown' && 'orderId' in event && event.orderId) {
        const rfBody = event.orderId.replace(/-/g, '').toUpperCase();
        const candidates = await this.prisma.payment.findMany({
          where: { status: 'pending', provider: 'bank_transfer' },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { orderId: true },
        });
        const match = candidates.find((p) =>
          p.orderId.replace(/-/g, '').toUpperCase().startsWith(rfBody),
        );
        if (match) {
          (event as { orderId: string }).orderId = match.orderId;
        } else {
          this.logger.warn(`bank-transfer: no pending payment matches RF body ${rfBody}`);
        }
      }
      const result = await this.payments.handleEvent(event);
      return { ok: true, deduplicated: result.deduplicated };
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        this.logger.warn(`Webhook signature mismatch from ${provider}: ${err.message}`);
        // A failed signature means a tampered or misconfigured request — reject
        // with 400 (overrides the @HttpCode(200)) rather than silently 200-ing
        // and swallowing the event. The donor-facing /donate/complete page maps
        // a non-200 to its "couldn't verify" state.
        throw new BadRequestException({ ok: false, error: 'signature' });
      }
      this.logger.error(`Webhook handler crash from ${provider}`, err as any);
      // Throw → 500 → provider retries with backoff
      throw err;
    }
  }
}
