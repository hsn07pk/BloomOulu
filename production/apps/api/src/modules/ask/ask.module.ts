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
import { LocaleEnum, getWebUrl, getKioskUrl, getAdminUrl } from '@bloomoulu/constants';
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
  locale: LocaleEnum.default('fi'),
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
    const allowedOrigins = new Set([getWebUrl(), getKioskUrl(), getAdminUrl()]);
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
      //
      // Image attach is intent-aware (see enrichCitations) so:
      //   • a question naming a specific plant → only that plant's
      //     image is shown (and nothing if it has no image)
      //   • a generic question whose answer lists several species → all
      //     of those species' images are shown
      // Anaphoric follow-ups ("can you show me this plant?") rely on
      // the history to identify the subject, so we pass it separately.
      const enriched = await this.enrichCitations(
        result.citations,
        body.question,
        result.text,
        body.history.map((h) => h.text).join('\n'),
      );
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
  async history(
    @Req() req: FastifyRequest,
    @Query('limit') limitStr = '20',
  ) {
    // Subject comes from the verified Bearer JWT only — never a client-supplied
    // userId (that was an IDOR exposing any donor's chat history). Anonymous
    // visitors (no/invalid token) get an empty list.
    const userId = await maybeUserId(req.headers['authorization'] as string | undefined);
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
   *  the document title and page rather than a chunk UUID. When the
   *  citation points at a per-plant RAG document, also resolve the
   *  Plant's primary photo + display name so the chat bubble can render
   *  the image inline.
   *
   *  Plant-doc detection has to accept TWO naming conventions because the
   *  corpus contains both:
   *    1. `__plant__:<slug>` — written by the live auto-ingest path in
   *       `enrich-with-review.ts` and `admin/rag-ingest.ts`.
   *    2. `<slug>` (bare) — written by the original bulk ingest script
   *       `scripts/build-plant-rag-corpus.ts`, which seeded the existing
   *       ~7,900 plant docs.
   *  Without recognising both, plants ingested before the namespacing
   *  convention existed never got their photos attached in chat answers.
   */
  private async enrichCitations(
    citations: Array<{ marker: string; chunkId: string }>,
    questionText: string = '',
    answerText: string = '',
    historyText: string = '',
  ) {
    if (citations.length === 0 && !questionText && !answerText && !historyText) return [];
    const ids = citations.map((c) => c.chunkId);
    const rows = ids.length
      ? await this.prisma.ragChunk.findMany({
          where: { id: { in: ids } },
          include: {
            document: { select: { title: true, sourceUrl: true } },
            citation: { select: { displayTitle: true, page: true, year: true } },
          },
        })
      : [];
    // Collect any title that could be a plant slug (with or without the
    // `__plant__:` namespace), then verify by joining to Plant. This is a
    // single round-trip; plants that don't exist with that slug are
    // silently treated as a non-plant document below.
    const candidateSlugs = new Set<string>();
    for (const r of rows) {
      const t = r.document?.title ?? '';
      if (!t) continue;
      candidateSlugs.add(
        t.startsWith('__plant__:') ? t.slice('__plant__:'.length) : t,
      );
    }
    type PlantHit = {
      slug: string;
      nameEn: string;
      primaryImage: { url: string; attribution: string; licenseSpdx: string } | null;
    };
    const plantBySlug = new Map<string, PlantHit>();
    if (candidateSlugs.size > 0) {
      const plants = await this.prisma.plant.findMany({
        where: { slug: { in: Array.from(candidateSlugs) } },
        select: {
          slug: true,
          nameEn: true,
          primaryImage: { select: { url: true, attribution: true, licenseSpdx: true } },
        },
      });
      for (const p of plants) plantBySlug.set(p.slug, p as PlantHit);
    }
    type EnrichedCitation = {
      marker: string;
      chunkId: string;
      title: string;
      page: string | null;
      year: number | null;
      plantSlug: string | null;
      sourceUrl: string | null;
      image: { url: string; attribution: string; licenseSpdx: string } | null;
    };
    const byId = new Map(rows.map((r) => [r.id, r]));
    const enriched: EnrichedCitation[] = citations.map((c) => {
      const r = byId.get(c.chunkId);
      const title = r?.document?.title ?? '';
      const stripped = title.startsWith('__plant__:')
        ? title.slice('__plant__:'.length)
        : title;
      const plant = plantBySlug.get(stripped) ?? null;
      return {
        marker: c.marker,
        chunkId: c.chunkId,
        title:
          r?.citation?.displayTitle ??
          // Prefer the plant's English common name when we know it; this
          // beats showing the bare slug in the sources list.
          (plant?.nameEn ?? stripped ?? c.marker.replace('[', '').replace(']', '')),
        page: r?.citation?.page ?? null,
        year: r?.citation?.year ?? null,
        plantSlug: plant ? plant.slug : null,
        sourceUrl: r?.document?.sourceUrl ?? null,
        // Deliberately NOT attaching the image here. Retrieval often
        // surfaces a per-plant doc as a top citation because of vector
        // similarity to family / origin / habitat terms, not because the
        // answer is actually about that plant. Attaching its image here
        // caused the gallery for "Tell me about Abies alba" to show
        // Abelmoschus esculentus. We restrict image attach to the
        // synthetic text-mining path below, which only matches plants
        // explicitly named in the question/answer/history.
        image: null,
      };
    });

    // Synthetic plant-image citations — intent-aware.
    //
    // The user message is the ground truth for what the donor wants to
    // see. So we look for plant Latin binomials in three text sources,
    // in priority order:
    //
    //   1. The current question and the most recent user turn from
    //      history (these define the "subject" plant — what the donor
    //      is actually asking about).
    //   2. The generated answer text. Only used as a fallback when the
    //      question/history don't name any specific plant — e.g. a
    //      generic question like "which plants are endangered?" whose
    //      answer enumerates several species.
    //
    // This prevents the failure mode where asking "Tell me about
    // Abelmoschus manihot" caused the answer (which also mentions
    // moschatus and esculentus) to surface esculentus's image — that
    // image was clearly off-topic for the donor's question.
    const subjectText = `${questionText}\n${historyText}`.trim();
    const subjectPlants = subjectText
      ? await this.findPlantsMentionedInText(subjectText)
      : [];

    let synthetic = subjectPlants;
    if (synthetic.length === 0 && answerText.trim()) {
      // The question wasn't about any specific plant we know — fall
      // back to plants the answer mentions. This keeps galleries on
      // generic questions like "which carnivorous plants do you have?"
      synthetic = await this.findPlantsMentionedInText(answerText);
    }

    if (synthetic.length > 0) {
      const alreadyShown = new Set(
        enriched.filter((e) => e.image && e.plantSlug).map((e) => e.plantSlug as string),
      );
      for (const s of synthetic) {
        if (alreadyShown.has(s.slug)) continue;
        enriched.push({
          marker: '[plant]',
          chunkId: `plant:${s.slug}`,
          title: s.nameEn,
          page: null,
          year: null,
          plantSlug: s.slug,
          sourceUrl: `/plants/${s.slug}`,
          image: s.primaryImage,
        });
        alreadyShown.add(s.slug);
      }
    }
    return enriched;
  }

  /**
   * Look up plants whose Latin binomial appears anywhere in `text` and
   * which have a primary image.
   *
   * Strategy: extract every plausible Latin-binomial-shaped substring
   * (`Genus species`), then run a single Prisma query against
   * Taxon.latinName. We deliberately cap to a small list so a long text
   * blob can't fan out into a runaway query, and we filter to plants
   * with a hosted primary image so the gallery never renders empty
   * placeholders.
   */
  private async findPlantsMentionedInText(text: string): Promise<
    Array<{
      slug: string;
      nameEn: string;
      primaryImage: { url: string; attribution: string; licenseSpdx: string };
    }>
  > {
    if (!text) return [];
    // Match Latin binomials, optionally italicised by markdown asterisks
    // (the LLM tends to render scientific names that way). e.g.
    // "Abelmoschus esculentus" or "*Abelmoschus esculentus*".
    const re = /(?:\*?\b)([A-Z][a-z]{2,})\s+([a-z]{3,})(?:\b\*?)/g;
    const candidates = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      candidates.add(`${m[1]} ${m[2]}`);
      if (candidates.size >= 12) break;
    }
    if (candidates.size === 0) return [];
    const plants = await this.prisma.plant.findMany({
      where: {
        taxon: { latinName: { in: Array.from(candidates) } },
        primaryImageId: { not: null },
      },
      select: {
        slug: true,
        nameEn: true,
        primaryImage: { select: { url: true, attribution: true, licenseSpdx: true } },
      },
      take: 6,
    });
    return plants
      .filter(
        (p): p is typeof p & { primaryImage: NonNullable<typeof p['primaryImage']> } =>
          Boolean(p.primaryImage),
      )
      .map((p) => ({ slug: p.slug, nameEn: p.nameEn, primaryImage: p.primaryImage }));
  }
}

@Module({ controllers: [AskController], providers: [AskService] })
export class AskModule {}
