import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { HealthController } from './modules/health/health.controller.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PlantsModule } from './modules/plants/plants.module.js';
import { AdoptionsModule } from './modules/adoptions/adoptions.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { ReceiptsModule } from './modules/receipts/receipts.module.js';
import { AskModule } from './modules/ask/ask.module.js';
import { KioskModule } from './modules/kiosk/kiosk.module.js';
import { GdprModule } from './modules/gdpr/gdpr.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load .env from the monorepo root so a single file drives every app.
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'mid',   ttl: 60_000, limit: 120 },
    ]),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
    }),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    PrismaModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    PlantsModule,
    AdoptionsModule,
    PaymentsModule,
    WebhooksModule,
    ReceiptsModule,
    AskModule,
    KioskModule,
    GdprModule,
    ReconciliationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
