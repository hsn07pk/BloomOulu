import { Module } from '@nestjs/common';
import { AdminPlantsController } from './admin-plants.controller.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminMetricsController } from './admin-metrics.controller.js';

@Module({
  controllers: [AdminPlantsController, AdminAuditController, AdminMetricsController],
})
export class AdminPlantsModule {}
