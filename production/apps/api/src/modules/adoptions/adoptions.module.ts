import { Module } from '@nestjs/common';
import { AdoptionsController } from './adoptions.controller.js';
import { AdoptionsService } from './adoptions.service.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PaymentsModule],
  controllers: [AdoptionsController],
  providers: [AdoptionsService],
})
export class AdoptionsModule {}
