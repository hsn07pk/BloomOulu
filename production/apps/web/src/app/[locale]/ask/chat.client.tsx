'use client';
/**
 * AskTheGarden chat — SSE streaming + citation chips (with source title) +
 * helpful / off-base / escalate reactions + 3-column shell (sidebar,
 * messages, sources + corpus stats + curator-audit metric).
 *
 * Streaming contract from /v1/ask/stream:
 *   start  — { question, locale }
 *   delta  — { text } (Ollama token chunks)
 *   final  — { text, citations: [{ marker, chunkId, title, page, year }],
 *              escalated, messageId, intent, modelUsed }
 *   error  — { message }
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';

type Locale = 'en' | 'fi' | 'sv';

export interface AskSettings {
  curatorEmail: string;
  curatorName: string;
  curatorReplySlaDays: number;
  confidenceThresholdBp: number;
  auditErrorTarget: number;
  outOfDomain: { bgci: string; gbif: string; plantnet: string };
}

export interface CorpusStats {
  plants: number;
  ragDocs: number;
  citations: number;
  accessions: number;
}

export interface AuditMetric {
  window: number;
  offBase: number;
  errorRate: number;
  target: number;
}

interface Citation {
  marker: string;
  chunkId: string;
  title?: string;
  page?: string | null;
  year?: number | null;
  // Per-plant citations resolve to the Plant.slug and its primary photo
  // so the chat bubble can render the image + a link to the plant page.
  plantSlug?: string | null;
  sourceUrl?: string | null;
  image?: { url: string; attribution: string; licenseSpdx: string } | null;
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  escalated?: boolean;
  streaming?: boolean;
  reaction?: 'helpful' | 'off_base' | 'escalated' | null;
  messageId?: string;
  /** 'on_topic' answers get reactions + source chips; 'greeting' and
   *  'meta' get a softer chrome with no reactions (you can't really
   *  rate "Hi!"). */
  intent?: 'on_topic' | 'off_topic' | 'harmful' | 'greeting' | 'meta';
  modelUsed?: string;
}

type AskMode = 'visitor' | 'staff';
const RECENT_KEY = 'bloom_ask_recent';

/** Strip [c1]-style citation markers and em/en-dashes from any text the
 *  model emits. The new prompt asks for clean prose without them, but
 *  small models occasionally slip — this is the display-time guard. */
function cleanForDisplay(text: string): string {
  return text
    .replace(/\s*\[c[\d,\s-]+\]/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trimEnd();
}

export default function AskChat({
  locale,
  starters,
  staffStarters,
  signedIn = false,
  staffEligible = false,
  userId = null,
  corpusStats,
  auditMetric,
  ask,
  contactEmailDefault,
  apiUrl,
  initialPrompt = null,
  autoSendInitial = false,
}: {
  locale: Locale;
  starters: string[];
  staffStarters: string[];
  signedIn?: boolean;
  staffEligible?: boolean;
  userId?: string | null;
  corpusStats: CorpusStats | null;
  auditMetric: AuditMetric | null;
  ask: AskSettings;
  contactEmailDefault: string | null;
  apiUrl: string;
  /** Seed text for the input composer. When set, the chat opens with
   *  this question already typed; combined with `autoSendInitial` it
   *  fires the first request automatically — used by the "Ask the
   *  Garden about this plant" link on the plant detail page. */
  initialPrompt?: string | null;
  autoSendInitial?: boolean;
}) {
  // The server component passes the browser-side URL as a prop so the
  // bundle isn't dependent on build-time env-var inlining. Trailing
  // slashes get normalised so `${API}/v1/ask/stream` is always clean.
  const API = apiUrl.replace(/\/$/, '');
  const t = useTranslations('Ask');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState(initialPrompt ?? '');
  const [busy, setBusy] = useState(false);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [mode, setMode] = useState<AskMode>('visitor');
  const [recent, setRecent] = useState<string[]>([]);
  // Layout breakpoint: <= 920px folds the 3-column grid into a single
  // column with the starters/sources panels stacked below the chat. Read
  // once on mount + on resize so SSR doesn't break (we default to 'wide'
  // and let the first client effect correct it).
  const [layout, setLayout] = useState<'wide' | 'narrow'>('wide');
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 920px)');
    const apply = () => setLayout(mq.matches ? 'narrow' : 'wide');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
      setRecent(list.slice(0, 8));
    } catch {
      /* ignore */
    }
  }, []);

  function pushRecent(q: string) {
    setRecent((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Auto-fire the seeded question once on mount. Used by the "Ask the
  // Garden about this plant" link so the donor lands on the chat with
  // the first response already streaming, no extra click required.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (!autoSendInitial || !initialPrompt) return;
    autoFiredRef.current = true;
    void ask_(initialPrompt);
    // ask_ is stable enough for an on-mount fire; intentional one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newConversation() {
    setTurns([]);
    setActiveTurn(null);
    setInput('');
    setTimeout(() => composerRef.current?.focus(), 50);
  }

  async function ask_(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    pushRecent(question.trim());
    const userTurnId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setTurns((tt) => [
      ...tt,
      { id: userTurnId, role: 'user', text: question },
      { id: assistantId, role: 'assistant', text: '', streaming: true },
    ]);
    setActiveTurn(assistantId);
    setInput('');

    // Recent conversation context for multi-turn follow-ups. Server
    // rewrites anaphoric questions ("tell me more about it") using this
    // history before retrieving, and gives the LLM the same context for
    // generation. We cap at the last 6 turns and trim long assistant
    // replies so the prompt stays compact for gemma3:4b.
    const recentHistory = turns
      .slice(-6)
      .filter((tn) => !tn.streaming && tn.text)
      .map((tn) => ({
        role: tn.role,
        text: tn.text.length > 800 ? tn.text.slice(0, 800) : tn.text,
      }));
    try {
      const res = await fetch(`${API}/v1/ask/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          question,
          locale,
          userId: userId ?? undefined,
          history: recentHistory,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = 'message';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === 'delta') {
            setTurns((all) =>
              all.map((tn) =>
                tn.id === assistantId
                  ? { ...tn, text: cleanForDisplay(tn.text + payload.text) }
                  : tn,
              ),
            );
          } else if (event === 'final') {
            setTurns((all) =>
              all.map((tn) =>
                tn.id === assistantId
                  ? {
                      ...tn,
                      text: cleanForDisplay(payload.text),
                      citations: payload.citations,
                      escalated: payload.escalated,
                      streaming: false,
                      messageId: payload.messageId,
                      intent: payload.intent,
                      modelUsed: payload.modelUsed,
                    }
                  : tn,
              ),
            );
          } else if (event === 'error') {
            throw new Error(payload.message ?? 'stream error');
          }
        }
      }
    } catch (err) {
      setTurns((all) =>
        all.map((tn) =>
          tn.id === assistantId
            ? { ...tn, text: `${t('thinking')} → ${(err as Error).message}`, streaming: false }
            : tn,
        ),
      );
    } finally {
      setBusy(false);
      setTimeout(() => composerRef.current?.focus(), 50);
    }
  }

  async function react(turn: Turn, reaction: 'helpful' | 'off_base' | 'escalated') {
    if (!turn.messageId) return;
    try {
      await fetch(`${API}/v1/ask/react`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: turn.messageId,
          reaction,
          contactEmail: reaction === 'escalated' ? contactEmailDefault ?? undefined : undefined,
        }),
      });
      setTurns((all) => all.map((tn) => (tn.id === turn.id ? { ...tn, reaction } : tn)));
    } catch {
      /* best-effort */
    }
  }

  // Default the right-rail sources to the latest grounded answer so the
  // user sees what backed it without having to click. Templates and
  // escalations have no citations — those fall back to the empty hint.
  const lastAnswerWithCitations = [...turns].reverse().find(
    (tn) => tn.role === 'assistant' && (tn.citations?.length ?? 0) > 0,
  );
  const active =
    turns.find((tn) => tn.id === activeTurn) ?? lastAnswerWithCitations ?? null;
  const activeCitations = active?.citations ?? [];

  return (
    <div
      className="ask-shell"
      style={{
        display: 'grid',
        gridTemplateColumns: layout === 'wide' ? '280px 1fr 320px' : '1fr',
        gap: layout === 'wide' ? 24 : 16,
        marginTop: 24,
      }}
    >
      <aside
        className="card card-pad"
        style={{
          alignSelf: 'flex-start',
          position: layout === 'wide' ? 'sticky' : 'static',
          top: layout === 'wide' ? 24 : undefined,
          order: layout === 'narrow' ? 2 : 0,
        }}
        aria-label={t('starters')}
      >
        {staffEligible && (
          <div
            role="group"
            aria-label={locale === 'fi' ? 'Tila' : locale === 'sv' ? 'Läge' : 'Mode'}
            style={{
              display: 'flex',
              padding: 4,
              background: 'rgba(31,58,44,0.06)',
              borderRadius: 999,
              marginBottom: 12,
            }}
          >
            {(
              [
                ['visitor', locale === 'fi' ? 'Kävijä' : locale === 'sv' ? 'Besökare' : 'Visitor'],
                ['staff', locale === 'fi' ? 'Henkilökunta' : locale === 'sv' ? 'Personal' : 'Staff'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 999,
                  fontSize: '0.867rem',
                  background: mode === id ? 'var(--paper)' : 'transparent',
                  color: mode === id ? 'var(--ink)' : 'var(--ink-mute)',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: mode === id ? '0 1px 4px rgba(31,58,44,0.08)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {signedIn && (
          <button
            type="button"
            onClick={newConversation}
            className="btn btn-secondary"
            style={{ width: '100%', marginBottom: 16, fontSize: '0.867rem' }}
          >
            ➕ {locale === 'fi' ? 'Uusi keskustelu' : locale === 'sv' ? 'Ny konversation' : 'New conversation'}
          </button>
        )}

        <div className="tiny" style={{ marginBottom: 8 }}>
          {mode === 'staff'
            ? locale === 'fi'
              ? 'Nopeat henkilökuntatoimet'
              : locale === 'sv'
                ? 'Snabba personalåtgärder'
                : 'Quick staff actions'
            : locale === 'fi'
              ? 'Suosittua tänään'
              : locale === 'sv'
                ? 'Trendar idag'
                : 'Trending today'}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(mode === 'staff' ? staffStarters : starters).map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => ask_(s)}
                disabled={busy}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                  borderRadius: 10, fontSize: '0.867rem', color: 'var(--ink-soft)', background: 'transparent',
                  border: 0, lineHeight: 1.4, cursor: busy ? 'default' : 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(31,58,44,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>

        {recent.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 20, paddingTop: 16 }}>
            <div className="tiny" style={{ marginBottom: 8 }}>
              {locale === 'fi' ? 'Viimeisimmät' : locale === 'sv' ? 'Senaste' : 'Recent'}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {recent.slice(0, 5).map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => ask_(q)}
                    disabled={busy}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 10,
                      fontSize: '0.867rem',
                      color: 'var(--ink-mute)',
                      background: 'transparent',
                      border: 0,
                      lineHeight: 1.4,
                      cursor: busy ? 'default' : 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={q}
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section aria-labelledby="ask-h" style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="additions"
          tabIndex={-1}
          ref={logRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            background: 'var(--paper)',
            border: '1px solid var(--line)',
            borderRadius: 16,
            minHeight: 420,
            maxHeight: 'calc(100vh - 360px)',
          }}
        >
          {turns.length === 0 && (
            <WelcomeBubble locale={locale} starters={starters} onPick={ask_} />
          )}
          {turns.map((tn) => {
            // Template replies (greeting, meta) get a softer visual treatment:
            // no reaction bar, no source chips, no escalation tag. Reactions
            // make no sense on "Hi!" and surface UI clutter for no benefit.
            const isTemplate =
              tn.role === 'assistant' &&
              (tn.intent === 'greeting' ||
                tn.intent === 'meta' ||
                (tn.modelUsed?.startsWith('template:') ?? false));
            // Escalations (corpus didn't answer / off-topic) get amber chrome
            // so the user can immediately see this isn't a substantive reply.
            const isEscalation = tn.role === 'assistant' && tn.escalated && !isTemplate;
            const bg =
              tn.role === 'user'
                ? 'var(--sage-pale)'
                : isEscalation
                  ? 'rgba(184,81,58,0.06)'
                  : isTemplate
                    ? 'rgba(45,84,64,0.04)'
                    : 'var(--cream)';
            const borderColor =
              tn.role === 'assistant' && activeTurn === tn.id && !isTemplate
                ? 'var(--forest-mid)'
                : isEscalation
                  ? 'rgba(184,81,58,0.18)'
                  : 'transparent';
            return (
              <article
                key={tn.id}
                data-role={tn.role}
                data-template={isTemplate || undefined}
                onClick={() => tn.role === 'assistant' && !isTemplate && setActiveTurn(tn.id)}
                style={{
                  marginBottom: 14,
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: bg,
                  cursor: tn.role === 'assistant' && !isTemplate ? 'pointer' : 'default',
                  border: `1px solid ${borderColor}`,
                  transition: 'border-color 120ms ease',
                }}
              >
                {tn.role === 'assistant' && (
                  <div
                    aria-hidden="true"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 8,
                      fontSize: '0.733rem',
                      color: 'var(--ink-mute)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        background: isEscalation
                          ? 'rgba(184,81,58,0.12)'
                          : 'var(--sage-pale)',
                        color: isEscalation ? 'var(--rust-on-light)' : 'var(--forest)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.8rem',
                      }}
                    >
                      {isEscalation ? '↗' : '🌿'}
                    </span>
                    <span>
                      {isEscalation
                        ? locale === 'fi'
                          ? 'Ohjaus puutarhurille'
                          : locale === 'sv'
                            ? 'Vidarebefordran'
                            : 'Curator referral'
                        : 'AskTheGarden'}
                    </span>
                  </div>
                )}
                <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6 }}>
                  {tn.text}
                  {tn.streaming && <span aria-hidden="true">▍</span>}
                </p>
                {/* Plant photo gallery — pulled from per-plant citations
                 *  that came back with an image. Multiple distinct plants
                 *  in the answer each get one card; duplicates dedupe by
                 *  slug. */}
                {tn.role === 'assistant' && !tn.streaming && (tn.citations?.length ?? 0) > 0 && (
                  <PlantImageGallery citations={tn.citations!} locale={locale} />
                )}
                {/* Source pills hidden for now (user request). The
                 *  citations payload is still received so we can re-enable
                 *  them later without touching the API. */}
                {!isTemplate &&
                  tn.role === 'assistant' &&
                  !tn.streaming &&
                  tn.messageId && (
                    <div
                      style={{
                        marginTop: 12,
                        display: 'flex',
                        gap: 6,
                        paddingTop: 10,
                        borderTop: '1px solid var(--line)',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      {(['helpful', 'off_base', 'escalated'] as const).map((r) => {
                        const label =
                          r === 'helpful'
                            ? t('helpful')
                            : r === 'off_base'
                              ? t('offBase')
                              : t('escalate');
                        const glyph = r === 'helpful' ? '👍' : r === 'off_base' ? '👎' : '↗';
                        const active = tn.reaction === r;
                        const palette =
                          r === 'helpful'
                            ? 'var(--sage-pale)'
                            : r === 'off_base'
                              ? 'var(--amber-soft)'
                              : 'var(--rust-soft)';
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              react(tn, r);
                            }}
                            aria-pressed={active}
                            className="pill"
                            style={{
                              padding: '4px 12px',
                              fontSize: '0.733rem',
                              background: active ? palette : 'rgba(45,84,64,0.05)',
                              border: active
                                ? '1px solid rgba(45,84,64,0.15)'
                                : '1px solid transparent',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span aria-hidden="true">{glyph}</span>
                            {label}
                          </button>
                        );
                      })}
                      {tn.reaction === 'escalated' && (
                        <span
                          className="tiny"
                          style={{ color: 'var(--forest)', marginLeft: 4 }}
                        >
                          ✓{' '}
                          {locale === 'fi'
                            ? `Välitetty puutarhurille (${ask.curatorName}).`
                            : locale === 'sv'
                              ? `Vidarebefordrat till trädgårdsmästaren (${ask.curatorName}).`
                              : `Forwarded to ${ask.curatorName}.`}
                        </span>
                      )}
                    </div>
                  )}
              </article>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) ask_(input.trim());
          }}
          style={{ marginTop: 12, display: 'flex', gap: 8 }}
        >
          <label htmlFor="ask-input" className="sr-only">
            {t('placeholder')}
          </label>
          <textarea
            ref={composerRef}
            id="ask-input"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim()) ask_(input.trim());
              }
            }}
            placeholder={t('placeholder')}
            disabled={busy}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 999,
              border: '1px solid var(--line)',
              background: 'var(--paper)',
              fontSize: '1rem',
              resize: 'none',
              minHeight: 44,
            }}
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary" style={{ padding: '10px 22px' }}>
            {busy ? t('thinking') : t('send')}
          </button>
        </form>
        <p
          className="tiny"
          style={{
            textAlign: 'center',
            marginTop: 12,
            textTransform: 'none',
            letterSpacing: 0,
            lineHeight: 1.55,
          }}
        >
          {locale === 'fi'
            ? `Vastaukset perustuvat puutarhan kokoelmaan. Jos asia jää epävarmaksi, voimme välittää kysymyksen puutarhurille (${ask.curatorName}).`
            : locale === 'sv'
              ? `Svaren bygger på trädgårdens samling. Vid osäkerhet kan vi vidarebefordra frågan till trädgårdsmästaren (${ask.curatorName}).`
              : `Answers are drawn from the Garden's living collection. If something looks off, we can forward your question to Curator ${ask.curatorName}.`}
        </p>
      </section>

      <aside
        className="card card-pad"
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          order: layout === 'narrow' ? 3 : 0,
        }}
        aria-label={locale === 'fi' ? 'Konteksti' : locale === 'sv' ? 'Kontext' : 'Context'}
      >
        {/* Sources panel hidden for now per design direction. Corpus
         *  stats + out-of-domain remain since they describe the Garden,
         *  not per-answer citations. */}
        {corpusStats && <CorpusBlock locale={locale} stats={corpusStats} />}
        <OutOfDomainBlock locale={locale} ask={ask} />
        {auditMetric && <AuditBlock locale={locale} metric={auditMetric} />}
      </aside>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function WelcomeBubble({
  locale,
  starters,
  onPick,
}: {
  locale: Locale;
  starters: string[];
  onPick: (q: string) => void;
}) {
  const heading =
    locale === 'fi'
      ? 'Tervetuloa.'
      : locale === 'sv'
        ? 'Välkommen.'
        : 'Welcome.';
  const sub =
    locale === 'fi'
      ? 'Kysy puutarhan kasveista. Vastaan tietokannan luetteloon perustuen ja merkitsen lähteen.'
      : locale === 'sv'
        ? 'Fråga om växterna i samlingen. Jag svarar utifrån katalogen och visar källan.'
        : "Ask about a plant in our collection. I answer from the catalogue and cite the entry I draw from.";
  const ctaLabel =
    locale === 'fi' ? 'Aloita näistä' : locale === 'sv' ? 'Börja med dessa' : 'Try one of these';
  const examples = starters.slice(0, 3);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        padding: '28px 8px 8px',
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--sage-pale)',
          color: 'var(--forest)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.6rem',
          margin: '0 auto',
        }}
      >
        🌿
      </div>
      <div>
        <h2
          className="serif"
          style={{
            margin: 0,
            fontSize: '1.8rem',
            color: 'var(--forest-deep)',
            lineHeight: 1.2,
          }}
        >
          {heading}
        </h2>
        <p
          className="muted"
          style={{
            margin: '8px auto 0',
            maxWidth: 460,
            fontSize: '0.967rem',
            lineHeight: 1.55,
          }}
        >
          {sub}
        </p>
      </div>
      {examples.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div className="tiny" style={{ marginBottom: 10 }}>
            {ctaLabel}
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxWidth: 520,
              marginInline: 'auto',
            }}
          >
            {examples.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => onPick(q)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: 'var(--paper)',
                    border: '1px solid var(--line)',
                    color: 'var(--ink)',
                    fontSize: '0.933rem',
                    lineHeight: 1.5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'border-color 120ms ease, background 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--forest-mid)';
                    e.currentTarget.style.background = 'var(--cream)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--line)';
                    e.currentTarget.style.background = 'var(--paper)';
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ color: 'var(--forest-mid)', fontSize: '0.9rem' }}
                  >
                    →
                  </span>
                  <span>{q}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Inline image gallery rendered right under an assistant answer.
 *
 * Pulls the primary photo from every per-plant citation the API returned.
 * Dedupes by slug, caps at 4 cards so a long answer doesn't dominate the
 * thread. Layout: a single hero card when there's one plant, a 2-up
 * responsive grid otherwise (1-col on narrow screens). Clicking a card
 * opens the full plant page in a new tab; clicking the open-in-new
 * affordance is the explicit call-out for that intent.
 */
function PlantImageGallery({ citations, locale }: { citations: Citation[]; locale: Locale }) {
  const seen = new Set<string>();
  // Only render images we host ourselves. Locally-hosted images come
  // through /v1/files/<key> (served by the api from STORAGE_DIR).
  // Legacy seeded PlantImage rows pointing directly at Wikimedia are
  // filtered out — many of those 404'd at seed time and rendering them
  // would show a broken-image icon to the donor.
  const isHostedUrl = (url: string) =>
    url.includes('/v1/files/') ||
    /\/bloomoulu-public\//.test(url);
  const items = citations
    .filter((c): c is Citation & { image: NonNullable<Citation['image']>; plantSlug: string } => {
      if (!c.plantSlug || !c.image?.url) return false;
      if (!isHostedUrl(c.image.url)) return false;
      if (seen.has(c.plantSlug)) return false;
      seen.add(c.plantSlug);
      return true;
    })
    .slice(0, 4);
  if (items.length === 0) return null;
  const single = items.length === 1;
  const label = locale === 'fi' ? 'kasvi kokoelmasta' : locale === 'sv' ? 'växt från samlingen' : 'plant from the collection';
  return (
    <div
      style={{
        marginTop: 14,
        display: 'grid',
        gridTemplateColumns: single ? '1fr' : 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
        gap: 12,
      }}
      role="list"
      aria-label={`${items.length} ${label}${items.length === 1 ? '' : 's'}`}
    >
      {items.map((c) => {
        const latin = c.plantSlug.replace(/-/g, ' ').replace(/\b\w/, (m) => m.toUpperCase());
        const display = c.title && c.title !== c.plantSlug ? c.title : latin;
        return (
          <a
            key={c.plantSlug}
            href={`/${locale}/plants/${c.plantSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bo-plant-card"
            role="listitem"
            aria-label={`${display} — open plant page`}
            style={{
              position: 'relative',
              display: 'block',
              background: 'var(--paper, #fff)',
              border: '1px solid var(--line)',
              borderRadius: 14,
              overflow: 'hidden',
              textDecoration: 'none',
              color: 'inherit',
              boxShadow: '0 1px 2px rgba(15,30,15,0.04)',
              transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: single ? 280 : 180,
                background: 'var(--sage-pale, #eef2ea)',
                overflow: 'hidden',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.image.url}
                alt={display}
                loading="lazy"
                className="bo-plant-card__img"
                style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transition: 'transform 360ms ease',
                }}
              />
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 'auto 0 0 0',
                  height: 64,
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 100%)',
                  pointerEvents: 'none',
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.92)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
                  color: 'var(--forest)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
                title="Open plant page in a new tab"
              >
                ↗
              </span>
            </div>
            <div style={{ padding: '12px 14px 14px' }}>
              <div
                className="serif"
                style={{ fontSize: 16, lineHeight: 1.25, color: 'var(--forest)' }}
              >
                {display}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontStyle: 'italic',
                  fontSize: 12.5,
                  color: 'var(--ink-mute, #555)',
                }}
              >
                {latin}
              </div>
              <div
                className="tiny"
                style={{
                  marginTop: 8,
                  color: 'var(--ink-mute, #666)',
                  fontSize: 11,
                  lineHeight: 1.4,
                  display: 'inline-flex',
                  gap: 6,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'var(--sage-pale, #eef2ea)',
                    color: 'var(--forest)',
                    fontWeight: 600,
                  }}
                >
                  {c.image.licenseSpdx}
                </span>
                <span style={{ opacity: 0.85 }}>{c.image.attribution}</span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function SourcesBlock({ locale, citations }: { locale: Locale; citations: Citation[] }) {
  return (
    <div>
      <div className="tiny" style={{ marginBottom: 12 }}>
        {locale === 'fi' ? 'Lähteet' : locale === 'sv' ? 'Källor' : 'Sources'}
      </div>
      {citations.length === 0 ? (
        <p className="muted small">
          {locale === 'fi'
            ? 'Klikkaa vastausta nähdäksesi sen lähteet.'
            : locale === 'sv'
              ? 'Klicka på ett svar för att se källorna.'
              : 'Click a reply to see its sources.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {citations.map((c) => (
            <li
              key={c.marker}
              id={`chunk-${c.chunkId}`}
              style={{ padding: 12, background: 'var(--cream)', borderRadius: 8, fontSize: '0.867rem', lineHeight: 1.55 }}
            >
              <span className="mono" style={{ fontSize: '0.733rem', color: 'var(--forest)' }}>{c.marker}</span>
              {c.title && (
                <div style={{ marginTop: 4, fontWeight: 500 }}>
                  {c.title}
                  {c.year && (
                    <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>
                      · {c.year}
                    </span>
                  )}
                </div>
              )}
              {c.page && (
                <div className="muted" style={{ marginTop: 2, fontSize: '0.733rem' }}>
                  {c.page}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CorpusBlock({ locale, stats }: { locale: Locale; stats: CorpusStats }) {
  const labels = {
    plants:
      locale === 'fi'
        ? ['Oulun kokoelmatietokanta', 'Kasveja kokoelmassa']
        : locale === 'sv'
          ? ['Uleåborgs samlingsdatabas', 'Växter i samlingen']
          : ['Oulu accession DB', 'Plants in the living collection'],
    ragDocs:
      locale === 'fi'
        ? ['Tutkimusjulkaisut', 'Indeksoidut dokumentit']
        : locale === 'sv'
          ? ['Forskningspublikationer', 'Indexerade dokument']
          : ['Research corpus', 'Indexed documents'],
    citations:
      locale === 'fi'
        ? ['Lähdeviitteet', 'DOI/raportti/kirja']
        : locale === 'sv'
          ? ['Källhänvisningar', 'DOI/rapport/bok']
          : ['Citations', 'DOI / report / book'],
    accessions:
      locale === 'fi'
        ? ['Kerätyt yksilöt', 'Provenienssitietoineen']
        : locale === 'sv'
          ? ['Insamlade exemplar', 'Med proveniens']
          : ['Accessions', 'With provenance'],
  } as const;
  const rows: Array<{ label: string; n: number; desc: string }> = [
    { label: labels.plants[0]!, n: stats.plants, desc: labels.plants[1]! },
    { label: labels.ragDocs[0]!, n: stats.ragDocs, desc: labels.ragDocs[1]! },
    { label: labels.citations[0]!, n: stats.citations, desc: labels.citations[1]! },
    { label: labels.accessions[0]!, n: stats.accessions, desc: labels.accessions[1]! },
  ];
  return (
    <div>
      <div className="tiny">
        {locale === 'fi' ? 'Konteksti · mihin tämä perustuu' : locale === 'sv' ? 'Kontext · vad detta bygger på' : "Context · what's grounding this"}
      </div>
      <h3 className="serif" style={{ fontSize: '1.2rem', marginTop: 6 }}>
        {locale === 'fi' ? 'Elävä korpus' : locale === 'sv' ? 'Levande korpus' : 'Live corpus'}
      </h3>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((s) => (
          <div key={s.label} style={{ padding: 12, background: 'var(--cream)', borderRadius: 10 }}>
            <div className="tiny">{s.label}</div>
            <div className="serif" style={{ fontSize: '1.467rem', marginTop: 2 }}>
              {s.n.toLocaleString(locale)}
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutOfDomainBlock({ locale, ask }: { locale: Locale; ask: AskSettings }) {
  return (
    <div style={{ padding: 14, background: 'var(--cream)', borderRadius: 10 }}>
      <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
        {locale === 'fi' ? 'Aiheen ulkopuolinen kysymys' : locale === 'sv' ? 'Utanför ämnet' : 'Out-of-domain policy'}
      </div>
      <p className="small" style={{ marginTop: 8, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
        {locale === 'fi'
          ? 'Jos kysyt kasvista, joka ei ole kokoelmassamme, linkitämme '
          : locale === 'sv'
            ? 'Om du frågar om en växt vi inte har länkar vi till '
            : 'If you ask about a plant not in our collection, we link out to '}
        <a href={ask.outOfDomain.bgci} target="_blank" rel="noopener noreferrer">BGCI PlantSearch</a>
        {' · '}
        <a href={ask.outOfDomain.gbif} target="_blank" rel="noopener noreferrer">GBIF</a>
        {locale === 'fi' ? '. Kuvatunnistus ohjataan ' : locale === 'sv' ? '. Bildigenkänning skickas till ' : '. For image ID we forward to '}
        <a href={ask.outOfDomain.plantnet} target="_blank" rel="noopener noreferrer">Pl@ntNet</a>
        {locale === 'fi' ? ' ja varmistetaan kokoelmaa vasten.' : locale === 'sv' ? ' och verifieras mot samlingen.' : ' and verify against our accessions.'}
      </p>
    </div>
  );
}

function AuditBlock({ locale, metric }: { locale: Locale; metric: AuditMetric }) {
  const ratePct = (metric.errorRate * 100).toFixed(1);
  const targetPct = (metric.target * 100).toFixed(0);
  const withinTarget = metric.errorRate <= metric.target;
  return (
    <div
      style={{
        padding: 14,
        background: withinTarget ? 'rgba(168,192,96,0.12)' : 'rgba(184,81,58,0.10)',
        borderRadius: 10,
      }}
    >
      <div className="tiny" style={{ color: withinTarget ? 'var(--forest)' : 'var(--rust-on-light)' }}>
        {locale === 'fi' ? 'Viimeisin kuraattoritarkastus' : locale === 'sv' ? 'Senaste kuratorrevision' : 'Last curator audit'}
      </div>
      <div className="small" style={{ marginTop: 8, color: 'var(--ink-soft)' }}>
        <b style={{ fontFamily: 'var(--f-display)' }}>{ratePct}%</b>{' '}
        {locale === 'fi'
          ? `virheprosentti ${metric.window} vastauksen otoksessa. ${withinTarget ? `Alle ${targetPct} %:n julkaisukynnyksen.` : `Yli ${targetPct} %:n kynnyksen — uudelleenarviointi käynnissä.`}`
          : locale === 'sv'
            ? `felprocent över ${metric.window} svar. ${withinTarget ? `Under ${targetPct} % -tröskeln.` : `Över ${targetPct} % -tröskeln — granskning pågår.`}`
            : `error rate across ${metric.window} answers. ${withinTarget ? `Below the ${targetPct}% public-launch threshold.` : `Above the ${targetPct}% threshold — re-audit in progress.`}`}
      </div>
    </div>
  );
}
