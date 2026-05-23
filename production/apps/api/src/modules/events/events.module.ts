/**
 * /v1/events SSE endpoint.
 *
 * Browsers (and the admin tab itself) connect once at page load. Every
 * Redis pub/sub message is fanned out to all live SSE connections so
 * each open dashboard immediately knows when admin-managed state has
 * changed and can `router.refresh()` without a hard reload.
 *
 * Heartbeat every 15 seconds so reverse proxies don't kill idle
 * connections. Subscribers are cleaned up on socket close.
 */
import { Controller, Get, Module, Req, Res } from '@nestjs/common';
import { getWebUrl } from '@bloomoulu/constants';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PubsubService, type PubsubChannel, type PubsubMessage } from './pubsub.service.js';

@Controller('events')
class EventsController {
  constructor(private readonly pubsub: PubsubService) {}

  @Get()
  async stream(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const origin = (req.headers.origin as string | undefined) ?? '';
    const allowedOrigins = new Set([
      getWebUrl(),
      'http://localhost:3000',
      'http://localhost:3100',
      'http://localhost:4100',
    ]);
    const corsOrigin = allowedOrigins.has(origin) ? origin : '';

    res.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      ...(corsOrigin
        ? {
            'access-control-allow-origin': corsOrigin,
            'access-control-allow-credentials': 'true',
            vary: 'Origin',
          }
        : {}),
    });

    const write = (event: string, data: unknown) => {
      try {
        res.raw.write(`event: ${event}\n`);
        res.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {/* connection dropped */}
    };

    write('connected', { ts: Date.now() });

    const onMessage = (m: PubsubMessage) => write(m.channel, m.payload);
    this.pubsub.on('message', onMessage);

    const heartbeat = setInterval(() => {
      try {
        res.raw.write(`:hb\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.pubsub.off('message', onMessage);
      try {
        res.raw.end();
      } catch {/* already closed */}
    };
    req.raw.on('close', cleanup);
    req.raw.on('aborted', cleanup);
  }
}

@Module({
  providers: [PubsubService],
  controllers: [EventsController],
  exports: [PubsubService],
})
export class EventsModule {}
