import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PaymentsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
