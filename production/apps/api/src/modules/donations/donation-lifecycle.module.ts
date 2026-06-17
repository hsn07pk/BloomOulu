import { Global, Module } from '@nestjs/common';
import { DonationLifecycleService } from './donation-lifecycle.service.js';

/**
 * Global module so PaymentsService (and any future consumer) can `inject`
 * the lifecycle service without import cycles (DonationsModule already
 * depends on PaymentsModule).
 */
@Global()
@Module({
  providers: [DonationLifecycleService],
  exports: [DonationLifecycleService],
})
export class DonationLifecycleModule {}
