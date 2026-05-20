import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { PaymentGatewayFactory } from './payment-gateway.factory.js';
import { PaymentsController } from './payments.controller.js';

@Module({
  providers: [PaymentsService, PaymentGatewayFactory],
  controllers: [PaymentsController],
  exports: [PaymentsService, PaymentGatewayFactory],
})
export class PaymentsModule {}
