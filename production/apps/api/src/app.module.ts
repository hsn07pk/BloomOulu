import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { LoggerModule } from 'nestjs-pino';
import { trace as otelTrace } from '@opentelemetry/api';
import { RolesGuard } from './common/roles.guard.js';
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
import { ContentModule } from './modules/content/content.module.js';
import { TiersModule } from './modules/tiers/tiers.module.js';
import { NarrationModule } from './modules/narration/narration.module.js';
import { MeModule } from './modules/me/me.module.js';
import { QuizModule } from './modules/quiz/quiz.module.js';
import { ExportsModule } from './modules/exports/exports.module.js';
import { AdminUsersModule } from './modules/admin-users/admin-users.module.js';
import { AdminPlantsModule } from './modules/admin-plants/admin-plants.module.js';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load .env from the monorepo root so a single file drives every app.
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
        mixin() {
          const span = otelTrace.getActiveSpan();
          if (!span) return {};
          const { traceId, spanId } = span.spanContext();
          return { traceId, spanId };
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.passwordHash',
            '*.token',
          ],
          censor: '[REDACTED]',
        },
        ...(isProd
          ? {}
          : {
              transport: {
                target: 'pino-pretty',
                options: { translateTime: 'SYS:HH:MM:ss', singleLine: true, ignore: 'pid,hostname' },
              },
            }),
      },
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
    ContentModule,
    TiersModule,
    NarrationModule,
    MeModule,
    QuizModule,
    ExportsModule,
    AdminUsersModule,
    AdminPlantsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class AppModule {}
