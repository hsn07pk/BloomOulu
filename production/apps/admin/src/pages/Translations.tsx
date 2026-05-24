/**
 * Translations editor — Moodle-style.
 *
 * Renders all Translation rows in a 3-column (en, fi, sv) layout with:
 *   - Live search across key, context, and any of the three languages
 *   - Filter chips for namespace, status, missing-any-language
 *   - Inline edit with autosize textareas
 *   - Bulk import / export CSV
 *   - Highlighted search-matches so a curator finds the right row fast
 *   - Audited per-row saves through the AdminJS API
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from 'adminjs';
import {
  Button,
  Card,
  CopyButton,
  EmptyState,
  FilterChip,
  HelpBanner,
  InfoTooltip,
  Notice,
  Page,
  PageHeader,
  SearchFilterBar,
  Skeleton,
  StatusPill,
  StickyActionBar,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

type Lang = 'en' | 'fi' | 'sv';

interface Row {
  i18nKey: string;
  en: string;
  fi: string;
  sv: string;
  context?: string | null;
  status: 'active' | 'needs_review' | 'deprecated';
  namespace?: string | null;
}

interface ListResponse {
  data: { records: Array<{ params: Row }> };
}

const api = new ApiClient();

const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  fi: 'Suomi',
  sv: 'Svenska',
};

const FLAG: Record<Lang, string> = { en: '🇬🇧', fi: '🇫🇮', sv: '🇸🇪' };

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isMissing(r: Row): boolean {
  return !r.en?.trim() || !r.fi?.trim() || !r.sv?.trim();
}

function which(row: Row, lang: Lang, dirty: Record<string, Partial<Row>>): string {
  const patch = dirty[row.i18nKey];
  if (patch && lang in patch) {
    return ((patch as Record<string, unknown>)[lang] as string) ?? '';
  }
  return (row[lang] ?? '') as string;
}

function rowMatchesQuery(row: Row, q: string): boolean {
  if (!q) return true;
  const hay = [
    row.i18nKey,
    row.context ?? '',
    row.en ?? '',
    row.fi ?? '',
    row.sv ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q || !text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          background: colors.highlight,
          color: colors.forestDeep,
          padding: '0 2px',
          borderRadius: 2,
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

const TranslationsPage: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing' | 'needs_review' | 'complete'>('all');
  const [namespace, setNamespace] = useState<string>('all');
  const [dirty, setDirty] = useState<Record<string, Partial<Row>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 200);

  const reload = async () => {
    setLoading(true);
    try {
      const res = (await api.resourceAction({
        resourceId: 'Translation',
        actionName: 'list',
        params: { perPage: 1000 },
      })) as unknown as ListResponse;
      setRows(res.data.records.map((r) => r.params));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const ns = r.namespace ?? r.i18nKey.split('.')[0] ?? '_root';
      set.add(ns);
    }
    return Array.from(set).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (filter === 'missing' && !isMissing(r)) return false;
      if (filter === 'complete' && isMissing(r)) return false;
      if (filter === 'needs_review' && r.status !== 'needs_review') return false;
      if (namespace !== 'all') {
        const ns = r.namespace ?? r.i18nKey.split('.')[0];
        if (ns !== namespace) return false;
      }
      return rowMatchesQuery(r, debouncedSearch);
    });
  }, [rows, debouncedSearch, filter, namespace]);

  const edit = (key: string, lang: Lang, value: string) => {
    setDirty((d) => ({ ...d, [key]: { ...d[key], [lang]: value } }));
  };

  const revertRow = (key: string) =>
    setDirty((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      for (const [key, patch] of Object.entries(dirty)) {
        await api.recordAction({
          resourceId: 'Translation',
          recordId: key,
          actionName: 'edit',
          // AdminJS' typed `params` is restrictive; the runtime accepts a
          // free-form payload that becomes the record's update body.
          payload: patch,
        } as unknown as Parameters<typeof api.recordAction>[0]);
      }
      const n = Object.keys(dirty).length;
      setRows((rs) =>
        rs.map((r) => (dirty[r.i18nKey] ? { ...r, ...dirty[r.i18nKey] } : r)),
      );
      setDirty({});
      setOkMsg(`Saved ${n} translation${n === 1 ? '' : 's'}. Live on the public site within seconds.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const lines = ['key,en,fi,sv,status'];
    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.i18nKey),
          csvEscape(r.en ?? ''),
          csvEscape(r.fi ?? ''),
          csvEscape(r.sv ?? ''),
          r.status,
        ].join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bloomoulu-translations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importCsv = async (file: File) => {
    try {
      const text = await file.text();
      const res = await fetch('/admin/translations/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ csv: text }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`Import failed: ${err.error ?? res.status}`);
        return;
      }
      const out = (await res.json()) as { upserted?: number };
      await reload();
      setOkMsg(`Imported ${out.upserted ?? 0} translation rows.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const dirtyCount = Object.keys(dirty).length;
  const missingCount = rows.filter(isMissing).length;
  const needsReviewCount = rows.filter((r) => r.status === 'needs_review').length;

  return (
    <Page>
      <PageHeader
        kicker="Localisation"
        title="Translations"
        lede="Every donor-facing string in English, Finnish, and Swedish. Search by key or by the translated text itself; the missing-translations filter is the quickest way to find work-in-progress strings."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
            <ImportButton onPick={importCsv} />
          </>
        }
      />

      <HelpBanner
        id="translations-intro"
        title="How translations propagate"
      >
        Translation rows are read by the public site at request time — your changes are visible
        within a few seconds (the SSE bus invalidates caches automatically). To translate offline,
        export the CSV, edit in your spreadsheet, then re-import; existing keys are upserted and
        nothing is deleted.
      </HelpBanner>

      <SearchFilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search keys, context, or translated text…"
        searchHint="Matches anywhere in the key, the developer's context note, or any of the EN/FI/SV strings."
        filters={
          <>
            <FilterChip
              active={filter === 'all'}
              label="All"
              count={rows.length}
              onClick={() => setFilter('all')}
            />
            <FilterChip
              active={filter === 'missing'}
              label="Missing a language"
              count={missingCount}
              onClick={() => setFilter('missing')}
              tone={missingCount > 0 ? 'accent' : 'default'}
            />
            <FilterChip
              active={filter === 'needs_review'}
              label="Needs review"
              count={needsReviewCount}
              onClick={() => setFilter('needs_review')}
            />
            <FilterChip
              active={filter === 'complete'}
              label="Complete"
              count={rows.length - missingCount}
              onClick={() => setFilter('complete')}
            />
            {namespaces.length > 1 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 4px 2px 10px',
                  borderRadius: 999,
                  background: namespace !== 'all' ? colors.sage : colors.cream,
                  border: `1px solid ${namespace !== 'all' ? colors.olive : colors.line}`,
                  fontSize: fontSize.sm,
                  color: colors.inkSoft,
                }}
              >
                <label
                  htmlFor="ns-select"
                  style={{ fontSize: fontSize.sm, color: colors.inkMute }}
                >
                  Namespace:
                </label>
                <select
                  id="ns-select"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: fontSize.sm,
                    color: colors.forest,
                    fontWeight: 500,
                    padding: '4px 8px 4px 4px',
                    cursor: 'pointer',
                    fontFamily: font.body,
                  }}
                >
                  <option value="all">all</option>
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>
                      {ns}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </>
        }
        activeFilterCount={
          (search ? 1 : 0) + (filter !== 'all' ? 1 : 0) + (namespace !== 'all' ? 1 : 0)
        }
        onClearAll={() => {
          setSearch('');
          setFilter('all');
          setNamespace('all');
        }}
        resultCount={visibleRows.length}
        totalCount={rows.length}
        resultLabel="strings"
      />

      {error && (
        <Notice tone="danger" title="Error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {okMsg && (
        <Notice tone="success" onDismiss={() => setOkMsg(null)}>
          {okMsg}
        </Notice>
      )}

      {loading ? (
        <Card>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 2fr 2fr 2fr', gap: 12 }}>
              <Skeleton height={28} />
              <Skeleton height={28} />
              <Skeleton height={28} />
              <Skeleton height={28} />
            </div>
          ))}
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card>
          <EmptyState
            variant={
              filter === 'missing' && missingCount === 0
                ? 'all-done'
                : search || filter !== 'all' || namespace !== 'all'
                  ? 'no-filter-match'
                  : 'idle'
            }
            title={
              filter === 'missing' && missingCount === 0
                ? 'No missing translations — nicely done.'
                : search || filter !== 'all' || namespace !== 'all'
                  ? `Nothing matches your filters`
                  : 'No translations yet'
            }
            description={
              filter === 'missing' && missingCount === 0
                ? 'Every key has all three languages populated. Anything new will appear here as soon as you add it.'
                : search || filter !== 'all' || namespace !== 'all'
                  ? 'Try a broader keyword or clear the filters.'
                  : 'Seed translations with `pnpm db:seed` or import a CSV.'
            }
            action={
              (search || filter !== 'all' || namespace !== 'all') && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setFilter('all');
                    setNamespace('all');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card flush>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: font.body,
              background: 'transparent',
              boxShadow: 'none',
              borderRadius: 0,
            }}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{
                    textAlign: 'left',
                    padding: '14px 16px',
                    background: colors.whisper,
                    borderBottom: `1px solid ${colors.line}`,
                    color: colors.inkMute,
                    fontWeight: 600,
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    width: 280,
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  Key + context
                </th>
                {(['en', 'fi', 'sv'] as const).map((lang) => (
                  <th
                    key={lang}
                    scope="col"
                    style={{
                      textAlign: 'left',
                      padding: '14px 16px',
                      background: colors.whisper,
                      borderBottom: `1px solid ${colors.line}`,
                      color: colors.inkMute,
                      fontWeight: 600,
                      fontSize: 11,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    {FLAG[lang]} {LANG_LABELS[lang]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isDirty = Boolean(dirty[row.i18nKey]);
                const missing = isMissing(row);
                return (
                  <tr
                    key={row.i18nKey}
                    style={{
                      background: isDirty ? colors.warningBg : 'transparent',
                      borderBottom: `1px solid ${colors.lineSoft}`,
                      transition: 'background 150ms ease',
                    }}
                  >
                    <td
                      style={{
                        padding: '14px 16px',
                        verticalAlign: 'top',
                        width: 280,
                        borderRight: `1px solid ${colors.lineSoft}`,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginBottom: 4,
                          flexWrap: 'wrap',
                        }}
                      >
                        <code
                          style={{
                            fontFamily: font.mono,
                            fontSize: 12,
                            fontWeight: 600,
                            color: colors.forest,
                            wordBreak: 'break-all',
                          }}
                        >
                          {highlight(row.i18nKey, debouncedSearch)}
                        </code>
                        <CopyButton value={row.i18nKey} label="copy key" size="sm" />
                      </div>
                      {row.context && (
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.inkMute,
                            lineHeight: 1.5,
                            fontStyle: 'italic',
                          }}
                        >
                          {row.context}
                        </div>
                      )}
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {missing && <StatusPill tone="danger" dot>Missing language</StatusPill>}
                        {row.status === 'needs_review' && (
                          <StatusPill tone="warn" dot>Needs review</StatusPill>
                        )}
                        {row.status === 'deprecated' && (
                          <StatusPill tone="neutral" dot>Deprecated</StatusPill>
                        )}
                        {isDirty && <StatusPill tone="warn" dot>Unsaved</StatusPill>}
                        {isDirty && (
                          <button
                            type="button"
                            onClick={() => revertRow(row.i18nKey)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: colors.inkMute,
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: 11,
                              textDecoration: 'underline',
                            }}
                          >
                            revert
                          </button>
                        )}
                      </div>
                    </td>
                    {(['en', 'fi', 'sv'] as const).map((lang) => {
                      const v = which(row, lang, dirty);
                      const empty = !v.trim();
                      return (
                        <td
                          key={lang}
                          style={{
                            padding: '10px 12px',
                            verticalAlign: 'top',
                            background: empty ? colors.accentSoft : 'transparent',
                            borderRight:
                              lang !== 'sv' ? `1px solid ${colors.lineSoft}` : 'none',
                          }}
                        >
                          <AutoTextarea
                            value={v}
                            onChange={(val) => edit(row.i18nKey, lang, val)}
                            aria-label={`${row.i18nKey} ${lang}`}
                            placeholder={empty ? `Missing ${LANG_LABELS[lang]} translation` : ''}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <StickyActionBar
        visible={dirtyCount > 0 && !loading}
        message={`${dirtyCount} unsaved translation${dirtyCount === 1 ? '' : 's'}.`}
      >
        <Button variant="secondary" onClick={() => setDirty({})} disabled={saving}>
          Discard all
        </Button>
        <Button variant="primary" onClick={save} loading={saving}>
          {saving ? 'Saving…' : `Save ${dirtyCount} translation${dirtyCount === 1 ? '' : 's'}`}
        </Button>
      </StickyActionBar>
    </Page>
  );
};

const AutoTextarea: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  'aria-label': string;
}> = ({ value, onChange, placeholder, ...rest }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      {...rest}
      style={{
        width: '100%',
        minHeight: 38,
        padding: '8px 10px',
        border: `1px solid ${colors.line}`,
        borderRadius: radius.sm,
        background: colors.paper,
        fontSize: fontSize.base,
        fontFamily: font.body,
        color: colors.ink,
        lineHeight: 1.5,
        resize: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    />
  );
};

const ImportButton: React.FC<{ onPick: (file: File) => void }> = ({ onPick }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <Button
        variant="primary"
        onClick={() => inputRef.current?.click()}
        leftIcon="↑"
      >
        Import CSV
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
    </>
  );
};

export default TranslationsPage;
