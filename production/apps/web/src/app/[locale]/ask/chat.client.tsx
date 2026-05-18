'use client';
/**
 * AskTheGarden chat — SSE streaming + citation chips + helpful/off-base/
 * escalate reactions.
 *
 * Layout matches the prototype's 3-column shell at desktop; stacks on mobile.
 *
 * The chat speaks SSE to `/v1/ask/stream`. Events:
 *   start  — server acknowledged the question
 *   delta  — incremental text chunk (whitespace-preserving)
 *   final  — { text, citations: [{ marker, chunkId }], escalated }
 *   error  — { message }
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';

type Locale = 'en' | 'fi' | 'sv';

interface Citation {
  marker: string;
  chunkId: string;
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
}

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

type AskMode = 'visitor' | 'staff';
const RECENT_KEY = 'bloom_ask_recent';

const STAFF_STARTERS = {
  en: [
    'Draft school-tour script for upper grade (Saxifraga hirculus)',
    'Generate signage text — Trollius europaeus (FI/SV/EN)',
    "Summarise this quarter's gardener notes",
    'Find a Kone Foundation grant template',
    'Identify a herbarium sample (image upload)',
  ],
  fi: [
    'Luo opastusrunko Yläkoululaisille (Saxifraga hirculus)',
    'Tuota opastetekstin (FI/SV/EN) Trollius europaeus -lajille',
    'Tee yhteenveto tämän vuosineljänneksen puutarhurin muistiinpanoista',
    'Etsi Kone-säätiön apurahapohja',
    'Tunnista herbaarionäyte (kuvalataus)',
  ],
  sv: [
    'Skapa skolturmanus för högstadiet (Saxifraga hirculus)',
    'Generera skyltningstext — Trollius europaeus (FI/SV/EN)',
    'Sammanfatta detta kvartals trädgårdsmästares anteckningar',
    'Hitta en Kone-stiftelsen-bidragsmall',
    'Identifiera ett herbarium-prov (bilduppladdning)',
  ],
};

export default function AskChat({
  locale,
  starters,
  signedIn = false,
  staffEligible = false,
  userId = null,
}: {
  locale: Locale;
  starters: string[];
  signedIn?: boolean;
  staffEligible?: boolean;
  userId?: string | null;
}) {
  const t = useTranslations('Ask');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  // Staff mode is only available to signed-in staff. Visitor is the default
  // for everyone else; the public can use the chat without signing in.
  const [mode, setMode] = useState<AskMode>('visitor');
  const [recent, setRecent] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns]);

  // Hydrate recent from localStorage
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

  function newConversation() {
    setTurns([]);
    setActiveTurn(null);
    setInput('');
    setTimeout(() => composerRef.current?.focus(), 50);
  }

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    pushRecent(question.trim());
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setTurns((tt) => [
      ...tt,
      { id: userId, role: 'user', text: question },
      { id: assistantId, role: 'assistant', text: '', streaming: true },
    ]);
    setActiveTurn(assistantId);
    setInput('');

    try {
      const res = await fetch(`${API}/v1/ask/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ question, locale, userId: userId ?? undefined }),
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
              all.map((tn) => (tn.id === assistantId ? { ...tn, text: tn.text + payload.text } : tn)),
            );
          } else if (event === 'final') {
            setTurns((all) =>
              all.map((tn) =>
                tn.id === assistantId
                  ? {
                      ...tn,
                      text: payload.text,
                      citations: payload.citations,
                      escalated: payload.escalated,
                      streaming: false,
                      messageId: payload.messageId,
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
        body: JSON.stringify({ messageId: turn.messageId, reaction }),
      });
      setTurns((all) => all.map((tn) => (tn.id === turn.id ? { ...tn, reaction } : tn)));
    } catch { /* best-effort */ }
  }

  const active = turns.find((tn) => tn.id === activeTurn);
  const activeCitations = active?.citations ?? [];

  return (
    <div className="ask-shell" style={{ display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 24, marginTop: 24 }}>
      <aside className="card card-pad" style={{ alignSelf: 'flex-start', position: 'sticky', top: 24 }} aria-label={t('starters')}>
        {/* Mode toggle: Visitor / Staff — Staff only visible for signed-in curators/admins */}
        {staffEligible && (
          <div
            role="group"
            aria-label={locale === 'fi' ? 'Tila' : locale === 'sv' ? 'Läge' : 'Mode'}
            style={{ display: 'flex', padding: 4, background: 'rgba(31,58,44,0.06)', borderRadius: 999, marginBottom: 12 }}
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
                  fontSize: 13,
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

        {/* "New conversation" — only useful when conversations are saved
            server-side, which requires sign-in. Hide for anonymous public
            users; their single ephemeral conversation lives until they
            close the tab. */}
        {signedIn && (
          <button
            type="button"
            onClick={newConversation}
            className="btn btn-secondary"
            style={{ width: '100%', marginBottom: 16, fontSize: 13 }}
          >
            ➕ {locale === 'fi' ? 'Uusi keskustelu' : locale === 'sv' ? 'Ny konversation' : 'New conversation'}
          </button>
        )}

        <div className="tiny" style={{ marginBottom: 8 }}>
          {mode === 'staff'
            ? locale === 'fi' ? 'Nopeat henkilökuntatoimet' : locale === 'sv' ? 'Snabba personalåtgärder' : 'Quick staff actions'
            : locale === 'fi' ? 'Suosittua tänään' : locale === 'sv' ? 'Trendar idag' : 'Trending today'}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(mode === 'staff' ? STAFF_STARTERS[locale] : starters).map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => ask(s)}
                disabled={busy}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                  borderRadius: 10, fontSize: 13, color: 'var(--ink-soft)', background: 'transparent',
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
          <>
            <div
              style={{
                borderTop: '1px solid var(--line)',
                marginTop: 20,
                paddingTop: 16,
              }}
            >
              <div className="tiny" style={{ marginBottom: 8 }}>
                {locale === 'fi' ? 'Viimeisimmät' : locale === 'sv' ? 'Senaste' : 'Recent'}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recent.slice(0, 5).map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => ask(q)}
                      disabled={busy}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 10,
                        fontSize: 13,
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
          </>
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
            flex: 1, overflowY: 'auto', padding: 16, background: 'var(--paper)',
            border: '1px solid var(--line)', borderRadius: 16, minHeight: 420, maxHeight: 'calc(100vh - 360px)',
          }}
        >
          {turns.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', padding: '64px 16px', fontFamily: 'var(--f-display)', fontSize: 18, lineHeight: 1.5 }}>
              {t('subtitle')}
            </p>
          )}
          {turns.map((tn) => (
            <article
              key={tn.id}
              data-role={tn.role}
              onClick={() => tn.role === 'assistant' && setActiveTurn(tn.id)}
              style={{
                marginBottom: 16, padding: 14, borderRadius: 12,
                background: tn.role === 'user' ? 'var(--sage-pale)' : 'var(--cream)',
                cursor: tn.role === 'assistant' ? 'pointer' : 'default',
                border: tn.role === 'assistant' && activeTurn === tn.id ? '1px solid var(--forest-mid)' : '1px solid transparent',
              }}
            >
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {tn.text}
                {tn.streaming && <span aria-hidden="true">▍</span>}
              </p>
              {tn.citations && tn.citations.length > 0 && (
                <ul aria-label={`${tn.citations.length} sources`} style={{ marginTop: 12, listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tn.citations.map((c) => (
                    <li key={c.marker}>
                      <a href={`#chunk-${c.chunkId}`} className="pill" style={{ fontSize: 11, padding: '3px 10px', textDecoration: 'none' }}>{c.marker}</a>
                    </li>
                  ))}
                </ul>
              )}
              {tn.escalated && (
                <p role="note" className="small" style={{ marginTop: 12, color: 'var(--rust-on-light)' }}>↗ {t('noAnswer')}</p>
              )}
              {tn.role === 'assistant' && !tn.streaming && tn.messageId && (
                <div style={{ marginTop: 12, display: 'flex', gap: 6, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
                  {(['helpful', 'off_base', 'escalated'] as const).map((r) => {
                    const label = r === 'helpful' ? `👍 ${t('helpful')}` : r === 'off_base' ? `👎 ${t('offBase')}` : `↗ ${t('escalate')}`;
                    const bg = tn.reaction === r ? (r === 'helpful' ? 'var(--sage-pale)' : r === 'off_base' ? 'var(--amber-soft)' : 'var(--rust-soft)') : 'rgba(45,84,64,0.07)';
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); react(tn, r); }}
                        aria-pressed={tn.reaction === r}
                        className="pill"
                        style={{ padding: '4px 10px', fontSize: 11, background: bg }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) ask(input.trim());
          }}
          style={{ marginTop: 12, display: 'flex', gap: 8 }}
        >
          <label htmlFor="ask-input" className="sr-only">{t('placeholder')}</label>
          <textarea
            ref={composerRef}
            id="ask-input"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim()) ask(input.trim());
              }
            }}
            placeholder={t('placeholder')}
            disabled={busy}
            style={{ flex: 1, padding: '12px 16px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--paper)', fontSize: 15, resize: 'none', minHeight: 44 }}
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary" style={{ padding: '10px 22px' }}>
            {busy ? t('thinking') : t('send')}
          </button>
        </form>
      </section>

      <aside className="card card-pad" style={{ alignSelf: 'flex-start' }} aria-label={locale === 'fi' ? 'Lähteet' : locale === 'sv' ? 'Källor' : 'Sources'}>
        <div className="tiny" style={{ marginBottom: 12 }}>{locale === 'fi' ? 'Lähteet' : locale === 'sv' ? 'Källor' : 'Sources'}</div>
        {activeCitations.length === 0 ? (
          <p className="muted small">
            {locale === 'fi' ? 'Klikkaa vastausta nähdäksesi sen lähteet.' : locale === 'sv' ? 'Klicka på ett svar för att se källorna.' : 'Click a reply to see its sources.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activeCitations.map((c) => (
              <li
                key={c.marker}
                id={`chunk-${c.chunkId}`}
                style={{ padding: 12, background: 'var(--cream)', borderRadius: 8, fontSize: 13, lineHeight: 1.55 }}
              >
                <span className="mono" style={{ fontSize: 11, color: 'var(--forest)' }}>{c.marker}</span>
                <p className="muted" style={{ marginTop: 4 }}>
                  {locale === 'fi' ? 'Tunniste:' : locale === 'sv' ? 'ID:' : 'Chunk:'} <span className="mono" style={{ fontSize: 10 }}>{c.chunkId.slice(0, 8)}…</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
