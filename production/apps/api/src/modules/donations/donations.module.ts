import { Module } from '@nestjs/common';
import { DonationsController } from './donations.controller.js';
import { DonationsService } from './donations.service.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PaymentsModule],
  controllers: [DonationsController],
  providers: [DonationsService],
})
export class DonationsModule {}
