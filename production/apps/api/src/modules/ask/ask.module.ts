/**
 * AskTheGarden HTTP surface.
 *
 *   POST /v1/ask                  JSON request/response (tests + non-stream clients)
 *   POST /v1/ask/stream           SSE stream (chat UI)
 *   POST /v1/ask/react            Record helpful / off_base / escalated; on
 *                                 escalation, enqueue the curator email.
 *   GET  /v1/ask/starters         Trending starter questions (last week's top
 *                                 "helpful") with admin-editable fallback.
 *   GET  /v1/ask/staff-starters   Admin-editable staff-mode starters by locale.
 *   GET  /v1/ask/corpus-stats     Real counts shown in the right rail.
 *   GET  /v1/ask/audit-metric     Curator-audit error rate over the last N answers.
 *   GET  /v1/ask/history          Past conversations for the signed-in donor.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Module,
  Post,
  Query,
  Res,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { Queue } from 'bullmq';
import { jwtVerify } from 'jose';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AskService } from './ask.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Resolve the caller's userId from the bearer JWT, if present. Anonymous
 *  callers (no header / invalid token) get null — that's the public-chat
 *  case for visitors who haven't signed in. */
async function maybeUserId(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
    const { payload } = await jwtVerify(authHeader.slice('Bearer '.length), secret, {
      algorithms: ['HS256'],
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

const AskDto = z.object({
  // min(2) lets greetings like "Hi" / "Moi" through; the intent classifier
  // (ask.service.ts) routes them to a friendly template, not RAG.
  question: z.string().min(2).max(500),
  locale: z.enum(['en', 'fi', 'sv']).default('fi'),
  userId: z.string().uuid().optional(),
  // Recent conversation turns sent by the client so the server can
  // rewrite anaphoric follow-ups ("tell me more about it") into
  // standalone questions before retrieval, and so the LLM sees the
  // dialogue context during generation. Capped to keep the prompt small.
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().min(1).max(2000),
      }),
    )
    .max(12)
    .default([]),
});
type AskDtoT = z.infer<typeof AskDto>;

const ReactDto = z.object({
  messageId: z.string().uuid(),
  reaction: z.enum(['helpful', 'off_base', 'escalated']),
  contactEmail: z.string().email().optional(),
});
type ReactDtoT = z.infer<typeof ReactDto>;

const emailQueue = new Queue('email', {
  connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
});

@Controller('ask')
class AskController {
  constructor(
    private readonly svc: AskService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Post()
  async ask(@Body(new ZodValidationPipe(AskDto)) body: AskDtoT) {
    return this.svc.answer(body.question, body.locale, body.userId);
  }

  @Post('stream')
  async askStream(
    @Body(new ZodValidationPipe(AskDto)) body: AskDtoT,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const origin = (req.headers.origin as string | undefined) ?? '';
    const allowedOrigins = new Set([
      process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000',
      'http://localhost:3000',
      'http://localhost:3100',
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
    const send = (event: string, data: unknown) => {
      res.raw.write(`event: ${event}\n`);
      res.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
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
      const result = await this.svc.answerStream(
        body.question,
        body.locale,
        body.userId,
        (delta) => send('delta', { text: delta }),
        body.history,
      );
      // Re-fetch citation chunks so the final event carries human-readable
      // titles instead of raw chunk UUIDs.
      const enriched = await this.enrichCitations(result.citations);
      send('final', { ...result, citations: enriched });
    } catch (err) {
      send('error', { message: (err as Error).message });
    } finally {
      clearInterval(heartbeat);
      res.raw.end();
    }
  }

  @Post('react')
  async react(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(ReactDto)) body: ReactDtoT,
  ) {
    const answer = await this.prisma.askAnswer.findUnique({
      where: { messageId: body.messageId },
      include: { message: true },
    });
    if (!answer) return { ok: false };
    // ADR-0003: a donor can only react to their own messages. Anonymous
    // messages (no userId on the AskMessage) accept reactions without
    // auth — that's the public-chat path. Anyone trying to react to a
    // signed-in user's message must present a matching JWT.
    if (answer.message.userId) {
      const auth = Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : headers.authorization;
      const caller = await maybeUserId(auth);
      if (caller !== answer.message.userId) {
        throw new ForbiddenException();
      }
    }
    await this.prisma.askAnswer.update({
      where: { id: answer.id },
      data: {
        reaction: body.reaction,
        escalatedAt: body.reaction === 'escalated' ? new Date() : answer.escalatedAt,
      },
    });
    if (body.reaction === 'escalated') {
      // Enqueue an email to the curator. The email worker (see
      // apps/api/src/modules/jobs/processors) consumes from this queue
      // and renders the curator-escalation template; here we just attach
      // enough context for the curator to reply directly.
      const ask = this.settings.get().ask;
      await emailQueue.add(
        'send',
        {
          template: 'curator-escalation',
          to: ask.curatorEmail,
          locale: answer.message.locale,
          variables: {
            curatorName: ask.curatorName,
            question: answer.message.text,
            answerText: answer.text,
            replyToEmail: body.contactEmail ?? null,
            messageId: answer.message.id,
            slaDays: ask.curatorReplySlaDays,
          },
        },
        { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
      );
    }
    return { ok: true };
  }

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
    // Fallback starters — these must reference data that actually exists
    // in the corpus, or the user clicks them and gets escalated to a
    // curator (terrible first impression). Verified against the live
    // RagDocument set on 2026-05-19.
    return [
      { text: 'Are there any carnivorous plants in the collection?', locale: 'en' },
      { text: 'Which plants here are endangered in Finland?', locale: 'en' },
      { text: 'When does Trollius europaeus bloom?', locale: 'en' },
      { text: 'Onko teillä lihansyöjäkasveja?', locale: 'fi' },
      { text: 'Vilka växter är rödlistade i Finland?', locale: 'sv' },
    ];
  }

  @Get('staff-starters')
  async staffStarters(@Query('locale') locale: string = 'en') {
    // Editable from /admin → SystemSetting → key 'ask.staffStarters'.
    type StaffStarters = Record<'en' | 'fi' | 'sv', string[]>;
    const all = (this.settings.get() as unknown as { ask: { staffStarters?: StaffStarters } }).ask
      .staffStarters;
    const safe: StaffStarters = all && typeof all === 'object'
      ? all
      : { en: [], fi: [], sv: [] };
    const key = (['en', 'fi', 'sv'].includes(locale) ? locale : 'en') as 'en' | 'fi' | 'sv';
    return safe[key] ?? [];
  }

  @Get('corpus-stats')
  async corpusStats() {
    const [plants, ragDocs, citations, accessions] = await Promise.all([
      this.prisma.plant.count({ where: { status: 'active' } }),
      this.prisma.ragDocument.count({ where: { isPublished: true } }),
      this.prisma.citation.count(),
      this.prisma.accession.count(),
    ]);
    return { plants, ragDocs, citations, accessions };
  }

  /** Audit metric — share of recent answers rated off_base. ADR-0005's
   *  5% threshold is the public-launch ceiling. */
  @Get('audit-metric')
  async auditMetric(@Query('window') windowStr = '200') {
    const windowSize = Math.min(2000, Math.max(50, parseInt(windowStr, 10) || 200));
    const recent = await this.prisma.askAnswer.findMany({
      orderBy: { createdAt: 'desc' },
      take: windowSize,
      select: { reaction: true },
    });
    const total = recent.length;
    const offBase = recent.filter((r) => r.reaction === 'off_base').length;
    const errorRate = total === 0 ? 0 : offBase / total;
    return {
      window: total,
      offBase,
      errorRate,
      target: this.settings.get().ask.auditErrorTarget,
    };
  }

  @Get('history')
  async history(@Query('userId') userId?: string, @Query('limit') limitStr = '20') {
    if (!userId) return { items: [] };
    const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 20));
    const rows = await this.prisma.askMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        answer: {
          select: {
            id: true,
            text: true,
            reaction: true,
            createdAt: true,
            modelUsed: true,
            citations: {
              orderBy: { rank: 'asc' },
              select: {
                marker: true,
                rank: true,
                citation: { select: { displayTitle: true, page: true } },
              },
            },
          },
        },
      },
    });
    return { items: rows };
  }

  /** Join answer citations back to RagChunk → Citation so the donor sees
   *  the document title and page rather than a chunk UUID. */
  private async enrichCitations(
    citations: Array<{ marker: string; chunkId: string }>,
  ) {
    if (citations.length === 0) return [];
    const ids = citations.map((c) => c.chunkId);
    const rows = await this.prisma.ragChunk.findMany({
      where: { id: { in: ids } },
      include: {
        document: { select: { title: true } },
        citation: { select: { displayTitle: true, page: true, year: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return citations.map((c) => {
      const r = byId.get(c.chunkId);
      return {
        marker: c.marker,
        chunkId: c.chunkId,
        title:
          r?.citation?.displayTitle ??
          r?.document?.title ??
          (c.marker.replace('[', '').replace(']', '')),
        page: r?.citation?.page ?? null,
        year: r?.citation?.year ?? null,
      };
    });
  }
}

@Module({ controllers: [AskController], providers: [AskService] })
export class AskModule {}
