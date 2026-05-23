import { Module } from '@nestjs/common';
import { EnrichmentController } from './enrichment.controller.js';

@Module({ controllers: [EnrichmentController] })
export class EnrichmentModule {}
