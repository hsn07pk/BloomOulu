/**
 * Admin · Enrichment review.
 *
 * Lists pending EnrichmentSuggestion rows from the 24/7 worker. Curator
 * picks Approve (writes the proposed value to Plant) or Reject (records
 * a reason; row stays for audit). All reviewed suggestions move into the
 * History tab so nothing is silently dropped.
 */
import React, { useCallback, useEffect, useState } from 'react';

interface PlantRef {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  taxon?: { latinName?: string | null } | null;
}

interface Suggestion {
  id: string;
  plantId: string;
  field: 'story' | 'origin' | 'status' | 'image';
  source: string;
  sourceUrl?: string | null;
  confidence: number;
  proposed: any;
  currentSnapshot: any;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'auto_applied' | 'superseded';
  createdAt: string;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  plant: PlantRef;
}

type Tab = 'pending' | 'history';

const FIELD_LABEL: Record<Suggestion['field'], string> = {
  story: '📖 Story',
  origin: '🌍 Native origin',
  status: '🛡️ Red List status',
  image: '📷 Photo',
};

function PreviewBlock({ s }: { s: Suggestion }) {
  if (s.field === 'origin') {
    return (
      <div>
        <div style={{ fontSize: 12, color: '#888' }}>Proposed</div>
        <div style={{ marginBottom: 6 }}>{String(s.proposed)}</div>
        {s.currentSnapshot && (
          <>
            <div style={{ fontSize: 12, color: '#888' }}>Current</div>
            <div style={{ color: '#999', fontStyle: 'italic' }}>{String(s.currentSnapshot)}</div>
          </>
        )}
      </div>
    );
  }
  if (s.field === 'status') {
    return (
      <div>
        <strong>{String(s.proposed)}</strong>
        {s.currentSnapshot ? (
          <span style={{ marginLeft: 8, color: '#999' }}>
            (was {String(s.currentSnapshot)})
          </span>
        ) : null}
      </div>
    );
  }
  if (s.field === 'story' && s.proposed && typeof s.proposed === 'object') {
    const en = (s.proposed.en as string) ?? '';
    return (
      <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 13, color: '#333' }}>
        {en.slice(0, 600)}
        {en.length > 600 ? '…' : ''}
      </div>
    );
  }
  if (s.field === 'image' && s.proposed && typeof s.proposed === 'object') {
    const url = s.proposed.url as string | undefined;
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt=""
            style={{ maxWidth: 120, maxHeight: 120, border: '1px solid #ddd', borderRadius: 4 }}
          />
        )}
        <div style={{ fontSize: 11, color: '#666' }}>
          {s.proposed.attribution}
          <br />
          {s.proposed.licenseSpdx}
        </div>
      </div>
    );
  }
  return <pre style={{ fontSize: 11 }}>{JSON.stringify(s.proposed, null, 2).slice(0, 400)}</pre>;
}

const EnrichmentReview: React.FC = () => {
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldFilter, setFieldFilter] = useState<string>('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const apiBase = (window as any).BLOOMOULU_API_URL ?? `${window.location.origin.replace(/:\d+$/, ':4000')}`;
      const params = new URLSearchParams({ limit: '100' });
      if (tab === 'pending' && fieldFilter) params.set('field', fieldFilter);
      const url = `${apiBase}/v1/admin/enrichment/${tab}?${params}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: Suggestion[] };
      setItems(data.items);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [tab, fieldFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, kind: 'approve' | 'reject', reason?: string) {
    setBusy(true);
    try {
      const apiBase = (window as any).BLOOMOULU_API_URL ?? `${window.location.origin.replace(/:\d+$/, ':4000')}`;
      const res = await fetch(`${apiBase}/v1/admin/enrichment/${id}/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: kind === 'reject' ? JSON.stringify({ reason }) : '{}',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Enrichment review</h1>
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {(['pending', 'history'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 14px',
                border: 0,
                borderRadius: 999,
                background: tab === t ? '#1F3A2C' : 'transparent',
                color: tab === t ? '#fff' : '#1F3A2C',
                cursor: 'pointer',
              }}
            >
              {t === 'pending' ? 'Pending' : 'History'}
            </button>
          ))}
        </div>
        {tab === 'pending' && (
          <select
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, marginLeft: 8 }}
          >
            <option value="">All fields</option>
            <option value="story">Story</option>
            <option value="origin">Origin</option>
            <option value="status">Status</option>
            <option value="image">Image</option>
          </select>
        )}
        <button onClick={load} disabled={busy} style={{ marginLeft: 'auto', padding: '6px 14px' }}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {err && (
        <div role="alert" style={{ padding: 12, background: '#FFF3EE', color: '#B8513A', borderRadius: 6, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {items.length === 0 ? (
        <p style={{ color: '#666' }}>
          {tab === 'pending'
            ? "Nothing waiting. New suggestions appear here as the worker runs."
            : 'No reviewed suggestions yet.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((s) => (
            <article
              key={s.id}
              style={{
                background: '#fff',
                border: '1px solid #d9d2bb',
                borderRadius: 8,
                padding: 14,
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 14,
                alignItems: 'flex-start',
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: '#666', display: 'flex', gap: 8 }}>
                  <span>{FIELD_LABEL[s.field]}</span>
                  <span>·</span>
                  <a href={`/admin/resources/Plant/records/${s.plant.id}/show`} style={{ color: '#1F3A2C' }}>
                    <em>{s.plant.taxon?.latinName ?? s.plant.nameEn}</em>
                  </a>
                  <span>·</span>
                  <span>source: {s.source}</span>
                  {s.sourceUrl && (
                    <>
                      <span>·</span>
                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1F3A2C' }}>
                        link
                      </a>
                    </>
                  )}
                  <span style={{ marginLeft: 'auto', color: '#999' }}>
                    {new Date(s.createdAt).toLocaleString()}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <PreviewBlock s={s} />
                </div>
                {s.reviewNote && (
                  <div style={{ marginTop: 8, fontSize: 11, fontStyle: 'italic', color: '#999' }}>
                    Curator note: {s.reviewNote}
                  </div>
                )}
              </div>
              {tab === 'pending' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => act(s.id, 'approve')}
                    disabled={busy}
                    style={{ padding: '6px 14px', background: '#1F3A2C', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const reason = window.prompt('Reason for rejecting (kept for audit):') ?? undefined;
                      void act(s.id, 'reject', reason);
                    }}
                    disabled={busy}
                    style={{ padding: '6px 14px', background: 'transparent', color: '#B8513A', border: '1px solid #B8513A', borderRadius: 6, cursor: 'pointer' }}
                  >
                    ✕ Reject
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#888', textAlign: 'right' }}>
                  {s.status}
                  {s.reviewedAt && <div>{new Date(s.reviewedAt).toLocaleString()}</div>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default EnrichmentReview;
