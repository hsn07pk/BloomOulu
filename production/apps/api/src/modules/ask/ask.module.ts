/**
 * AskTheGarden HTTP surface.
 *
 *   POST /v1/ask         JSON request/response (used by tests + non-stream clients)
 *   POST /v1/ask/stream  Server-Sent Events stream (chat UI)
 *   POST /v1/ask/react   Record helpful / off_base / escalate on an AskAnswer
 *   GET  /v1/ask/starters Trending starter questions (last week's top "helpful")
 */
import { Body, Controller, Get, Module, Post, Param, Res, Req } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AskService } from './ask.service.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

const AskDto = z.object({
  question: z.string().min(3).max(500),
  locale: z.enum(['en', 'fi', 'sv']).default('fi'),
  userId: z.string().uuid().optional(),
});
type AskDtoT = z.infer<typeof AskDto>;

const ReactDto = z.object({
  messageId: z.string().uuid(),
  reaction: z.enum(['helpful', 'off_base', 'escalated']),
});
type ReactDtoT = z.infer<typeof ReactDto>;

@Controller('ask')
class AskController {
  constructor(
    private readonly svc: AskService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async ask(@Body(new ZodValidationPipe(AskDto)) body: AskDtoT) {
    return this.svc.answer(body.question, body.locale, body.userId);
  }

  /**
   * SSE stream. The current ask.service implementation generates the whole
   * answer before returning; the SSE response emits one `final` event with
   * the answer + citations. When ask.service later switches to true token
   * streaming, we'll emit `delta` events along the way without changing the
   * client contract.
   */
  @Post('stream')
  async askStream(
    @Body(new ZodValidationPipe(AskDto)) body: AskDtoT,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    res.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) => {
      res.raw.write(`event: ${event}\n`);
      res.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    // Heartbeat every 15s so the connection survives intermediaries.
    const heartbeat = setInterval(() => {
      try {
        res.raw.write(`:hb\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);
    req.raw.on('close', () => clearInterval(heartbeat));

    try {
      send('start', { question: body.question, locale: body.locale });
      const result = await this.svc.answer(body.question, body.locale, body.userId);
      // Naive chunked emit for the "delta" phase — splits the answer on word
      // boundaries so the UI can render token-by-token without a deep refactor.
      // When ask.service.generate() exposes the real Ollama stream we'll wire
      // it through here.
      const words = result.text.split(/(\s+)/);
      for (const w of words) {
        send('delta', { text: w });
        // tiny artificial pause so the SSE feels live; ~20 tokens/sec
        await new Promise((r) => setTimeout(r, 24));
      }
      send('final', result);
    } catch (err) {
      send('error', { message: (err as Error).message });
    } finally {
      clearInterval(heartbeat);
      res.raw.end();
    }
  }

  @Post('react')
  async react(@Body(new ZodValidationPipe(ReactDto)) body: ReactDtoT) {
    // The donor's reaction lands on the AskAnswer (one per AskMessage).
    const answer = await this.prisma.askAnswer.findUnique({
      where: { messageId: body.messageId },
    });
    if (!answer) return { ok: false };
    await this.prisma.askAnswer.update({
      where: { id: answer.id },
      data: {
        reaction: body.reaction,
        escalatedAt: body.reaction === 'escalated' ? new Date() : answer.escalatedAt,
      },
    });
    return { ok: true };
  }

  /**
   * Trending starter questions for the chat empty-state.
   * Strategy: last 7 days of AskMessages whose AskAnswer was rated `helpful`,
   * grouped by canonical text. Falls back to a curator-curated default set
   * if there isn't yet enough signal.
   */
  @Get('starters')
  async starters() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.askMessage.findMany({
      where: {
        createdAt: { gte: since },
        answer: { reaction: 'helpful' },
      },
      select: { text: true, locale: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const seen = new Set<string>();
    const dedup: Array<{ text: string; locale: string }> = [];
    for (const r of rows) {
      const key = r.text.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(r);
      }
      if (dedup.length >= 5) break;
    }
    if (dedup.length >= 3) return dedup;

    // Curator-curated fallback (translatable from /admin in a later cut).
    return [
      { text: 'What is blooming in the Romeo greenhouse this week?', locale: 'en' },
      { text: 'Which plants here are Endangered or Vulnerable in Finland?', locale: 'en' },
      { text: 'Tell me about the LIFE+ ESCAPE seed bank project.', locale: 'en' },
      { text: 'Mitä kasveja puutarhasta voin adoptoida?', locale: 'fi' },
      { text: 'Vilka växter blommar i juni?', locale: 'sv' },
    ];
  }
}

@Module({ controllers: [AskController], providers: [AskService] })
export class AskModule {}
