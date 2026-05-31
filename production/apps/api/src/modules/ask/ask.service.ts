/**
 * AskTheGarden RAG pipeline (ADR-0005).
 *
 * Flow per ADR:
 *   1. Classify intent (on_topic | off_topic | harmful) — keyword tiered with
 *      a model-backed fallback. Persisted on AskMessage.intent.
 *   2. Translate question to canonical English when locale ≠ en (kept
 *      separate from the *response* prompt so the donor still gets a
 *      reply in their locale).
 *   3. Embed canonical-EN via Ollama nomic-embed-text:v1.5.
 *   4. Cosine top-12 from pgvector (locale + EN fallback).
 *   5. Rerank with bge-reranker-v2-m3 (text-embeddings-inference); on
 *      arm64 macOS the rerank service is skipped and we fall back to
 *      raw vector scores.
 *   6. If top score < confidenceThreshold → escalation template, no LLM.
 *   7. Stream from Ollama llama3.x with a system prompt that enforces
 *      inline citation markers [c1]…[cN].
 *   8. Validate every [cN] points at a retrieved chunk *and* the answer
 *      contains at least one marker. Reject + regen once at temperature
 *      0.2; if still invalid, fall back to the escalation template.
 *   9. Persist AskMessage + AskAnswer + retrievedChunkIds + reaction.
 */
import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { request } from 'undici';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { searchWeb, type WebResult } from './web-search.js';
import { chunkText } from '@bloomoulu/rag';

const OLLAMA_BASE = process.env.OLLAMA_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434';
// Hosted OpenAI-compatible LLM (e.g. Groq). When LLM_BASE_URL is set, all text
// GENERATION is routed there; embeddings always stay on the local Ollama.
const LLM_BASE_URL = (process.env.LLM_BASE_URL ?? '').replace(/\/$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY ?? '';
const USE_HOSTED_LLM = LLM_BASE_URL.length > 0;
const LLM_MODEL = USE_HOSTED_LLM
  ? (process.env.LLM_MODEL ?? 'llama-3.3-70b-versatile')
  : (process.env.OLLAMA_LLM_MODEL ?? process.env.LLM_MODEL ?? 'llama3.2:1b');
const LLM_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? 512);
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? process.env.EMBED_MODEL ?? 'nomic-embed-text:v1.5';
const RERANKER_BASE = process.env.RERANKER_BASE_URL ?? 'http://reranker:8080';

const PROFANITY: Record<'en' | 'fi' | 'sv', RegExp> = {
  en: /\b(fuck|shit|asshole|bitch|cunt|nigger|faggot|retard)\b/i,
  fi: /\b(vittu|saatana|paska|huora|neekeri|homo)\b/i,
  sv: /\b(fan|jävla|skit|hora|neger|bög)\b/i,
};
const HARMFUL_HINTS = [
  /\bweapon|gun|bomb|kill|murder|terrorist|suicide|self[- ]harm\b/i,
  /\b(child|minor).{0,15}(porn|abuse|sex)\b/i,
];
const OFF_TOPIC_HINTS = [
  /\bpolitic|election|trump|biden|putin|israel|gaza|hamas\b/i,
  /\b(porn|nude|nsfw)\b/i,
  /\b(stock|crypto|bitcoin|investment advice)\b/i,
  /\b(homework|essay|write\s+me\s+(code|a\s+poem|a\s+story|a\s+script|a\s+python|a\s+javascript)|javascript|python|java\b|c\+\+)\b/i,
  /\b(tell\s+me\s+a\s+(joke|story|poem)|sing\s+a\s+song)\b/i,
  /\b(weather|temperature|forecast|rain|snow)\b(?!.{0,30}\b(plant|bloom|garden|seed)\b)/i,
  /\b(sports|football|hockey|basketball|olympics|world cup)\b/i,
  /\b(translate|translation)\b(?!.{0,30}\b(plant|species|name)\b)/i,
];
const ALLOWED_HINTS = [
  /\b(plant|flower|tree|bloom|leaf|stem|root|seed|moss|fern|fungi|lichen|orchid)\b/i,
  /\b(garden|trädgård|puutarha|oulu|botanic)\b/i,
  /\b(red list|endangered|conservation|biodiversity|species|finnish flora|life\+|escape)\b/i,
  /\b(adopt|donate|donation|sponsor|tier)\b/i,
  /\b(latin|family|genus|taxon|accession|narration|audio)\b/i,
  /\b(kasvi|kukka|puu|kukinta|adoptio|sammal|orkidea|jäkälä)\b/i,
  /\b(växt|blomma|träd|adoptera|mossa|lav)\b/i,
];

// Greetings, thanks, and small-talk openers. Each pattern anchors to
// the full message so "Hi, when does Trollius bloom?" still routes to
// RAG. We allow common trailers ("there", "all", "garden") AND
// composite forms like "hey, how are you?" or "hi how's it going?".
const GREET_WORD = `(hi+|hello+|hey+|yo|heya|hej(san)?|hei|moi(kka)?|terve|tere|tervehdys|tervetuloa|hola|salut|bonjour|guten\\s+tag)`;
const GREET_TRAILER = `(\\s+(there|all|y'all|everyone|guys|folks|garden|bot|friend|chatbot))?[\\s!.?,]*$`;
const SMALL_TALK = `(how('?s| is)\\s+it\\s+going|how\\s+are\\s+(you|things)|how\\s+have\\s+you\\s+been|what'?s\\s+(up|new|happening|good)|sup|how'?s\\s+everything|nice\\s+to\\s+(meet|see)\\s+you)`;
const GREETING_HINTS = [
  // Plain greeting (optionally with trailer): "Hi", "Hello there!", "Hej friend"
  new RegExp(`^\\s*${GREET_WORD}${GREET_TRAILER}`, 'i'),
  // Greeting + small-talk: "hey how are you?", "Hi, how's it going?"
  new RegExp(`^\\s*${GREET_WORD}[\\s,]+${SMALL_TALK}\\??[\\s!.?,]*$`, 'i'),
  // Time-of-day greetings: "Good morning", "Good evening!"
  new RegExp(`^\\s*good\\s+(morning|afternoon|evening|day)${GREET_TRAILER}`, 'i'),
  // Standalone small-talk: "How are you?", "What's up?"
  new RegExp(`^\\s*${SMALL_TALK}\\??[\\s!.?,]*$`, 'i'),
  // Thanks
  /^\s*(thanks|thank\s+you|thx|ty|cheers|kiitos|tack|merci|appreciate(\s+it)?)(\s+(a\s+lot|so\s+much|very\s+much))?[\s!.?,]*$/i,
  // Bye
  /^\s*(bye|goodbye|farewell|cya|see\s+you(\s+later)?|take\s+care|hyvästi|näkemiin|hej\s+då)[\s!.?,]*$/i,
];
// Meta-questions about the service itself — what is this, who are you,
// what is a botanical garden, how does this work. These deserve a real
// reply explaining the service, not a "ask a curator" deflection.
const META_HINTS = [
  /\bwhat (is|are) (this|you|askthegarden|the (system|app|bot|service|site))\b/i,
  /\bwho are you\b/i,
  /\bhow (does (this|it)|do (you|i)) (work|use|ask)\b/i,
  /\bwhat (can|could|do) you (do|know|tell|help)\b/i,
  /\bwhat is (a|an|the)?\s*(botanical\s+garden|garden|collection)\b/i,
  /^(mikä|mitä) (tämä|on) /i, // FI: "Mitä tämä on?" / "Mikä tämä on?"
  /\b(vad är|vad gör)\b/i, // SV: any "Vad är ..." / "Vad gör ..."
  /\b(mikä on|mitä on) (kasvitieteellinen|tämä|askthegarden)/i, // FI meta
];

export type AskIntent = 'on_topic' | 'off_topic' | 'harmful' | 'greeting' | 'meta';

export function classifyQuestion(text: string, locale: 'en' | 'fi' | 'sv'): {
  allow: boolean;
  intent: AskIntent;
  reason?: 'profanity' | 'off_topic' | 'harmful';
} {
  const t = text.trim();
  if (!t) return { allow: false, intent: 'off_topic', reason: 'off_topic' };
  if (HARMFUL_HINTS.some((re) => re.test(t))) {
    return { allow: false, intent: 'harmful', reason: 'harmful' };
  }
  if (PROFANITY[locale].test(t) || PROFANITY.en.test(t)) {
    return { allow: false, intent: 'harmful', reason: 'profanity' };
  }
  // Full-string greeting match (the regex itself anchors to end). No
  // length cap needed.
  if (GREETING_HINTS.some((re) => re.test(t))) {
    return { allow: true, intent: 'greeting' };
  }
  // Meta-questions about the service itself.
  if (META_HINTS.some((re) => re.test(t))) {
    return { allow: true, intent: 'meta' };
  }
  if (ALLOWED_HINTS.some((re) => re.test(t))) return { allow: true, intent: 'on_topic' };
  if (OFF_TOPIC_HINTS.some((re) => re.test(t))) {
    return { allow: false, intent: 'off_topic', reason: 'off_topic' };
  }
  return { allow: true, intent: 'on_topic' };
}

const SYSTEM_PROMPT: Record<'en' | 'fi' | 'sv', string> = {
  en: `You are AskTheGarden, the conservation guide of the University of Oulu Botanical Garden. You answer questions about the 7,954 plants in our living collection.

How to answer:
- Write naturally and warmly, the way a knowledgeable garden guide speaks to a visitor. Friendly, informative, never robotic.
- One to four sentences usually. Longer only when the answer genuinely needs detail.
- Plain prose. No bullet points, no headers, no markdown.
- Use periods and commas. Do not use em-dashes or en-dashes anywhere.
- Contractions are welcome ("we have", "it's", "you'll").
- Just answer. Skip openers like "According to the context" or "Based on the records".
- Do not write citation markers like [c1] or [c2]. No brackets, no superscripts, no source numbers in the text.

Conversation context:
- When a <conversation> block appears before <context>, it shows the dialogue so far. Use it to resolve references like "it", "they", "that one" and to stay continuous with what you already said.
- Do NOT repeat full information you already gave the user. Build on it. If you already listed X, Y, Z, expand on ONE of them with a new angle (history, ecology, conservation, how it grows, where it's from, why it matters). Bring fresh details from the Context that the user has not seen yet.
- If the user replies with a short affirmation like "yes", "please", "sure", "go ahead", or "tell me more", treat that as a request for MORE depth on the topic you just offered. Pick a specific aspect you haven't covered yet and elaborate. NEVER repeat the same sentence or list verbatim.
- When a <resolvedQuestion> block appears, it's the literal short message expanded into a focused deep-dive question. Answer the resolved question with new information from the Context.

What the Context covers:
- Plant entries (species in the living collection: family, common names, conservation status, bloom season, accessions count).
- Family-level summaries (carnivorous plants, conifers, orchids, ferns, succulents, aquatic plants, etc.).
- Conservation summaries (counts by Red List status).
- Garden information: opening hours, admission, location, parking, the Romeo and Julia greenhouses, outdoor garden, guided tours, history, research programmes, contact details, accessibility, and climate.

Grounding (important):
- Use only facts that appear inside the Context. Never invent species names, families, accession counts, hours, prices, addresses, phone numbers, or dates.
- If the question is on-topic for a botanical garden but the Context truly does not contain the answer, offer a warm, helpful response that:
  1. Acknowledges what you don't have ("I don't have that in our records").
  2. Suggests a useful next step (ask Curator Anna Liisa Ruotsalainen, check the official site oulu.fi/en/university/botanical-garden, try BGCI PlantSearch or GBIF for plants not in our collection, try Pl@ntNet for image ID).
- For plant-care questions ("how do I water…", "best soil for…"), say honestly that the garden is a research collection, not a horticultural advice service, and suggest the curator or RHS / Chicago Botanic Garden plant info services.
- Stay friendly even when redirecting. End with an offer to help with something else in the garden.

Examples — study the tone:

Question: When does Trollius europaeus bloom?
Context: Trollius europaeus, family Ranunculaceae, blooms in June; 28 accessions.
Answer: Trollius europaeus, the globeflower, blooms in June. We hold 28 accessions of it.

Question: Tell me about Hedera helix.
Context: Hedera helix, family Araliaceae, 15 accessions.
Answer: Hedera helix is the common English ivy, a climbing plant in the Araliaceae family. We have 15 accessions in the collection.

Question: When are you open?
Context: Outdoor garden 8:00–20:00 every day; greenhouses Tue–Sun 10:00–16:00, closed Mondays.
Answer: Our outdoor garden is open every day from 8 in the morning to 8 in the evening, and the Romeo and Julia greenhouses are open Tuesday through Sunday from 10 to 4. The greenhouses are closed on Mondays.

Question: Where are you located?
Context: Kaitoväylä 5, Linnanmaa campus, near Lake Kuivasjärvi; coordinates 65.06N, 25.47E.
Answer: We're at Kaitoväylä 5 on the University of Oulu's Linnanmaa campus, in the northern corner of the campus next to Lake Kuivasjärvi.

Question: How much does it cost to visit?
Context: Voluntary 5 € admission covering both garden and greenhouses; MobilePay 12657.
Answer: Admission is a voluntary 5 €, which covers both the outdoor garden and the Romeo and Julia greenhouses. You can pay via MobilePay 12657 or by bank transfer.

Question: How do I take care of my houseplant?
Context: (only plant catalogue entries, no care guides)
Answer: We're a research and conservation collection rather than a horticultural advice service, so I don't have care guides here. Curator Anna Liisa Ruotsalainen is happy to help with specific questions; the RHS and Chicago Botanic Garden also run free plant care help lines. Anything I can help with about our collection?

Question: What's the capital of France?
Context: (only plant entries; question is off-topic)
Answer: That's outside what I can help with. I'm here for questions about the University of Oulu Botanical Garden, our plants, visiting, and conservation. Anything you'd like to know on those?`,
  fi: `Olet AskTheGarden, Oulun yliopiston kasvitieteellisen puutarhan opastin. Vastaat kysymyksiin kokoelman 7 954 kasvista.

Kuinka vastaat:
- Kirjoita luonnollisesti, kuten asiantunteva puutarhanopastaja puhuisi kävijälle.
- Yksi, kaksi tai kolme lausetta. Pitempi vain kun aihe sitä todella vaatii.
- Selkeää proosaa. Ei luetteloita, ei otsikoita, ei muotoiluja.
- Käytä pisteitä ja pilkkuja. Älä käytä pitkiä viivoja missään muodossa.
- Älä keksi lajeja, sukuja, kappalemääriä tai uhanalaisuusluokkia.
- Älä kirjoita viitemerkintöjä kuten [c1] tai [c2].

Esimerkit:

Kysymys: Milloin Trollius europaeus kukkii?
Konteksti: Trollius europaeus, Ranunculaceae, kukkii kesäkuussa; 28 yksilöä.
Vastaus: Trollius europaeus, kullero, kukkii kesäkuussa. Kokoelmassamme on 28 yksilöä.

Kysymys: Mikä on kasvitieteellinen puutarha?
Konteksti: (vain Hedera helix)
Vastaus: Minulla ei ole luotettavaa vastausta tähän kokoelmastamme.`,
  sv: `Du är AskTheGarden, guiden för Uleåborgs universitets botaniska trädgård. Du svarar på frågor om de 7 954 växterna i vår levande samling.

Hur du svarar:
- Skriv naturligt och samtalsorienterat, som en kunnig trädgårdsguide.
- En till tre meningar oftast. Längre bara när ämnet kräver det.
- Klar prosa. Inga punktlistor, inga rubriker, ingen markdown.
- Använd punkter och kommatecken. Använd inte tankstreck i någon form.
- Hitta inte på arter, familjer, antal eller rödlistestatus.
- Skriv inga citatmarkörer som [c1] eller [c2].

Exempel:

Fråga: När blommar Trollius europaeus?
Kontext: Trollius europaeus, Ranunculaceae, blommar i juni; 28 exemplar.
Svar: Trollius europaeus, smörbollen, blommar i juni. Vi har 28 exemplar i samlingen.

Fråga: Vad är en botanisk trädgård?
Kontext: (endast Hedera helix)
Svar: Jag har inte ett tillförlitligt svar på det i vår samling.`,
};

export interface AskResult {
  text: string;
  citations: Array<{ marker: string; chunkId: string }>;
  escalated: boolean;
  messageId: string;
  intent: AskIntent;
  modelUsed: string;
}

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Streaming entry point. `onDelta` fires for every token chunk the LLM
   *  emits; the resolved value carries the final text + citations.
   *  `history` is the recent conversation (last N turns) used for
   *  follow-up resolution and given to the LLM during generation. */
  async answerStream(
    question: string,
    locale: 'en' | 'fi' | 'sv',
    userId: string | undefined,
    onDelta?: (text: string) => void,
    history: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }> = [],
  ): Promise<AskResult> {
    // 1. Guardrail. We classify the ORIGINAL message (not the rewrite)
    // because greetings and off-topic intents apply to what the user
    // actually typed.
    const decision = classifyQuestion(question, locale);
    const messageRow = await this.prisma.askMessage.create({
      data: {
        text: question,
        locale,
        userId: userId ?? null,
        intent: decision.intent,
      },
    });
    if (!decision.allow) {
      const text = this.guardrailMessage(locale, decision.reason ?? 'off_topic');
      onDelta?.(text);
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
      return {
        text,
        citations: [],
        escalated: true,
        messageId: messageRow.id,
        intent: decision.intent,
        modelUsed: 'guardrail',
      };
    }

    // Greetings and service-meta questions don't need retrieval — answer
    // from a fixed friendly template so we don't waste latency on a
    // doomed embedding/rerank pass that would then escalate to a curator
    // (a bad UX for "Hi" or "What is this site?").
    if (decision.intent === 'greeting' || decision.intent === 'meta') {
      const text =
        decision.intent === 'greeting'
          ? this.greetingResponse(locale)
          : this.metaResponse(locale);
      onDelta?.(text);
      await this.prisma.askAnswer.create({
        data: {
          messageId: messageRow.id,
          text,
          modelUsed: `template:${decision.intent}`,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          retrievedChunkIds: [],
        },
      });
      return {
        text,
        citations: [],
        escalated: false,
        messageId: messageRow.id,
        intent: decision.intent,
        modelUsed: `template:${decision.intent}`,
      };
    }

    // 1b. Multi-turn rewrite. When the user follows up with an anaphoric
    // message like "tell me more about it" or "what's its bloom time?",
    // retrieval needs the resolved subject ("Trollius europaeus") to
    // find anything. We call the LLM once to rewrite the latest message
    // as a self-contained question, using the recent history. Cheap
    // when history is empty (skip), and on simple cases the rewriter
    // returns the original verbatim.
    const recentHistory = history.slice(-6); // last 6 turns max
    const standalone =
      recentHistory.length > 0
        ? await this.rewriteAsStandaloneQuestion(question, recentHistory, locale).catch(() => question)
        : question;

    // 2. For non-English locales, retrieve using BOTH the original and an
    // English-translated query and union the candidate chunks before
    // reranking. bge-m3 is multilingual but cross-lingual query/document
    // similarity is weaker than monolingual, so the translation gives a
    // second pass that catches sentences the original embed misses
    // ("Milloin kullero kukkii?" via "When does the globeflower bloom?").
    const queryForEmbedding = standalone;
    const translatedQuery =
      locale === 'en' ? null : await this.translateToEn(standalone, locale).catch(() => null);

    // 3. Embed. If the model isn't available (Ollama down, model not
    // pulled), escalate gracefully rather than returning a 500.
    const embedding = await this.embed(queryForEmbedding).catch((err) => {
      this.logger.warn(`Embedding failed (${(err as Error).message}); escalating`);
      return null;
    });
    if (!embedding) {
      return this.emitEscalation(messageRow.id, locale, decision.intent, onDelta, 'embed_unavailable');
    }

    // 4. Hybrid retrieval (vector + FTS + fuzzy, fused with RRF).
    //    For non-English locales, run a second retrieval pass on the
    //    English translation and union the candidate set so the reranker
    //    sees both monolingual and cross-lingual top hits.
    const chunks = await this.retrieve(embedding, locale, queryForEmbedding);
    let combined = chunks;
    if (translatedQuery && translatedQuery !== queryForEmbedding && translatedQuery.length > 3) {
      const translatedEmbedding = await this.embed(translatedQuery).catch(() => null);
      if (translatedEmbedding) {
        const extra = await this.retrieve(translatedEmbedding, locale, translatedQuery);
        const byId = new Map(chunks.map((c) => [c.id, c]));
        for (const e of extra) if (!byId.has(e.id)) byId.set(e.id, e);
        combined = Array.from(byId.values());
      }
    }

    // 5. Rerank against the English translation when available — bge-
    // reranker-v2-m3 is multilingual but cross-lingual query/document
    // scoring is much weaker than monolingual ("Visa mig orkidéer" vs
    // English Orchidaceae chunk scores 0.0003; "Show me orchids" scores
    // 0.70). For EN queries this collapses to the original.
    const rerankQuery =
      translatedQuery && translatedQuery.length > 3 ? translatedQuery : queryForEmbedding;
    const reranked = combined.length > 0 ? await this.rerank(rerankQuery, combined) : [];

    // 6. Score floor + web-search augmentation.
    //    Two thresholds:
    //      • hardFloor  (default 0.001) — below this, in-corpus retrieval
    //        failed; we MUST have web results or escalate to curator.
    //      • augmentBand (0.001 to 0.25) — corpus matched something but
    //        the top score is mediocre. Augment with a live Wikipedia
    //        lookup so the LLM has both signals.
    //    Above 0.25, corpus alone is strong enough; skip the web call.
    const thresholdBp = this.settings.get().ask.confidenceThresholdBp;
    const hardFloor = thresholdBp / 10_000;
    const augmentBand = 0.25;
    const top = reranked[0];
    let webResults: WebResult[] = [];
    if (!top || top.score < augmentBand) {
      // Use the standalone (rewritten) query for the web search and
      // prefer English Wikipedia regardless of locale because it has
      // the broadest species coverage.
      webResults = await searchWeb(queryForEmbedding, 'en');
      // Persist web results to the corpus so the second query on the
      // same topic finds them via normal hybrid retrieval (no Wikipedia
      // round-trip needed). Fire-and-forget — never blocks the user
      // response. The cache lives under titles `__web__:wikipedia:<slug>`
      // so it's easy to invalidate / TTL later.
      if (webResults.length > 0) {
        this.persistWebResultsToCorpus(webResults).catch((err) => {
          this.logger.warn(`Web-result persistence failed: ${(err as Error).message}`);
        });
      }
    }
    if ((!top || top.score < hardFloor) && webResults.length === 0) {
      // Genuinely nothing — escalate to the curator.
      const text = this.escalation(locale);
      onDelta?.(text);
      await this.prisma.askAnswer.create({
        data: {
          messageId: messageRow.id,
          text,
          modelUsed: 'escalation',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          escalatedAt: new Date(),
          retrievedChunkIds: [],
        },
      });
      return {
        text,
        citations: [],
        escalated: true,
        messageId: messageRow.id,
        intent: decision.intent,
        modelUsed: 'escalation',
      };
    }

    // 7. Generate (streamed). Build the context block once.
    // XML tags help small open-weight models stay grounded — gemma3 / llama3
    // tokenize `<context>` as a single boundary token and won't blur it into
    // free text. Each chunk is labelled [c1]..[c5]; we strip those markers
    // from the final user-facing text via postProcessAnswer(), but the
    // LLM still sees them so it can ground each claim to a specific chunk.
    const top5 = reranked.slice(0, 5);
    const corpusEntries = top5.map((c) => c.text);
    const webEntries = webResults.map(
      (w) => `From ${new URL(w.url).host} ("${w.title}"): ${w.text}`,
    );
    const allEntries = [...corpusEntries, ...webEntries];
    const contextBlock = allEntries
      .map((t, i) => `[c${i + 1}] ${t}`)
      .join('\n\n');
    const conversationBlock =
      recentHistory.length > 0
        ? `<conversation>\n${recentHistory
            .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
            .join('\n')}\n</conversation>\n\n`
        : '';
    const webNotice =
      webResults.length > 0
        ? `\n\nNote: ${webResults.length} of the context entries above were fetched live from Wikipedia (you can spot them by the "From <host>" prefix). Treat them as authoritative for general botany or world facts the garden's catalogue doesn't cover.\n\nWhen you use a Wikipedia entry, do NOT say "I don't have that information in our records" — that's misleading. Instead lead with the answer and briefly attribute the source. Good phrasings: "From what Wikipedia tells us…", "According to Wikipedia…", "Wikipedia describes it as…". Then, if appropriate, mention what the garden's own catalogue does and doesn't have on this topic.`
        : '';
    // If the rewriter resolved a short/anaphoric message into a different
    // self-contained question, include both so the LLM has the resolved
    // intent without losing the user's literal words. Otherwise just the
    // original message goes in the prompt.
    const showResolved =
      standalone &&
      standalone !== question &&
      standalone.length > question.length + 4;
    const questionBlock = showResolved
      ? `<question>\n${question}\n</question>\n<resolvedQuestion>\n${standalone}\n</resolvedQuestion>`
      : `<question>\n${question}\n</question>`;
    const userPrompt =
      `${conversationBlock}<context>\n${contextBlock}\n</context>${webNotice}\n\n${questionBlock}`;

    const t0 = Date.now();
    let generation: string;
    try {
      generation = await this.generateStreamed(SYSTEM_PROMPT[locale], userPrompt, 0.7, onDelta);
    } catch (err) {
      this.logger.warn(`LLM generation failed (${(err as Error).message}); escalating`);
      return this.emitEscalation(messageRow.id, locale, decision.intent, onDelta, 'llm_unavailable');
    }
    let latency = Date.now() - t0;

    // 8. Validate citation markers. Every [cN] must reference a retrieved
    // chunk; the answer must contain at least one marker (ADR-0005). If
    // either invariant fails, regen once with temperature=0.2.
    //
    // Special case: when the model emits the exact refusal phrase from
    // SYSTEM_PROMPT, that's not a violation — it's the model correctly
    // detecting that the retrieved context doesn't actually answer the
    // user's question (e.g. user typed just "Venus flytrap" with no
    // verb). Route those to the escalation flow without a wasted regen.
    if (this.isIntentionalRefusal(generation, locale)) {
      this.logger.log('LLM refused (intentional); routing to escalation');
      return this.emitEscalation(
        messageRow.id,
        locale,
        decision.intent,
        // Don't re-stream — the refusal was already streamed.
        undefined,
        'llm_refused',
      );
    }
    let validation = this.validateCitations(generation, top5.length);
    let regenCount = 0;
    if (!validation.ok) {
      this.logger.warn(`Citation invariant violated (${validation.reason}); regenerating once`);
      regenCount = 1;
      const t1 = Date.now();
      generation = await this.generateStreamed(
        SYSTEM_PROMPT[locale],
        userPrompt +
          `\n\nReminder: every claim must end with [cN] and [cN] must reference one of the context blocks above.`,
        0.2,
        // Don't stream the regen to the client — we already streamed once.
        undefined,
      );
      latency += Date.now() - t1;
      validation = this.validateCitations(generation, top5.length);
    }

    // If the regenerated answer still lacks valid markers, fall back to
    // the escalation template — better to ask for a curator than to ship
    // an unsourced reply.
    if (!validation.ok) {
      this.logger.warn(`Citation invariant still violated after regen (${validation.reason}); escalating`);
      const text = this.escalation(locale);
      onDelta?.(`\n\n${text}`);
      await this.prisma.askAnswer.create({
        data: {
          messageId: messageRow.id,
          text,
          modelUsed: 'escalation:invalid_citations',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: latency,
          escalatedAt: new Date(),
          retrievedChunkIds: top5.map((c) => c.id),
        },
      });
      return {
        text,
        citations: [],
        escalated: true,
        messageId: messageRow.id,
        intent: decision.intent,
        modelUsed: 'escalation:invalid_citations',
      };
    }

    // 9. Persist. We still record retrievedChunkIds for audit / future
    // citation surfacing, but the user-facing text is scrubbed of any
    // bracketed markers and em-dashes via postProcessAnswer().
    const cleaned = this.postProcessAnswer(generation);
    const citations = validation.markersUsed.map((n) => ({
      marker: `[c${n}]`,
      chunkId: top5[n - 1]!.id,
    }));
    await this.prisma.askAnswer.create({
      data: {
        messageId: messageRow.id,
        text: cleaned,
        modelUsed: regenCount > 0 ? `${LLM_MODEL}+regen` : LLM_MODEL,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: latency,
        retrievedChunkIds: top5.map((c) => c.id),
      },
    });
    // Snapshot citations linked to Citation rows where possible.
    if (citations.length > 0) {
      const chunkIds = citations.map((c) => c.chunkId);
      const chunkRows = await this.prisma.ragChunk.findMany({
        where: { id: { in: chunkIds } },
        select: { id: true, citationId: true },
      });
      const byId = new Map(chunkRows.map((r) => [r.id, r.citationId]));
      const answer = await this.prisma.askAnswer.findUnique({ where: { messageId: messageRow.id } });
      if (answer) {
        await this.prisma.askAnswerCitation.createMany({
          data: citations
            .map((c, i) => ({
              answerId: answer.id,
              citationId: byId.get(c.chunkId) ?? null,
              marker: c.marker,
              rank: i + 1,
            }))
            .filter((c): c is typeof c & { citationId: string } => Boolean(c.citationId)),
        });
      }
    }

    // Bump Plant.askCount for every plant whose chunks contributed to
    // this answer. Counts "this plant came up in an answer" once per
    // answer — three chunks from the same plant = one ask, not three.
    // Best-effort: a failure here must not break the user's answer.
    try {
      const retrievedIds = top5.map((c) => c.id);
      if (retrievedIds.length > 0) {
        const chunksForCounter = await this.prisma.ragChunk.findMany({
          where: { id: { in: retrievedIds }, plantId: { not: null } },
          select: { plantId: true },
        });
        const distinctPlantIds = Array.from(
          new Set(chunksForCounter.map((c) => c.plantId).filter((id): id is string => Boolean(id))),
        );
        if (distinctPlantIds.length > 0) {
          await this.prisma.plant.updateMany({
            where: { id: { in: distinctPlantIds } },
            data: { askCount: { increment: 1 } },
          });
        }
      }
    } catch {
      // Observability: counter drift is acceptable; user experience is not.
    }

    return {
      text: cleaned,
      citations,
      escalated: false,
      messageId: messageRow.id,
      intent: decision.intent,
      modelUsed: regenCount > 0 ? `${LLM_MODEL}+regen` : LLM_MODEL,
    };
  }

  /** Non-streaming wrapper used by tests + the JSON endpoint. */
  async answer(question: string, locale: 'en' | 'fi' | 'sv', userId?: string): Promise<AskResult> {
    return this.answerStream(question, locale, userId);
  }

  /** Stream the escalation template + persist a corresponding AskAnswer
   *  row. Used whenever the pipeline cannot produce a grounded reply
   *  (low score, infra unavailable, citation invariant violated). */
  private async emitEscalation(
    messageId: string,
    locale: 'en' | 'fi' | 'sv',
    intent: AskIntent,
    onDelta: ((text: string) => void) | undefined,
    reason: string,
  ): Promise<AskResult> {
    const text = this.escalation(locale);
    onDelta?.(text);
    await this.prisma.askAnswer.create({
      data: {
        messageId,
        text,
        modelUsed: `escalation:${reason}`,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        escalatedAt: new Date(),
        retrievedChunkIds: [],
      },
    });
    return {
      text,
      citations: [],
      escalated: true,
      messageId,
      intent,
      modelUsed: `escalation:${reason}`,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /** Persist a batch of web-search results into the RAG corpus so future
   *  queries on the same topic can find them via the normal hybrid
   *  retrieval path. This is the "real-time RAG" behaviour: a question
   *  the bot can't answer triggers a Wikipedia fetch, the answer is
   *  cached, and a similar question later goes straight to corpus.
   *
   *  Keyed by `__web__:wikipedia:<lang>:<slug>` so the entries are easy
   *  to spot, easy to invalidate by prefix, and don't collide with
   *  curator-managed plant or family docs.
   *
   *  Async fire-and-forget — never delays the user's response. Embedding
   *  cost is amortized: only paid once per unique topic. */
  private async persistWebResultsToCorpus(results: WebResult[]): Promise<void> {
    const embedModel = process.env.OLLAMA_EMBED_MODEL ?? process.env.EMBED_MODEL ?? 'bge-m3';
    for (const result of results) {
      try {
        let host: string;
        let slug: string;
        try {
          const u = new URL(result.url);
          host = u.host;
          slug = (u.pathname.split('/').pop() ?? '').toLowerCase();
        } catch {
          continue;
        }
        if (!slug) continue;
        const lang = host.split('.')[0] ?? 'en';
        const title = `__web__:wikipedia:${lang}:${slug}`;
        const body = `# ${result.title}\n\nSource: ${result.url}\n\n${result.text}`;
        const bodyHash = createHash('sha256').update(body).digest('hex');
        // Skip if we already have an identical-body chunk.
        const existing = await this.prisma.ragDocument.findFirst({
          where: { title, locale: 'en' },
          select: { id: true, bodyHash: true, _count: { select: { chunks: true } } },
        });
        if (existing && existing.bodyHash === bodyHash && existing._count.chunks > 0) {
          continue;
        }
        const chunks = chunkText(body, { size: 500, overlap: 50 });
        const embeddings = await Promise.all(
          chunks.map((c) =>
            request(`${OLLAMA_BASE}/api/embeddings`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ model: embedModel, prompt: c }),
            })
              .then((r) => r.body.json())
              .then((j) => (j as { embedding: number[] }).embedding),
          ),
        );
        await this.prisma.$transaction(async (tx) => {
          let docId: string;
          if (existing) {
            await tx.ragChunk.deleteMany({ where: { documentId: existing.id } });
            const u = await tx.ragDocument.update({
              where: { id: existing.id },
              data: { body, bodyHash, isPublished: true },
            });
            docId = u.id;
          } else {
            const c = await tx.ragDocument.create({
              data: { title, locale: 'en', body, bodyHash, isPublished: true },
            });
            docId = c.id;
          }
          for (let i = 0; i < chunks.length; i++) {
            const vec = `[${embeddings[i]!.join(',')}]`;
            await tx.$executeRawUnsafe(
              `INSERT INTO "RagChunk" (id, "documentId", "chunkIndex", text, "tokenStart", "tokenEnd", locale, embedding)
               VALUES (gen_random_uuid(), $1::uuid, $2::int, $3, $4::int, $5::int, $6::"Locale", $7::vector)`,
              docId,
              i,
              chunks[i],
              0,
              chunks[i]!.length,
              'en',
              vec,
            );
          }
        });
        this.logger.log(`Cached web result to corpus: ${title}`);
      } catch (err) {
        this.logger.warn(`Failed to persist web result "${result.title}": ${(err as Error).message}`);
      }
    }
  }

  /** Rewrite a follow-up question as a self-contained one using recent
   *  conversation history. Resolves anaphora (it / they / that), fills
   *  in implied subjects ("more about Trollius europaeus"), and keeps
   *  the language of the original message. If the latest message is
   *  already self-contained, the rewriter returns it unchanged.
   *
   *  This is the LangChain `create_history_aware_retriever` pattern:
   *  one LLM call before retrieval whose output goes into the embedder.
   *  Cost ~300-500ms with gemma3:4b; only runs when history is non-empty. */
  private async rewriteAsStandaloneQuestion(
    question: string,
    history: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>,
    locale: 'en' | 'fi' | 'sv',
  ): Promise<string> {
    const transcript = history
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
      .join('\n');
    const sys =
      `You rewrite a chat user's latest message into a self-contained search query that will retrieve NEW useful information.\n` +
      `\n` +
      `Rules:\n` +
      `- Resolve pronouns (it, they, that, this) using the conversation above.\n` +
      `- When the latest message is just "yes", "sure", "please", "tell me more", or similar confirmation: look at the LAST assistant turn for the offer it just made. If it offered specific named options ("Would you like to know more about A, or perhaps about B?"), pick ONE of those EXACT options and rewrite "yes" as a specific question about that named option. Do NOT invent a different aspect — the user is consenting to what was already offered. If the offer was open-ended ("Would you like to know more about this plant?"), then pick a specific aspect (history, discovery, habitat, conservation, ecology, related species) that has not been covered yet in the conversation.\n` +
      `- Preserve the user's language (English, Finnish, or Swedish — do NOT translate).\n` +
      `- If the latest message is already self-contained, repeat it VERBATIM.\n` +
      `- A message is self-contained when it names a specific subject (species name, place, topic) without pronouns: "Tell me about Rafflesia", "When does Trollius bloom?".\n` +
      `- Output ONLY the rewritten question, nothing else. No quotes, no explanation, no preface.\n` +
      `- Keep the rewrite short (max 25 words).\n` +
      `\n` +
      `Examples:\n` +
      `\n` +
      `Conversation:\n` +
      `User: When does Trollius europaeus bloom?\n` +
      `Assistant: It blooms in June.\n` +
      `Latest: tell me more about it\n` +
      `Rewrite: what is the habitat and conservation status of Trollius europaeus\n` +
      `\n` +
      `Conversation:\n` +
      `User: Tell me about Wollemi pine.\n` +
      `Assistant: We have one accession of Wollemia nobilis. Would you like to know more about this living fossil?\n` +
      `Latest: yes\n` +
      `Rewrite: when was Wollemi pine discovered and where does it grow in the wild\n` +
      `\n` +
      `Conversation:\n` +
      `User: Are there any carnivorous plants in the collection?\n` +
      `Assistant: Yes, 23 Droseraceae, 20 Lentibulariaceae, 13 Nepenthaceae, 10 Sarraceniaceae. Would you like me to tell you more about any of those families?\n` +
      `Latest: yes\n` +
      `Rewrite: tell me about the Droseraceae sundews and how they catch insects\n` +
      `\n` +
      `Conversation:\n` +
      `User: how does the Venus flytrap catch insects?\n` +
      `Assistant: Two hinged lobes snap shut when trigger hairs are stimulated. Would you like to know more about the specific enzymes involved, or perhaps how the plant detects the touch?\n` +
      `Latest: yes\n` +
      `Rewrite: what specific digestive enzymes does the Venus flytrap use to break down insect prey\n` +
      `\n` +
      `Conversation:\n` +
      `User: tell me about Trollius europaeus\n` +
      `Assistant: Globeflower, blooms June, 28 accessions. Would you like to know about its habitat or its conservation status?\n` +
      `Latest: yes\n` +
      `Rewrite: what habitat does Trollius europaeus prefer\n` +
      `\n` +
      `Conversation:\n` +
      `User: What ferns do you have?\n` +
      `Assistant: We have wood ferns, lady ferns, royal ferns.\n` +
      `Latest: which is the rarest?\n` +
      `Rewrite: which fern in the collection is the rarest or most endangered\n` +
      `\n` +
      `Conversation:\n` +
      `User: how do I adopt a plant?\n` +
      `Assistant: Pick a tier, choose a plant, pay.\n` +
      `Latest: Tell me about Rafflesia\n` +
      `Rewrite: Tell me about Rafflesia\n` +
      `\n` +
      `Conversation:\n` +
      `User: When are you open?\n` +
      `Assistant: 8 to 8 every day for the outdoor garden.\n` +
      `Latest: Where are you located?\n` +
      `Rewrite: Where are you located?\n`;
    try {
      const raw = await this.llmComplete(
        `${sys}\n\nConversation:\n${transcript}\nLatest: ${question}\nRewrite:`,
        { temperature: 0.1, maxTokens: 80 },
      );
      const rewritten = raw
        .trim()
        .replace(/^["'`]|["'`]$/g, '')
        .replace(/^Rewrite:\s*/i, '')
        .trim();
      // Sanity guards: rewrite must be 2-300 chars and not a refusal /
      // explanation. If it doesn't look like a question/phrase, fall back.
      if (rewritten.length < 2 || rewritten.length > 300) return question;
      if (/^(i (don'?t|cannot)|sorry|here is|the user)/i.test(rewritten)) return question;
      this.logger.log(`Rewrite: "${question}" -> "${rewritten}"`);
      return rewritten;
    } catch (err) {
      this.logger.warn(`Standalone-rewrite failed: ${(err as Error).message}`);
      return question;
    }
  }

  /** Translate a question to canonical English for retrieval and rerank.
   *  Includes a short botany glossary so the small model preserves plant
   *  vocabulary (gemma3:4b mistranslates "kullero" as "poppy" without
   *  hints). Falls back to the raw text on any error. */
  private async translateToEn(text: string, locale: 'en' | 'fi' | 'sv'): Promise<string> {
    if (locale === 'en') return text;
    const language = locale === 'fi' ? 'Finnish' : 'Swedish';
    const glossary =
      locale === 'fi'
        ? [
            'kullero = globeflower (Trollius europaeus)',
            'kihokki = sundew (Drosera)',
            'kärpäsloukku = Venus flytrap (Dionaea muscipula)',
            'lapinvuokko = Arctic mountain avens (Dryas octopetala)',
            'mänty = pine (Pinus)',
            'kuusi = spruce (Picea)',
            'koivu = birch (Betula)',
            'puolukka = lingonberry (Vaccinium vitis-idaea)',
            'mustikka = bilberry (Vaccinium myrtillus)',
            'lakka / hilla = cloudberry (Rubus chamaemorus)',
            'kanerva = heather (Calluna vulgaris)',
            'vuokko = anemone',
            'lehtokielo = lily of the valley (Convallaria majalis)',
            'kämmekkä = orchid (Orchidaceae)',
            'orkidea = orchid',
            'kukinta / kukkii = bloom / blooms',
          ]
        : [
            'smörboll = globeflower (Trollius europaeus)',
            'rundsileshår = sundew (Drosera rotundifolia)',
            'venusflugfälla = Venus flytrap',
            'tall = pine (Pinus)',
            'gran = spruce (Picea)',
            'björk = birch (Betula)',
            'lingon = lingonberry (Vaccinium vitis-idaea)',
            'blåbär = bilberry (Vaccinium myrtillus)',
            'hjortron = cloudberry (Rubus chamaemorus)',
            'ljung = heather (Calluna vulgaris)',
            'liljekonvalj = lily of the valley',
            'orkidé / orkidéer = orchid / orchids',
            'blomma / blommar = bloom / blooms',
          ];
    const sys =
      `Translate the user's botanical-garden question from ${language} to English. ` +
      `Use this plant-name glossary so you preserve species correctly:\n${glossary.join('\n')}\n` +
      `Reply with ONLY the English translation. No quotes, no explanation, no preface.`;
    try {
      const raw = await this.llmComplete(`${sys}\n\nQuestion: ${text}\n\nEnglish:`, {
        temperature: 0.1,
        maxTokens: 200,
      });
      const translated = raw.trim().replace(/^["']|["']$/g, '');
      return translated.length > 3 ? translated : text;
    } catch (err) {
      this.logger.warn(`Translation failed, embedding raw text: ${(err as Error).message}`);
      return text;
    }
  }

  /** Non-streaming text completion. Routes to the hosted OpenAI-compatible
   *  endpoint (e.g. Groq /chat/completions) when LLM_BASE_URL is set, else to
   *  the local Ollama /api/generate. */
  private async llmComplete(
    prompt: string,
    opts: { temperature?: number; maxTokens?: number; numCtx?: number } = {},
  ): Promise<string> {
    const { temperature = 0.1, maxTokens = LLM_MAX_TOKENS, numCtx = 2048 } = opts;
    if (USE_HOSTED_LLM) {
      const res = await request(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });
      const json = (await res.body.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content ?? '';
    }
    const res = await request(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt,
        stream: false,
        options: { temperature, num_ctx: numCtx, num_predict: maxTokens },
      }),
    });
    const json = (await res.body.json()) as { response?: string };
    return json.response ?? '';
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

  /**
   * Hybrid retrieval — runs three retrievers in parallel and fuses their
   * rankings with Reciprocal Rank Fusion (RRF). Per published benchmarks
   * (ParadeDB, Tiger Data, dasroot.net 2025), this lifts precision from
   * ~62% (pure dense) to ~84% with negligible added latency.
   *
   *   1. Dense vector  (pgvector cosine)  — semantic intent
   *   2. tsvector      (Postgres FTS)     — exact-token recall
   *   3. pg_trgm       (trigram fuzzy)    — typo / partial-word tolerance
   *
   * RRF score(d) = Σ_r 1 / (k + rank_r(d))   with k = 60.
   * k=60 is the standard from the original Cormack 2009 paper — lower
   * values over-weight rank 1, higher flatten the curve.
   *
   * All three lookups run in one round-trip via a CTE so we don't pay
   * three network round-trips. Locale gate: prefer chunks in the same
   * locale, fall back to English.
   */
  private async retrieve(embedding: number[], locale: string, queryText: string) {
    const vec = `[${embedding.join(',')}]`;
    // tsquery friendly form — strip operators that break to_tsquery and
    // fall back to plainto_tsquery (safer for arbitrary user input).
    const ftsQuery = queryText.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; text: string; score: number }>
    >(
      `WITH vector_hits AS (
         SELECT id, text, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS r
         FROM "RagChunk"
         WHERE locale IN ($2::"Locale", 'en'::"Locale")
           AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 30
       ),
       fts_hits AS (
         -- The tsvector column is multi-language: english-stemmed
         -- ("conifers" → "conifer"), finnish-stemmed ("kihokkeja" →
         -- "kihokki"), swedish-stemmed, plus simple-tokenized for Latin
         -- binomials. Query union of all four configs catches morphology
         -- in every supported locale.
         SELECT id, text,
                ROW_NUMBER() OVER (
                  ORDER BY ts_rank_cd("searchVector",
                    plainto_tsquery('english', $3) ||
                    plainto_tsquery('finnish', $3) ||
                    plainto_tsquery('swedish', $3) ||
                    plainto_tsquery('simple', $3)
                  ) DESC
                ) AS r
         FROM "RagChunk"
         WHERE locale IN ($2::"Locale", 'en'::"Locale")
           AND "searchVector" @@ (
                 plainto_tsquery('english', $3) ||
                 plainto_tsquery('finnish', $3) ||
                 plainto_tsquery('swedish', $3) ||
                 plainto_tsquery('simple', $3)
               )
         ORDER BY ts_rank_cd("searchVector",
                    plainto_tsquery('english', $3) ||
                    plainto_tsquery('finnish', $3) ||
                    plainto_tsquery('swedish', $3) ||
                    plainto_tsquery('simple', $3)
                  ) DESC
         LIMIT 30
       ),
       trgm_hits AS (
         SELECT id, text,
                ROW_NUMBER() OVER (ORDER BY similarity(text, $3) DESC) AS r
         FROM "RagChunk"
         WHERE locale IN ($2::"Locale", 'en'::"Locale")
           AND text % $3
         ORDER BY similarity(text, $3) DESC
         LIMIT 10
       ),
       fused AS (
         SELECT id,
                MAX(text) AS text,
                SUM(rrf) AS score
         FROM (
           SELECT id, text, 1.0 / (60 + r) AS rrf FROM vector_hits
           UNION ALL
           SELECT id, text, 1.0 / (60 + r) AS rrf FROM fts_hits
           UNION ALL
           SELECT id, text, 1.0 / (60 + r) AS rrf FROM trgm_hits
         ) u
         GROUP BY id
       )
       SELECT id, text, score::float8 AS score
       FROM fused
       ORDER BY score DESC
       LIMIT 12`,
      vec,
      locale,
      ftsQuery,
    );
    // If FTS / trigram are empty for a fully-novel query, the CTE still
    // returns vector hits (since UNION ALL just leaves the fts/trgm
    // branches empty). No special-case needed.
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

  /** Real Ollama token streaming. Ollama's /api/generate?stream=true
   *  responds NDJSON; we parse line-by-line and surface each `response`
   *  chunk via onDelta. */
  private async generateStreamed(
    system: string,
    user: string,
    temperature: number,
    onDelta?: (text: string) => void,
  ): Promise<string> {
    if (USE_HOSTED_LLM) {
      const res = await request(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature,
          max_tokens: LLM_MAX_TOKENS,
          stream: true,
        }),
      });
      if (res.statusCode >= 300) {
        const t = await res.body.text();
        throw new Error(`LLM ${res.statusCode}: ${t.slice(0, 200)}`);
      }
      let full = '';
      let buffer = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Buffer>) {
        buffer += chunk.toString('utf8');
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            buffer = '';
            break;
          }
          try {
            const piece = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = piece.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              full += delta;
              onDelta?.(delta);
            }
          } catch {
            // partial SSE line — wait for next chunk
          }
        }
      }
      return full.trim();
    }
    const res = await request(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        system,
        prompt: user,
        stream: true,
        options: { temperature, num_ctx: 4096 },
      }),
    });
    if (res.statusCode >= 300) {
      const t = await res.body.text();
      throw new Error(`Ollama ${res.statusCode}: ${t.slice(0, 200)}`);
    }
    let full = '';
    let buffer = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Buffer>) {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const piece = JSON.parse(line) as { response?: string; done?: boolean };
          if (typeof piece.response === 'string' && piece.response.length > 0) {
            full += piece.response;
            onDelta?.(piece.response);
          }
          if (piece.done) {
            buffer = '';
            break;
          }
        } catch {
          // partial line — wait for next chunk
        }
      }
    }
    return full.trim();
  }

  /** Detect whether the LLM intentionally refused (matches the exact
   *  refusal phrase from SYSTEM_PROMPT in any locale). When true, the
   *  caller routes to the escalation flow instead of regenerating.
   *  Intentional refusal is a feature, not a citation-invariant bug.
   *
   *  Normalizes curly/typographic apostrophes (`’` `‘` `` ` ``) to the
   *  ASCII form so "I don't have…" and "I don’t have…" both match. */
  private isIntentionalRefusal(text: string, locale: 'en' | 'fi' | 'sv'): boolean {
    const normalized = text.toLowerCase().replace(/[’‘`´]/g, "'").trim();
    const patterns: Record<typeof locale, RegExp[]> = {
      en: [/i\s+don'?t\s+have\s+a\s+reliable\s+answer/, /do\s+not\s+have\s+a\s+reliable\s+answer/],
      fi: [/minulla\s+ei\s+ole\s+luotettavaa\s+vastausta/],
      sv: [/jag\s+har\s+inte\s+ett\s+tillförlitligt\s+svar/],
    };
    return patterns[locale].some((p) => p.test(normalized));
  }

  /** Light sanity check on the generated answer. The new system prompt
   *  asks the model to NOT emit [cN] markers in user-facing text, so
   *  the marker-presence check from ADR-0005 is relaxed — we only ensure
   *  there's a real answer and no out-of-range markers if any leak. The
   *  hallucination guard is now the system prompt + chunk grounding;
   *  intentional refusals route through isIntentionalRefusal() above. */
  private validateCitations(
    text: string,
    contextCount: number,
  ): { ok: true; markersUsed: number[] } | { ok: false; reason: string } {
    const trimmed = text.trim();
    if (trimmed.length < 6) return { ok: false, reason: 'empty_response' };
    if (contextCount === 0) return { ok: false, reason: 'no_context' };
    const matches = [...trimmed.matchAll(/\[c(\d+)\]/g)];
    const used: number[] = [];
    for (const m of matches) {
      const n = Number.parseInt(m[1] ?? '0', 10);
      if (n < 1 || n > contextCount) {
        return { ok: false, reason: `marker_out_of_range:${n}` };
      }
      if (!used.includes(n)) used.push(n);
    }
    return { ok: true, markersUsed: used };
  }

  /** Strip any [c1]-style markers and stray em/en-dashes the model leaked
   *  despite the prompt. Belt-and-suspenders cleanup before the answer
   *  hits the user. */
  private postProcessAnswer(text: string): string {
    return text
      // Drop bracketed citation markers: [c1], [c1,c2], [c1-c5], etc.
      .replace(/\s*\[c[\d,\s-]+\]/g, '')
      // Replace em/en-dashes with simple commas (the model occasionally
      // ignores the "no em-dash" rule and a comma reads cleanly almost
      // everywhere a dash would have).
      .replace(/\s*[—–]\s*/g, ', ')
      // Collapse the double-spaces those replacements can leave.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
  }

  // ─── Templates ────────────────────────────────────────────────────────

  private escalation(locale: 'en' | 'fi' | 'sv'): string {
    const name = this.settings.get().ask.curatorName;
    const sla = this.settings.get().ask.curatorReplySlaDays;
    if (locale === 'fi') {
      return `Tähän en löydä luotettavaa vastausta puutarhan omasta tietokannasta. Välitänkö kysymyksesi puutarhurille (${name})? Hän vastaa tyypillisesti ${sla} työpäivän kuluessa.`;
    }
    if (locale === 'sv') {
      return `Jag hittar inte ett tillförlitligt svar i trädgårdens egen databas. Vidarebefordrar jag din fråga till trädgårdsmästaren (${name})? Hen svarar typiskt inom ${sla} arbetsdagar.`;
    }
    return `I cannot find a reliable answer in the Garden's own corpus. Shall I forward your question to Curator ${name}? They typically reply within ${sla} working days.`;
  }

  /** Friendly greeting reply. No em-dashes, natural tone. */
  private greetingResponse(locale: 'en' | 'fi' | 'sv'): string {
    if (locale === 'fi') {
      return 'Hei! Olen AskTheGarden, Oulun yliopiston kasvitieteellisen puutarhan opastin. Voin kertoa kasveistamme, niiden kukinta-ajoista, uhanalaisuusluokituksista ja kokoelman määristä. Kokeile sivupalkin ehdotuksia tai kysy lajista, josta haluat tietää lisää.';
    }
    if (locale === 'sv') {
      return 'Hej! Jag är AskTheGarden, guiden för Uleåborgs universitets botaniska trädgård. Jag kan berätta om våra växter, deras blomningstider och rödlistestatus. Prova ett av förslagen i sidofältet eller fråga om en art du är nyfiken på.';
    }
    return "Hi! I'm AskTheGarden, the guide for the University of Oulu Botanical Garden's living collection. I can tell you about our plants, their bloom seasons, conservation status, and how many of each we hold. Try one of the suggestions in the sidebar, or just name a species you're curious about.";
  }

  /** Friendly reply to "what is this / how does it work" questions. */
  private metaResponse(locale: 'en' | 'fi' | 'sv'): string {
    if (locale === 'fi') {
      return 'AskTheGarden vastaa kysymyksiin Oulun yliopiston kasvitieteellisen puutarhan elävän kokoelman 7 954 kasvista. Toimii parhaiten täsmällisillä kysymyksillä, esimerkiksi "Milloin Trollius europaeus kukkii?" tai "Mitkä kasvit ovat uhanalaisia Suomessa?". Aloita sivupalkin ehdotuksilla.';
    }
    if (locale === 'sv') {
      return 'AskTheGarden besvarar frågor om de 7 954 växterna i Uleåborgs universitets botaniska trädgårds levande samling. Den fungerar bäst med konkreta frågor, till exempel "När blommar Trollius europaeus?" eller "Vilka växter är rödlistade?". Börja med ett av förslagen i sidofältet.';
    }
    return 'AskTheGarden answers questions about the 7,954 plants in the University of Oulu Botanical Garden\'s living collection. It works best with specific questions, like "When does Trollius europaeus bloom?" or "Which plants here are endangered in Finland?". Try one of the suggestions in the sidebar to get started.';
  }

  private guardrailMessage(locale: 'en' | 'fi' | 'sv', reason: 'profanity' | 'off_topic' | 'harmful'): string {
    if (reason === 'profanity' || reason === 'harmful') {
      if (locale === 'fi') return 'Pidetään kysymykset asiallisina. Olen täällä auttaakseni kasveihin liittyvissä asioissa.';
      if (locale === 'sv') return 'Låt oss hålla frågorna sakliga. Jag är här för att hjälpa till med växtfrågor.';
      return "Let's keep questions respectful. I'm here to help with plants and the Garden.";
    }
    if (locale === 'fi')
      return 'Voin auttaa vain kysymyksissä, jotka koskevat kasveja, Oulun kasvitieteellistä puutarhaa ja Suomen luonnonsuojelua. Kokeile vasemman palstan ehdotuksia.';
    if (locale === 'sv')
      return 'Jag kan bara hjälpa till med frågor om växter, Uleåborgs botaniska trädgård och finsk naturvård. Prova ett av förslagen till vänster.';
    return "I can only help with questions about plants, our garden, and Finnish conservation. Try one of the suggestions on the left.";
  }
}
