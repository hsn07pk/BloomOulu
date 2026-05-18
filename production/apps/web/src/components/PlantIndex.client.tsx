'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { PlantCard } from './PlantCard';

export interface PlantIndexItem {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  bloomSeason: string;
  bloomWindow?: string | null;
  adopterCount?: number;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
  taxon?: { latinName: string; family?: string } | null;
}

type FilterId = 'All' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC' | 'DD' | 'NA';

interface PlantIndexProps {
  locale: string;
  apiUrl: string;
  initialItems: PlantIndexItem[];
  initialCursor: string | null;
}

const FILTER_ORDER: FilterId[] = ['All', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NA'];

const FILTER_DOT_COLOR: Partial<Record<FilterId, string>> = {
  CR: '#B8513A',
  EN: '#C77E45',
  VU: '#C19A3D',
  NT: '#88A050',
};

export function PlantIndex({ locale, apiUrl, initialItems, initialCursor }: PlantIndexProps) {
  const t = useTranslations('Plants');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('All');
  const [items, setItems] = useState<PlantIndexItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [isPending, startTransition] = useTransition();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  const isSearchMode = query.trim().length >= 2 || filter !== 'All';
  const hasMore = cursor !== null;

  const buildUrl = (q: string, f: FilterId, cur: string | null): string => {
    const params = new URLSearchParams();
    params.set('limit', '24');
    if (q.trim().length >= 2) params.set('q', q.trim());
    if (f !== 'All') params.set('redList', f);
    if (cur) params.set('cursor', cur);
    return `${apiUrl}/v1/plants?${params.toString()}`;
  };

  const fetchPage = async (
    q: string,
    f: FilterId,
    cur: string | null,
    mode: 'replace' | 'append',
  ) => {
    const myReqId = ++reqIdRef.current;
    try {
      const res = await fetch(buildUrl(q, f, cur), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (myReqId !== reqIdRef.current) return; // a newer request has superseded
      const newItems: PlantIndexItem[] = data.items ?? [];
      const newCursor: string | null = data.nextCursor ?? null;
      setItems((prev) => (mode === 'append' ? [...prev, ...newItems] : newItems));
      setCursor(newCursor);
      setError(null);
    } catch (e) {
      if (myReqId !== reqIdRef.current) return;
      setError((e as Error).message);
    }
  };

  // Debounced refetch when query or filter changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // If user is back to the empty/no-filter state, restore SSR initial set
    // without a network call so the page feels instant.
    if (query.trim().length === 0 && filter === 'All') {
      setItems(initialItems);
      setCursor(initialCursor);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        fetchPage(query, filter, null, 'replace');
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter]);

  const onLoadMore = async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    await fetchPage(query, filter, cursor, 'append');
    setIsLoadingMore(false);
  };

  const onClear = () => {
    setQuery('');
    setFilter('All');
  };

  const visible = useMemo(() => items, [items]);
  const showEmpty = !isPending && visible.length === 0;

  return (
    <section className="container" id="plants" style={{ paddingTop: 64, paddingBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
            {t('collection')}
          </div>
          <h2 style={{ fontSize: 52, marginTop: 8 }}>{t('indexTitle')}</h2>
          <p className="muted" style={{ marginTop: 12, maxWidth: 520 }}>
            {t('indexDesc')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <label htmlFor="plant-search" className="sr-only">
              {t('searchAria')}
            </label>
            <input
              id="plant-search"
              type="search"
              placeholder={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('searchAria')}
              style={{
                padding: '12px 40px 12px 40px',
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--paper)',
                width: 320,
                maxWidth: '100%',
                fontSize: 14,
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-mute)',
                pointerEvents: 'none',
                fontSize: 16,
              }}
            >
              🔍
            </span>
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('clearSearch')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(31,58,44,0.08)',
                  color: 'var(--ink-2)',
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div
        role="group"
        aria-label={t('filters')}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}
      >
        {FILTER_ORDER.map((f) => {
          const active = filter === f;
          const dot = FILTER_DOT_COLOR[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={active}
              className="pill"
              style={{
                cursor: 'pointer',
                background: active ? 'var(--forest)' : 'rgba(31,58,44,0.06)',
                color: active ? 'var(--cream)' : 'var(--ink-2)',
                padding: '8px 16px',
                fontSize: 13,
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {dot && (
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: dot,
                    display: 'inline-block',
                  }}
                />
              )}
              {t(`filter${f}` as 'filterAll')}
            </button>
          );
        })}
      </div>

      {/* live status for screen readers + visual count */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--ink-mute)',
          minHeight: 18,
        }}
      >
        {isPending
          ? t('loading')
          : isSearchMode
            ? t('showingCount', { count: visible.length })
            : ''}
      </div>

      {showEmpty && (
        <div
          className="card card-pad"
          style={{ textAlign: 'center', padding: '48px 24px' }}
        >
          <div style={{ fontSize: 36 }} aria-hidden="true">🔍</div>
          <div className="serif" style={{ fontSize: 22, marginTop: 12 }}>
            {t('noMatch')}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {t('noMatchHint')}
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 18 }}
            onClick={onClear}
          >
            {t('clearSearch')}
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 8,
            background: 'rgba(184,81,58,0.08)',
            color: 'var(--rust-on-light)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {visible.length > 0 && (
        <div
          data-grid-mobile="2"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 20,
            opacity: isPending ? 0.55 : 1,
            transition: 'opacity 120ms',
          }}
        >
          {visible.map((p) => (
            <PlantCard key={p.id} plant={p} locale={locale} adoptersLabel={t('adopters')} />
          ))}
        </div>
      )}

      {hasMore && !showEmpty && (
        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onLoadMore}
            disabled={isLoadingMore || isPending}
            style={{ minWidth: 200 }}
          >
            {isLoadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}
    </section>
  );
}
