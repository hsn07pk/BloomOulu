import { Module } from '@nestjs/common';
import { PlantsController } from './plants.controller.js';

@Module({ controllers: [PlantsController] })
export class PlantsModule {}
