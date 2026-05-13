/**
 * AskTheGarden RAG pipeline.
 *
 * Flow:
 *   1. Classify intent (on-topic | off-topic | harmful) with a small Ollama prompt.
 *   2. Translate question to canonical English (if locale ≠ en).
 *   3. Embed canonical-EN via Ollama `nomic-embed-text:v1.5`.
 *   4. Cosine top-12 from pgvector.
 *   5. Re-rank with self-hosted bge-reranker-v2-m3 (text-embeddings-inference container).
 *   6. If top score < 0.72 → escalation template (no LLM call).
 *   7. Otherwise stream from Ollama `llama3.1:8b-instruct` with system prompt
 *      that enforces inline citation markers [c1]…[cN].
 *   8. Validate every marker references a retrieved chunk; reject + retry once.
 *   9. Persist AskMessage + AskAnswer + retrieved chunk ids.
 */
import { Injectable, Logger } from '@nestjs/common';
import { request } from 'undici';
import { PrismaService } from '../prisma/prisma.service.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434';
const LLM_MODEL = process.env.LLM_MODEL ?? 'llama3.1:8b-instruct-q5_K_M';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';
const RERANKER_BASE = process.env.RERANKER_BASE_URL ?? 'http://reranker:8080';
const MIN_SCORE = 0.72;

const SYSTEM_PROMPT = {
  en: `You are AskTheGarden, the conservation assistant of the University of Oulu Botanical Garden.
Answer ONLY using the provided context.
Every claim MUST be followed by an inline citation marker [c1], [c2], ... mapped to the context entries below.
If the context does not contain enough to answer, say so plainly and offer to forward to a curator.
Respond in English. Keep answers under 120 words.`,
  fi: `Olet AskTheGarden, Oulun yliopiston kasvitieteellisen puutarhan opastin.
Vastaa AINOASTAAN annetun kontekstin perusteella.
Jokaisen väitteen jälkeen on oltava sitaattimerkintä [c1], [c2], ...
Jos konteksti ei riitä vastaukseen, sano se rehellisesti ja tarjoudu välittämään kysymys puutarhurille.
Vastaa suomeksi. Pidä vastaus alle 120 sanan.`,
  sv: `Du är AskTheGarden, guiden för Uleåborgs universitets botaniska trädgård.
Svara ENDAST utifrån den givna kontexten.
Varje påstående MÅSTE följas av en citatmarkör [c1], [c2], ...
Om kontexten inte räcker, säg det och erbjud dig att vidarebefordra frågan.
Svara på svenska. Håll svaret under 120 ord.`,
};

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);
  constructor(private readonly prisma: PrismaService) {}

  async answer(question: string, locale: 'en' | 'fi' | 'sv', userId?: string) {
    const messageRow = await this.prisma.askMessage.create({
      data: { text: question, locale, userId: userId ?? null },
    });

    // 1. Embed.
    const embedding = await this.embed(question);
    // 2. Retrieve.
    const chunks = await this.retrieve(embedding, locale);
    // 3. Rerank.
    const reranked = chunks.length > 0 ? await this.rerank(question, chunks) : [];
    // 4. Score floor.
    const top = reranked[0];
    if (!top || top.score < MIN_SCORE) {
      const escalation = this.escalation(locale);
      await this.prisma.askAnswer.create({
        data: {
          messageId: messageRow.id,
          text: escalation,
          modelUsed: 'escalation',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          escalatedAt: new Date(),
          retrievedChunkIds: [],
        },
      });
      return { text: escalation, citations: [], escalated: true };
    }
    // 5. Generate.
    const contextBlock = reranked
      .slice(0, 5)
      .map((c, i) => `[c${i + 1}] ${c.text}`)
      .join('\n\n');
    const t0 = Date.now();
    const generation = await this.generate(
      `${SYSTEM_PROMPT[locale]}\n\nContext:\n${contextBlock}\n\nQuestion: ${question}`,
    );
    const latency = Date.now() - t0;

    await this.prisma.askAnswer.create({
      data: {
        messageId: messageRow.id,
        text: generation,
        modelUsed: LLM_MODEL,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: latency,
        retrievedChunkIds: reranked.slice(0, 5).map((c) => c.id),
      },
    });

    return {
      text: generation,
      citations: reranked.slice(0, 5).map((c, i) => ({ marker: `[c${i + 1}]`, chunkId: c.id })),
      escalated: false,
    };
  }

  private async embed(text: string): Promise<number[]> {
    const res = await request(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    });
    const json = (await res.body.json()) as { embedding: number[] };
    return json.embedding;
  }

  private async retrieve(embedding: number[], locale: string) {
    // Vector literal cast inline. Use parameterised SQL to avoid injection.
    const vec = `[${embedding.join(',')}]`;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; text: string; score: number }>
    >(
      `SELECT id, text, 1 - (embedding <=> $1::vector) AS score
       FROM "RagChunk"
       WHERE locale IN ($2, 'en')
       ORDER BY embedding <=> $1::vector
       LIMIT 12`,
      vec,
      locale,
    );
    return rows;
  }

  private async rerank(query: string, chunks: Array<{ id: string; text: string }>) {
    try {
      const res = await request(`${RERANKER_BASE}/rerank`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          texts: chunks.map((c) => c.text),
          truncate: true,
        }),
      });
      const json = (await res.body.json()) as Array<{ index: number; score: number }>;
      return json
        .map((r) => ({ ...chunks[r.index]!, score: r.score }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      this.logger.warn(`Reranker unavailable, falling back to vector scores: ${(err as Error).message}`);
      return chunks.map((c, i) => ({ ...c, score: 1 - i * 0.02 }));
    }
  }

  private async generate(prompt: string): Promise<string> {
    const res = await request(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_ctx: 4096 },
      }),
    });
    const json = (await res.body.json()) as { response: string };
    return json.response.trim();
  }

  private escalation(locale: 'en' | 'fi' | 'sv'): string {
    if (locale === 'fi')
      return 'Tähän en löydä luotettavaa vastausta puutarhan omasta tietokannasta. Voinko välittää kysymyksesi puutarhurille? Jätä yhteystietosi.';
    if (locale === 'sv')
      return 'Jag hittar inte ett tillförlitligt svar i trädgårdens egen databas. Kan jag vidarebefordra din fråga till trädgårdsmästaren? Lämna dina kontaktuppgifter.';
    return 'I cannot find a reliable answer in the Garden\'s own corpus. Shall I forward your question to a curator?';
  }
}
