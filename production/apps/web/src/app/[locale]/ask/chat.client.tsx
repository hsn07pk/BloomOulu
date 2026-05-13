'use client';
import { useState, useRef, useEffect } from 'react';

interface Citation { marker: string; chunkId: string }
interface Turn { role: 'user' | 'assistant'; text: string; citations?: Citation[]; escalated?: boolean }

export default function AskChat({ locale, starters }: { locale: 'en' | 'fi' | 'sv'; starters: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);

  async function ask(text: string) {
    setBusy(true);
    setTurns((t) => [...t, { role: 'user', text }]);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/v1/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text, locale }),
      });
      const json = await res.json();
      setTurns((t) => [...t, { role: 'assistant', text: json.text, citations: json.citations, escalated: json.escalated }]);
    } catch (e: any) {
      setTurns((t) => [...t, { role: 'assistant', text: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
      setInput('');
      // Move focus to the response for screen-reader users.
      setTimeout(() => liveRef.current?.focus(), 50);
    }
  }

  useEffect(() => {
    liveRef.current?.scrollTo({ top: liveRef.current.scrollHeight });
  }, [turns]);

  return (
    <section aria-labelledby="ask-h">
      <div role="log" aria-live="polite" aria-atomic="false" tabIndex={-1} ref={liveRef} style={{ minHeight: 320, padding: 12, border: '1px solid #ddd', borderRadius: 6 }}>
        {turns.map((t, i) => (
          <article key={i} data-role={t.role} style={{ marginBottom: 16 }}>
            <p>{t.text}</p>
            {t.citations?.length ? (
              <p>
                {t.citations.map((c) => (
                  <span key={c.marker} style={{ background: '#E8EEDE', padding: '2px 6px', marginRight: 4, borderRadius: 3, fontSize: 11 }}>
                    {c.marker}
                  </span>
                ))}
              </p>
            ) : null}
            {t.escalated && <p role="note">↗ This question has been forwarded to a curator.</p>}
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
        <label htmlFor="ask-input" className="sr-only">Question</label>
        <input
          id="ask-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={locale === 'fi' ? 'Kysy millä kielellä tahansa…' : locale === 'sv' ? 'Fråga på vilket språk som helst…' : 'Ask in any language…'}
          disabled={busy}
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={busy}>{busy ? '…' : 'Send'}</button>
      </form>
      {turns.length === 0 && (
        <ul style={{ marginTop: 16, listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {starters.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => ask(s)} style={{ background: '#F4F7EF', padding: 8, border: '1px solid #DDE6CB' }}>{s}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
