import { Global, Module } from '@nestjs/common';
import { AdoptionLifecycleService } from './adoption-lifecycle.service.js';

/**
 * Global module so PaymentsService, dunning processor, and any future
 * consumer can `inject` the lifecycle service without import cycles
 * (AdoptionsModule already depends on PaymentsModule).
 */
@Global()
@Module({
  providers: [AdoptionLifecycleService],
  exports: [AdoptionLifecycleService],
})
export class AdoptionLifecycleModule {}
