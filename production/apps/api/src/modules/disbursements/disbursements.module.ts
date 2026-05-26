import { Module } from '@nestjs/common';
import { DisbursementsService } from './disbursements.service.js';
import { DisbursementsController } from './disbursements.controller.js';

@Module({
  providers: [DisbursementsService],
  controllers: [DisbursementsController],
  exports: [DisbursementsService],
})
export class DisbursementsModule {}
