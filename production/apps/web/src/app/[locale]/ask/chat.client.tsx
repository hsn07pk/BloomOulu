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

export default function AskChat({
  locale,
  starters,
}: {
  locale: Locale;
  starters: string[];
}) {
  const t = useTranslations('Ask');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
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
        body: JSON.stringify({ question, locale }),
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
      <aside className="card card-pad" style={{ alignSelf: 'flex-start' }} aria-label={t('starters')}>
        <div className="tiny" style={{ marginBottom: 12 }}>{t('starters')}</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {starters.map((s) => (
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
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
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
