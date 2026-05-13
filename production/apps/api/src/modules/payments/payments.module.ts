import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { PaymentGatewayFactory } from './payment-gateway.factory.js';

@Module({
  providers: [PaymentsService, PaymentGatewayFactory],
  exports: [PaymentsService, PaymentGatewayFactory],
})
export class PaymentsModule {}
