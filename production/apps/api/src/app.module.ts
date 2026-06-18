import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { DonationsModule } from './modules/donations/donations.module.js';
import { DonationLifecycleModule } from './modules/donations/donation-lifecycle.module.js';
import { VotesModule } from './modules/votes/votes.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { ReceiptsModule } from './modules/receipts/receipts.module.js';
import { TaxCertsModule } from './modules/tax-certs/tax-certs.module.js';
import { AskModule } from './modules/ask/ask.module.js';
import { KioskModule } from './modules/kiosk/kiosk.module.js';
import { GdprModule } from './modules/gdpr/gdpr.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module.js';
import { DisbursementsModule } from './modules/disbursements/disbursements.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { NarrationModule } from './modules/narration/narration.module.js';
import { MeModule } from './modules/me/me.module.js';
import { QuizModule } from './modules/quiz/quiz.module.js';
import { ExportsModule } from './modules/exports/exports.module.js';
import { AdminUsersModule } from './modules/admin-users/admin-users.module.js';
import { AdminPlantsModule } from './modules/admin-plants/admin-plants.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { TranslationsModule } from './modules/translations/translations.module.js';
import { EnrichmentModule } from './modules/enrichment/enrichment.module.js';
import { StatsModule } from './modules/stats/stats.module.js';
import { InstagramModule } from './modules/instagram/instagram.module.js';

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
    EventsModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    PlantsModule,
    DonationLifecycleModule,
    DonationsModule,
    VotesModule,
    PaymentsModule,
    WebhooksModule,
    ReceiptsModule,
    TaxCertsModule,
    AskModule,
    KioskModule,
    GdprModule,
    ReconciliationModule,
    DisbursementsModule,
    ContentModule,
    NarrationModule,
    MeModule,
    QuizModule,
    ExportsModule,
    AdminUsersModule,
    AdminPlantsModule,
    FilesModule,
    TranslationsModule,
    EnrichmentModule,
    StatsModule,
    InstagramModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: ThrottlerGuard runs first to short-circuit obvious
    // abuse before we spend any time on auth / role checks. RolesGuard
    // runs next on requests that survive the rate limit. Per-endpoint
    // limits are set with @Throttle() (see e.g. auth.controller.ts);
    // anything without an explicit decorator inherits the global tier
    // from ThrottlerModule.forRoot above (10/sec, 120/min).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
