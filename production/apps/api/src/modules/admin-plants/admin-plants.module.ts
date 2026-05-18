import { Module } from '@nestjs/common';
import { AdminPlantsController } from './admin-plants.controller.js';
import { AdminAuditController } from './admin-audit.controller.js';

@Module({ controllers: [AdminPlantsController, AdminAuditController] })
export class AdminPlantsModule {}
