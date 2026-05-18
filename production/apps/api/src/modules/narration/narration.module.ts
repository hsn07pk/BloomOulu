import { Global, Module } from '@nestjs/common';
import { NarrationController } from './narration.controller.js';
import { NarrationService } from './narration.service.js';

@Global()
@Module({
  controllers: [NarrationController],
  providers: [NarrationService],
  exports: [NarrationService],
})
export class NarrationModule {}
