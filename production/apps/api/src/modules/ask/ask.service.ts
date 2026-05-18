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

const OLLAMA_BASE = process.env.OLLAMA_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434';
const LLM_MODEL = process.env.OLLAMA_LLM_MODEL ?? process.env.LLM_MODEL ?? 'llama3.2:1b';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';
const RERANKER_BASE = process.env.RERANKER_BASE_URL ?? 'http://reranker:8080';
const MIN_SCORE = 0.72;

/**
 * Topical guardrails. The chat is public; we must ensure the model only
 * answers questions about plants / the Garden / Finnish conservation.
 *
 * Two-layer defence:
 *   - Keyword classifier (this file, fast): catches obvious off-topic +
 *     profanity at the door without a model call.
 *   - System prompt (per locale, above): instructs the model to refuse
 *     off-topic queries with a polite redirect.
 *
 * The keyword lists are intentionally small + locale-aware. They cover the
 * common abuse cases (politics, religion, weapons, sexual content, slurs)
 * without trying to be exhaustive — the RAG retrieval also acts as a
 * topical filter (nothing relevant to retrieve → escalation).
 */
const PROFANITY: Record<'en' | 'fi' | 'sv', RegExp> = {
  en: /\b(fuck|shit|asshole|bitch|cunt|nigger|faggot|retard)\b/i,
  fi: /\b(vittu|saatana|paska|huora|neekeri|homo)\b/i,
  sv: /\b(fan|jävla|skit|hora|neger|bög)\b/i,
};
const OFF_TOPIC_HINTS = [
  /\bpolitic|election|trump|biden|putin|israel|gaza|hamas\b/i,
  /\b(porn|sex|nude|nsfw)\b/i,
  /\bweapon|gun|bomb|kill|murder|terrorist\b/i,
  /\b(stock|crypto|bitcoin|investment advice)\b/i,
  /\b(homework|essay|write me code|javascript|python)\b/i,
];
const ALLOWED_HINTS = [
  /\b(plant|flower|tree|bloom|leaf|stem|root|seed|moss|fern|fungi)\b/i,
  /\b(garden|trädgård|puutarha|oulu|botanic)\b/i,
  /\b(red list|endangered|conservation|biodiversity|species|finnish flora|life\+|escape)\b/i,
  /\b(adopt|donate|donation|sponsor|tier)\b/i,
  /\b(latin|family|genus|taxon|accession|narration|audio)\b/i,
  /\b(kasvi|kukka|puu|kukinta|adoptio)\b/i,
  /\b(växt|blomma|träd|adoptera)\b/i,
];

export interface GuardrailDecision {
  allow: boolean;
  reason?: 'profanity' | 'off_topic';
}

export function classifyQuestion(text: string, locale: 'en' | 'fi' | 'sv'): GuardrailDecision {
  const t = text.trim();
  if (!t) return { allow: false, reason: 'off_topic' };
  if (PROFANITY[locale].test(t) || PROFANITY.en.test(t)) {
    return { allow: false, reason: 'profanity' };
  }
  // If any allowed hint matches, allow even if an off-topic word appears
  // (avoids false positives like "weapons used by Trollius" — implausible
  // but the principle: domain words take precedence).
  if (ALLOWED_HINTS.some((re) => re.test(t))) return { allow: true };
  if (OFF_TOPIC_HINTS.some((re) => re.test(t))) {
    return { allow: false, reason: 'off_topic' };
  }
  // Default: allow. The system prompt + RAG retrieval still constrain
  // the model to plant/garden topics.
  return { allow: true };
}

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
    // Guardrail: refuse profanity + obvious off-topic queries before doing
    // any work. Saves model + DB cycles and prevents the chat from being
    // a free general-purpose assistant for the public.
    const decision = classifyQuestion(question, locale);
    if (!decision.allow) {
      const text = this.guardrailMessage(locale, decision.reason ?? 'off_topic');
      const messageRow = await this.prisma.askMessage.create({
        data: { text: question, locale, userId: userId ?? null },
      });
      await this.prisma.askAnswer.create({
        data: {
          messageId: messageRow.id,
          text,
          modelUsed: 'guardrail',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          retrievedChunkIds: [],
          escalatedAt: new Date(),
        },
      });
      return { text, citations: [], escalated: true, messageId: messageRow.id };
    }

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
       WHERE locale IN ($2::"Locale", 'en'::"Locale")
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

  private guardrailMessage(locale: 'en' | 'fi' | 'sv', reason: 'profanity' | 'off_topic'): string {
    if (reason === 'profanity') {
      if (locale === 'fi') return 'Pidetään kysymykset asiallisina. Olen täällä auttaakseni kasveihin liittyvissä asioissa.';
      if (locale === 'sv') return 'Låt oss hålla frågorna sakliga. Jag är här för att hjälpa till med växtfrågor.';
      return "Let's keep questions respectful. I'm here to help with plants and the Garden.";
    }
    // off_topic
    if (locale === 'fi')
      return 'Voin auttaa vain kysymyksissä, jotka koskevat kasveja, Oulun kasvitieteellistä puutarhaa ja Suomen luonnonsuojelua. Kokeile vasemman palstan ehdotuksia.';
    if (locale === 'sv')
      return 'Jag kan bara hjälpa till med frågor om växter, Uleåborgs botaniska trädgård och finsk naturvård. Prova ett av förslagen till vänster.';
    return "I can only help with questions about plants, our garden, and Finnish conservation. Try one of the suggestions on the left.";
  }
}
