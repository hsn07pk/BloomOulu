/* eslint-disable @typescript-eslint/no-floating-promises */
import './env.js'; // <- must be FIRST; loads .env into process.env before module init
import { getWebUrl } from '@bloomoulu/constants';
import './telemetry.js'; // <- second; sets up OTEL before any other import

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import rawBody from 'fastify-raw-body';
import cookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

const PORT = parseInt(process.env.PORT ?? '4000', 10);

async function bootstrap() {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024, // 5 MB — accommodates camt.054 uploads
    disableRequestLogging: true, // nestjs-pino's pinoHttp owns request logs
  });

  // Capture raw body on all routes — payment webhook handlers verify
  // signatures against the byte-exact request body.
  await adapter.register(rawBody as any, {
    field: 'rawBody',
    global: true,
    encoding: 'utf-8',
    runFirst: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  await app.register(helmet as any, {
    contentSecurityPolicy: false, // CSP set at the edge by Caddy
  });
  await app.register(cookie as any, { secret: process.env.AUTH_SECRET ?? 'dev-secret' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );

  app.enableCors({
    origin: [getWebUrl()],
    credentials: true,
  });

  // Swagger requires `emitDecoratorMetadata` at compile time; tsx (used in dev)
  // does not emit it. Skip Swagger entirely outside of a built (`nest build`)
  // run, where the metadata is present.
  if (process.env.BLOOMOULU_ENABLE_SWAGGER === 'true') {
    const swagger = new DocumentBuilder()
      .setTitle('BloomOulu API')
      .setDescription('Internal + public API. Versioned at /v1.')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  app.setGlobalPrefix('v1', { exclude: ['healthz', 'metrics', 'webhooks/(.*)'] });
  app.enableShutdownHooks();

  // Wire the pub/sub listener into SettingsService so an admin write to
  // SystemSetting (broadcast on the `admin.changed` channel) invalidates
  // our in-memory settings cache immediately instead of after the 60-s
  // TTL.
  try {
    const { PubsubService } = await import('./modules/events/pubsub.service.js');
    const { SettingsService } = await import('./modules/settings/settings.service.js');
    const pubsub = app.get(PubsubService);
    const settings = app.get(SettingsService);
    settings.attachPubsub(pubsub);
  } catch (err) {
    app.get(PinoLogger).warn(`pubsub wiring skipped: ${(err as Error).message}`, 'Bootstrap');
  }

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.get(PinoLogger).log(`BloomOulu API listening on :${PORT}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
