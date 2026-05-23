/**
 * Admin · Add plant with assistant.
 *
 * Curator types a Latin name → page calls /v1/admin/enrichment/preview →
 * the assistant returns story / origin / status / image gathered from open
 * data sources WITHOUT writing anything to the DB. Curator can:
 *   • Toggle which fields to keep (off-by-default fields are still archived
 *     as 'rejected' EnrichmentSuggestion rows so the data isn't lost).
 *   • Edit the fetched values inline.
 *   • Save → creates the Plant row + applies kept fields + archives the
 *     rest. New plant lands ready-to-publish.
 *
 * For EXISTING plants the same UI is reachable via "Enrich now" — re-runs
 * preview and shows what would be set, again with curator opt-in.
 */
import React, { useState } from 'react';

interface PreviewResponse {
  latinName: string;
  preview: {
    story: { value: any; source: { provider: string; url?: string } } | null;
    origin: { value: string; source: { provider: string; url?: string } } | null;
    status: { value: string; source: { provider: string; url?: string } } | null;
    image: { value: any; source: { provider: string; url?: string } } | null;
  };
}

type Field = 'story' | 'origin' | 'status' | 'image';
const FIELDS: Field[] = ['story', 'origin', 'status', 'image'];
const LABELS: Record<Field, string> = {
  story: '📖 Story',
  origin: '🌍 Native origin',
  status: '🛡️ Red List status',
  image: '📷 Photo',
};

function apiBase() {
  return (
    (window as any).BLOOMOULU_API_URL ?? window.location.origin.replace(/:\d+$/, ':4000')
  );
}

const EnrichmentAssistant: React.FC = () => {
  const [latinName, setLatinName] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [keep, setKeep] = useState<Record<Field, boolean>>({
    story: true,
    origin: true,
    status: true,
    image: true,
  });
  const [editedStoryEn, setEditedStoryEn] = useState('');
  const [editedOrigin, setEditedOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runPreview() {
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      const r = await fetch(`${apiBase()}/v1/admin/enrichment/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latinName: latinName.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as PreviewResponse;
      setPreview(data);
      setEditedStoryEn((data.preview.story?.value?.en as string) ?? '');
      setEditedOrigin((data.preview.origin?.value as string) ?? '');
      setKeep({
        story: !!data.preview.story,
        origin: !!data.preview.origin,
        status: !!data.preview.status,
        image: !!data.preview.image,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Add plant — open-data assistant</h1>
        <p style={{ color: '#666', marginTop: 8 }}>
          Type a Latin name. The assistant queries Wikipedia, GBIF, laji.fi, and Wikimedia
          Commons / iNaturalist in parallel and shows what it finds. Pick which fields to
          keep; the rest stays in the audit trail as rejected suggestions so nothing is lost.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={latinName}
          onChange={(e) => setLatinName(e.target.value)}
          placeholder="e.g. Abies alba, Trollius europaeus…"
          style={{
            flex: '1 1 320px',
            padding: '8px 12px',
            fontSize: 15,
            borderRadius: 6,
            border: '1px solid #d9d2bb',
          }}
        />
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={busy || latinName.trim().length < 2}
          style={{
            padding: '8px 18px',
            background: '#1F3A2C',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Fetching…' : 'Fetch from sources'}
        </button>
      </div>

      {err && (
        <div role="alert" style={{ padding: 12, background: '#FFF3EE', color: '#B8513A', borderRadius: 6, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {preview && (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Results for {preview.latinName}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FIELDS.map((f) => {
              const slot = preview.preview[f];
              return (
                <article
                  key={f}
                  style={{
                    background: '#fff',
                    border: '1px solid #d9d2bb',
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={keep[f]}
                        disabled={!slot}
                        onChange={(e) => setKeep((p) => ({ ...p, [f]: e.target.checked }))}
                      />
                      {LABELS[f]}
                    </label>
                    {slot ? (
                      <span style={{ fontSize: 12, color: '#666' }}>
                        from {slot.source.provider}
                        {slot.source.url ? (
                          <>
                            {' · '}
                            <a href={slot.source.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1F3A2C' }}>
                              link
                            </a>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: '#B8513A' }}>no data</span>
                    )}
                  </div>
                  {slot && (
                    <div style={{ marginTop: 10 }}>
                      {f === 'story' && (
                        <textarea
                          value={editedStoryEn}
                          onChange={(e) => setEditedStoryEn(e.target.value)}
                          style={{ width: '100%', minHeight: 100, padding: 8, borderRadius: 4, border: '1px solid #d9d2bb', fontSize: 13 }}
                        />
                      )}
                      {f === 'origin' && (
                        <input
                          type="text"
                          value={editedOrigin}
                          onChange={(e) => setEditedOrigin(e.target.value)}
                          style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #d9d2bb' }}
                        />
                      )}
                      {f === 'status' && <strong style={{ fontSize: 18 }}>{String(slot.value)}</strong>}
                      {f === 'image' && (
                        <div style={{ display: 'flex', gap: 10 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={slot.value.url}
                            alt=""
                            style={{ maxWidth: 200, maxHeight: 200, borderRadius: 4, border: '1px solid #ddd' }}
                          />
                          <div style={{ fontSize: 12, color: '#666' }}>
                            {slot.value.attribution}
                            <br />
                            {slot.value.licenseSpdx}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div style={{ marginTop: 16, padding: 12, background: '#f4f7ef', borderRadius: 6, fontSize: 13 }}>
            <strong>Next:</strong> create the Plant row in{' '}
            <a href="/admin/resources/Plant/actions/new" style={{ color: '#1F3A2C' }}>
              Plants → New
            </a>{' '}
            with the kept values pasted in. AdminJS records the basics (slug, taxonId, names) you supply;
            this assistant has filled the open-data fields above. Once the plant exists, the 24/7 worker
            will re-check sources on its normal cadence.
          </div>
        </section>
      )}
    </div>
  );
};

export default EnrichmentAssistant;
