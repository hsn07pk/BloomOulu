/**
 * Webhook controllers — one per provider. Each verifies signature against
 * the *raw* HTTP body (captured by @fastify/raw-body at startup) before any
 * parsing, then delegates to PaymentsService.handleEvent for idempotent
 * persistence.
 */
import { Body, Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from '../payments/payments.service.js';
import { PaymentGatewayFactory } from '../payments/payment-gateway.factory.js';
import { WebhookSignatureError } from '@bloomoulu/payments';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly gateways: PaymentGatewayFactory,
  ) {}

  @Post('paytrail')
  @HttpCode(200)
  @Throttle({ short: { ttl: 1000, limit: 100 }, mid: { ttl: 60_000, limit: 5000 } })
  async paytrail(@Req() req: FastifyRequest, @Headers() headers: Record<string, string>) {
    const raw = (req as any).rawBody ?? '';
    return this.process('paytrail', raw, headers);
  }

  @Post('mobilepay')
  @HttpCode(200)
  @Throttle({ short: { ttl: 1000, limit: 100 }, mid: { ttl: 60_000, limit: 5000 } })
  async mobilepay(@Req() req: FastifyRequest, @Headers() headers: Record<string, string>) {
    const raw = (req as any).rawBody ?? '';
    return this.process('mobilepay', raw, headers);
  }

  /** Bank transfer reconciliation — staff posts a CSV row or JSON entry. */
  @Post('bank-transfer')
  @HttpCode(200)
  async bankTransfer(@Body() body: any, @Headers() headers: Record<string, string>) {
    return this.process('bank_transfer', JSON.stringify(body), headers);
  }

  private async process(
    provider: 'paytrail' | 'mobilepay' | 'bank_transfer',
    rawBody: string,
    headers: Record<string, string>,
  ) {
    try {
      const gateway = this.gateways.for(provider);
      const event = await gateway.parseWebhook({ rawBody, headers });
      const result = await this.payments.handleEvent(event);
      return { ok: true, deduplicated: result.deduplicated };
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        this.logger.warn(`Webhook signature mismatch from ${provider}: ${err.message}`);
        // Return 400 — provider will retry, but bad signature → tampered
        return { ok: false, error: 'signature' };
      }
      this.logger.error(`Webhook handler crash from ${provider}`, err as any);
      // Throw → 500 → provider retries with backoff
      throw err;
    }
  }
}
