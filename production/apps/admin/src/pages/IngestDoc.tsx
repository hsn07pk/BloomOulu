/**
 * /admin/pages/ingest — paste a new document into the RAG corpus.
 *
 * Lets a curator add hand-written content (a new "About the
 * Garden" section, a Q&A entry, a research summary, …) to the
 * RagDocument pool without running scripts. The doc gets embedded
 * with bge-m3 and immediately becomes retrievable from
 * AskTheGarden.
 *
 * Below the form: a searchable recent-docs list with delete buttons
 * for cleanup. Filtered to `__manual__:*` so the curator can't
 * accidentally nuke the per-plant catalogue chunks.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  FilterChip,
  HelpBanner,
  Notice,
  Page,
  PageHeader,
  SearchFilterBar,
  Skeleton,
  StatusPill,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface DocRow {
  id: string;
  title: string;
  locale: string;
  bodyPreview: string;
  chunks: number;
  createdAt: string;
}

const LOCALE_LABELS: Record<string, string> = { en: 'English', fi: 'Finnish', sv: 'Swedish' };

const IngestDoc: React.FC = () => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [locale, setLocale] = useState<'en' | 'fi' | 'sv'>('en');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [recent, setRecent] = useState<DocRow[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [localeFilter, setLocaleFilter] = useState<'all' | 'en' | 'fi' | 'sv'>('all');

  const refresh = async () => {
    setLoadingRecent(true);
    try {
      const res = await fetch('/admin/manual-docs', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { items?: DocRow[] };
        setRecent(data.items ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingRecent(false);
    }
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
      const data = (await res.json()) as { ok?: boolean; chunks?: number; error?: string };
      if (res.ok && data.ok) {
        setMsg({
          kind: 'ok',
          text: `Ingested ${data.chunks ?? 0} chunks for “${title.trim()}”.`,
        });
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

  const remove = async (id: string, docTitle: string) => {
    if (!window.confirm(`Delete “${docTitle}” from the corpus? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/admin/manual-docs/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        await refresh();
        setMsg({ kind: 'ok', text: `Deleted “${docTitle}”.` });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    }
  };

  const visibleRecent = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return recent.filter((d) => {
      if (localeFilter !== 'all' && d.locale !== localeFilter) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) || d.bodyPreview.toLowerCase().includes(q)
      );
    });
  }, [recent, debouncedSearch, localeFilter]);

  const localeCounts = useMemo(() => {
    const map: Record<string, number> = { all: recent.length, en: 0, fi: 0, sv: 0 };
    for (const d of recent) {
      if (d.locale in map) map[d.locale]!++;
    }
    return map;
  }, [recent]);

  const estimatedChunks = Math.max(1, Math.ceil(body.length / 500));
  const canSubmit = title.trim().length >= 3 && body.trim().length >= 10 && !submitting;

  return (
    <Page narrow>
      <PageHeader
        kicker="AskTheGarden corpus"
        title="Ingest RAG document"
        lede="Add hand-written content to the AskTheGarden corpus. The body is chunked and embedded with bge-m3 immediately; the new chunk is retrievable within seconds."
      />

      <HelpBanner
        id="ingest-doc-intro"
        title="What to put here"
      >
        Manual documents are for content the per-plant ingest can’t cover: About-the-Garden sections,
        FAQs, research summaries, opening hours, donor policies. Titles are auto-prefixed with
        <code style={{ background: colors.cream, padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>__manual__:</code>
        so they never collide with the per-plant catalogue chunks. ~500 chars per chunk is the
        sweet spot for retrieval quality.
      </HelpBanner>

      <Card title="Write a new document">
        <form
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}
        >
          <div>
            <label
              htmlFor="ingest-title"
              style={{
                display: 'block',
                fontSize: fontSize.sm,
                fontWeight: 500,
                color: colors.forest,
                marginBottom: 4,
              }}
            >
              Title
              <span style={{ color: colors.inkMute, fontWeight: 400, marginLeft: 6 }}>
                · short kebab-case slug
              </span>
            </label>
            <input
              id="ingest-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
              maxLength={120}
              placeholder="e.g. seed-bank-2026 or romeo-greenhouse-walkthrough"
              style={inputStyle}
            />
          </div>
          <div>
            <label
              htmlFor="ingest-locale"
              style={{
                display: 'block',
                fontSize: fontSize.sm,
                fontWeight: 500,
                color: colors.forest,
                marginBottom: 4,
              }}
            >
              Locale
              <span style={{ color: colors.inkMute, fontWeight: 400, marginLeft: 6 }}>
                · which language the body is written in
              </span>
            </label>
            <select
              id="ingest-locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'en' | 'fi' | 'sv')}
              style={{ ...inputStyle, maxWidth: 280 }}
            >
              <option value="en">English</option>
              <option value="fi">Finnish</option>
              <option value="sv">Swedish</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="ingest-body"
              style={{
                display: 'block',
                fontSize: fontSize.sm,
                fontWeight: 500,
                color: colors.forest,
                marginBottom: 4,
              }}
            >
              Body
              <span style={{ color: colors.inkMute, fontWeight: 400, marginLeft: 6 }}>
                · Markdown supported (headings, lists, links)
              </span>
            </label>
            <textarea
              id="ingest-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              minLength={10}
              rows={14}
              placeholder={
                '# Heading\n\nWrite the content you want AskTheGarden to know. Aim for paragraphs of ~500 characters — that is the sweet spot for retrieval quality.'
              }
              style={{
                ...inputStyle,
                fontFamily: font.mono,
                fontSize: fontSize.sm,
                resize: 'vertical',
                lineHeight: 1.55,
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                fontSize: fontSize.sm,
                color: colors.inkMute,
                marginTop: 6,
              }}
            >
              <span>{body.length.toLocaleString()} characters</span>
              <span>
                ≈ <strong>{estimatedChunks}</strong> chunk{estimatedChunks === 1 ? '' : 's'} at ~500 chars each
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={!canSubmit}
            >
              {submitting ? 'Embedding…' : 'Ingest into corpus'}
            </Button>
            {msg && (
              <Notice
                tone={msg.kind === 'ok' ? 'success' : 'danger'}
                compact
                onDismiss={() => setMsg(null)}
              >
                {msg.text}
              </Notice>
            )}
          </div>
        </form>
      </Card>

      <Card
        kicker={`${recent.length} doc${recent.length === 1 ? '' : 's'} ingested manually`}
        title="Manual documents"
        description="Manually-ingested entries only. Per-plant chunks from the catalogue ingest are managed separately and aren’t shown here."
      >
        <SearchFilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search title or content preview…"
          filters={
            <>
              <FilterChip
                active={localeFilter === 'all'}
                label="All locales"
                count={localeCounts['all']}
                onClick={() => setLocaleFilter('all')}
              />
              {(['en', 'fi', 'sv'] as const).map((l) => (
                <FilterChip
                  key={l}
                  active={localeFilter === l}
                  label={LOCALE_LABELS[l] ?? l}
                  count={localeCounts[l]}
                  onClick={() => setLocaleFilter(l)}
                />
              ))}
            </>
          }
          activeFilterCount={(search ? 1 : 0) + (localeFilter !== 'all' ? 1 : 0)}
          onClearAll={() => {
            setSearch('');
            setLocaleFilter('all');
          }}
          resultCount={visibleRecent.length}
          totalCount={recent.length}
          resultLabel="documents"
        />

        {loadingRecent ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={68} />
            ))}
          </div>
        ) : visibleRecent.length === 0 ? (
          <EmptyState
            variant={
              recent.length === 0
                ? 'idle'
                : search || localeFilter !== 'all'
                  ? 'no-filter-match'
                  : 'idle'
            }
            title={
              recent.length === 0
                ? 'No manually-ingested documents yet'
                : 'Nothing matches your filters'
            }
            description={
              recent.length === 0
                ? 'Use the form above to add your first one. Once ingested it’s available to AskTheGarden in seconds.'
                : 'Try clearing the search or the locale filter.'
            }
            action={
              recent.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setLocaleFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {visibleRecent.map((d) => (
              <li
                key={d.id}
                style={{
                  padding: `${space[3]} ${space[4]}`,
                  border: `1px solid ${colors.lineSoft}`,
                  borderRadius: radius.md,
                  display: 'flex',
                  gap: space[4],
                  alignItems: 'flex-start',
                  background: colors.paper,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong
                      style={{
                        color: colors.forestDeep,
                        fontFamily: font.display,
                        fontSize: fontSize.lg,
                      }}
                    >
                      {d.title.replace(/^__manual__:/, '')}
                    </strong>
                    <StatusPill tone="neutral" dot>
                      {LOCALE_LABELS[d.locale] ?? d.locale}
                    </StatusPill>
                    <StatusPill tone="info" dot>
                      {d.chunks} chunk{d.chunks === 1 ? '' : 's'}
                    </StatusPill>
                    <span
                      style={{
                        fontSize: fontSize.sm,
                        color: colors.inkFaint,
                        marginLeft: 'auto',
                      }}
                      title={new Date(d.createdAt).toLocaleString()}
                    >
                      {new Date(d.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: fontSize.sm,
                      color: colors.inkMute,
                      marginTop: 6,
                      lineHeight: 1.55,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {d.bodyPreview}
                  </div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void remove(d.id, d.title.replace(/^__manual__:/, ''))}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.cream,
  fontSize: fontSize.base,
  fontFamily: font.body,
  color: colors.ink,
  boxSizing: 'border-box',
};

export default IngestDoc;
