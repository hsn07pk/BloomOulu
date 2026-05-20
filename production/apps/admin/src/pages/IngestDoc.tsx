/**
 * /admin/pages/ingest — paste a new document into the RAG corpus.
 *
 * Lets a curator add hand-written content (a new "About the
 * Garden" section, a Q&A entry, a research summary, …) to the
 * RagDocument pool without running scripts. The doc gets embedded
 * with bge-m3 and immediately becomes retrievable from
 * AskTheGarden.
 *
 * Below the form: a recent-docs list with delete buttons for
 * cleanup. Filtered to `__manual__:*` so the curator can't
 * accidentally nuke the per-plant catalogue chunks.
 */
import React, { useEffect, useState } from 'react';

interface DocRow {
  id: string;
  title: string;
  locale: string;
  bodyPreview: string;
  chunks: number;
  createdAt: string;
}

const IngestDoc: React.FC = () => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [locale, setLocale] = useState<'en' | 'fi' | 'sv'>('en');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [recent, setRecent] = useState<DocRow[]>([]);

  const refresh = async () => {
    try {
      const res = await fetch('/admin/manual-docs', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setRecent(data.items ?? []);
      }
    } catch {/* ignore */}
  };
  useEffect(() => {
    void refresh();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setMsg({ kind: 'err', text: 'Title and body are required.' });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch('/admin/ingest-doc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: title.trim(), body, locale }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMsg({ kind: 'ok', text: `✓ Ingested ${data.chunks} chunks for "${title}".` });
        setTitle('');
        setBody('');
        await refresh();
      } else {
        setMsg({ kind: 'err', text: data.error ?? `HTTP ${res.status}` });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}" from the corpus? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/admin/manual-docs/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        await refresh();
        setMsg({ kind: 'ok', text: `✓ Deleted "${title}".` });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 920 }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, margin: '0 0 8px', color: '#1F3C2D' }}>
        Ingest a new RAG document
      </h1>
      <p style={{ color: '#6B7560', marginBottom: 24, maxWidth: 640 }}>
        Add a hand-written entry to the AskTheGarden corpus. The body
        is chunked and embedded with bge-m3 immediately; the chunk is
        retrievable within seconds. Title is prefixed with
        <code style={{ background: '#FAF7EE', padding: '2px 6px', borderRadius: 4, marginInline: 4 }}>__manual__:</code>
        so it never collides with the per-plant catalogue.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
        <label>
          <div style={{ fontSize: 13, color: '#1F3C2D', marginBottom: 4 }}>Title</div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={3}
            maxLength={120}
            placeholder="e.g. seed-bank-2026 or romeo-greenhouse-walkthrough"
            style={inputStyle}
          />
        </label>
        <label>
          <div style={{ fontSize: 13, color: '#1F3C2D', marginBottom: 4 }}>Locale</div>
          <select value={locale} onChange={(e) => setLocale(e.target.value as any)} style={inputStyle}>
            <option value="en">English</option>
            <option value="fi">Finnish</option>
            <option value="sv">Swedish</option>
          </select>
        </label>
        <label>
          <div style={{ fontSize: 13, color: '#1F3C2D', marginBottom: 4 }}>
            Body (markdown supported)
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={10}
            rows={14}
            placeholder={'# Heading\n\nWrite a few paragraphs of the content you want AskTheGarden to know. ~500 chars per chunk is ideal.'}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, "JetBrains Mono", monospace', resize: 'vertical' }}
          />
          <div style={{ fontSize: 12, color: '#88897C', marginTop: 4 }}>
            ~{Math.ceil(body.length / 500)} chunk{Math.ceil(body.length / 500) === 1 ? '' : 's'} will be created at ~500 chars each
          </div>
        </label>
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '12px 22px',
            background: submitting ? '#88897C' : '#2D5440',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            cursor: submitting ? 'wait' : 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          {submitting ? 'Embedding…' : 'Ingest into corpus'}
        </button>
        {msg && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: msg.kind === 'ok' ? '#E8EEDE' : '#FFF3EE',
              color: msg.kind === 'ok' ? '#2D5440' : '#B8513A',
              border: `1px solid ${msg.kind === 'ok' ? '#A8C060' : '#B8513A'}`,
              fontSize: 14,
            }}
          >
            {msg.text}
          </div>
        )}
      </form>

      <h2 style={{ fontSize: 20, fontWeight: 500, color: '#1F3C2D', marginBottom: 12 }}>
        Recently ingested manual docs ({recent.length})
      </h2>
      <div style={{ background: 'white', border: '1px solid #E5E2D8', borderRadius: 8, overflow: 'hidden' }}>
        {recent.length === 0 ? (
          <div style={{ padding: 16, color: '#88897C' }}>
            No manually-ingested docs yet. Use the form above to add one.
          </div>
        ) : (
          recent.map((d) => (
            <div
              key={d.id}
              style={{
                padding: 12,
                borderBottom: '1px solid #F2F0E8',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, color: '#1F3C2D' }}>{d.title.replace(/^__manual__:/, '')}</div>
                <div style={{ fontSize: 12, color: '#88897C', marginTop: 2 }}>
                  {d.locale} · {d.chunks} chunk{d.chunks === 1 ? '' : 's'} · {new Date(d.createdAt).toLocaleString()}
                </div>
                <div style={{ fontSize: 13, color: '#6B7560', marginTop: 4 }}>{d.bodyPreview}</div>
              </div>
              <button
                onClick={() => remove(d.id, d.title)}
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '1px solid #B8513A',
                  color: '#B8513A',
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #E5E2D8',
  background: '#FAF7EE',
  fontSize: 15,
  fontFamily: 'inherit',
  color: '#1F3C2D',
};

export default IngestDoc;
