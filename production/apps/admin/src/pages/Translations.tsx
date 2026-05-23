/**
 * Translations editor — Moodle-style.
 *
 * Renders all Translation rows in a 3-column (en, fi, sv) table with:
 *   - Search by key, status filter (missing / needs_review / active)
 *   - Inline edit on click
 *   - Bulk import / export CSV
 *   - "Missing translations" filter highlights any row with empty values
 *   - Saves go through PATCH /admin-api/translations/:key — audited
 */
import React, { useState, useEffect, useMemo } from 'react';
import { ApiClient } from 'adminjs';

interface Row {
  i18nKey: string;
  en: string;
  fi: string;
  sv: string;
  context?: string | null;
  status: 'active' | 'needs_review' | 'deprecated';
}

const api = new ApiClient();

const TranslationsPage: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing' | 'needs_review'>('all');
  const [dirty, setDirty] = useState<Record<string, Partial<Row>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .resourceAction({ resourceId: 'Translation', actionName: 'list', params: { perPage: 1000 } })
      .then((r: any) => setRows(r.data.records.map((rec: any) => rec.params)))
      .catch((e: any) => setError(e.message));
  }, []);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r: Row) => {
      if (q && !r.i18nKey.toLowerCase().includes(q)) return false;
      if (filter === 'missing' && r.en && r.fi && r.sv) return false;
      if (filter === 'needs_review' && r.status !== 'needs_review') return false;
      return true;
    });
  }, [rows, search, filter]);

  function edit(key: string, lang: 'en' | 'fi' | 'sv', value: string) {
    setDirty((d: Record<string, Partial<Row>>) => ({ ...d, [key]: { ...d[key], [lang]: value } }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const [key, patch] of Object.entries(dirty)) {
        await api.recordAction({
          resourceId: 'Translation',
          recordId: key,
          actionName: 'edit',
          payload: patch as any,
        } as any);
      }
      setRows((rs: Row[]) => rs.map((r: Row) => (dirty[r.i18nKey] ? { ...r, ...dirty[r.i18nKey] } : r)));
      setDirty({});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const lines = ['key,en,fi,sv,status'];
    for (const r of rows) lines.push([r.i18nKey, q(r.en), q(r.fi), q(r.sv), r.status].join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bloomoulu-translations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Translations</h1>
      <p>Edit every UI string in EN / FI / SV. Changes are audited.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          placeholder="Search key…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search translation key"
          style={{ flex: 1, padding: 8 }}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">All</option>
          <option value="missing">Missing</option>
          <option value="needs_review">Needs review</option>
        </select>
        <button onClick={exportCsv}>Export CSV</button>
        <label
          style={{
            padding: '6px 10px',
            background: '#f5f3eb',
            border: '1px solid #d9d2bb',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                const res = await fetch('/admin/translations/import', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ csv: text }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                  setError(`Import failed: ${err.error ?? res.status}`);
                  return;
                }
                const out = (await res.json()) as { upserted?: number };
                setError(null);
                // Reload to surface the new rows.
                const r = await api.resourceAction({
                  resourceId: 'Translation',
                  actionName: 'list',
                  params: { perPage: 1000 },
                });
                setRows((r as any).data.records.map((rec: any) => rec.params));
                window.alert(`Imported ${out.upserted ?? 0} translation rows.`);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                e.target.value = '';
              }
            }}
          />
        </label>
        <button onClick={save} disabled={saving || !Object.keys(dirty).length}>
          {saving ? 'Saving…' : `Save (${Object.keys(dirty).length})`}
        </button>
      </div>
      {error && <p role="alert" style={{ color: '#b22' }}>{error}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th style={{ padding: 8 }}>Key</th>
            <th style={{ padding: 8 }}>English</th>
            <th style={{ padding: 8 }}>Suomi</th>
            <th style={{ padding: 8 }}>Svenska</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r: Row) => (
            <tr key={r.i18nKey} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8, fontFamily: 'monospace', verticalAlign: 'top' }}>
                {r.i18nKey}
                {r.context && <div style={{ fontSize: 11, color: '#777' }}>{r.context}</div>}
              </td>
              {(['en', 'fi', 'sv'] as const).map((lang) => (
                <td key={lang} style={{ padding: 8 }}>
                  <textarea
                    value={dirty[r.i18nKey]?.[lang] ?? (r as any)[lang]}
                    onChange={(e) => edit(r.i18nKey, lang, e.target.value)}
                    aria-label={`${r.i18nKey} ${lang}`}
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function q(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default TranslationsPage;
