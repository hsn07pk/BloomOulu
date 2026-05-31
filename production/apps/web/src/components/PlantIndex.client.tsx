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

// IUCN-style red-list codes — full set matches Prisma's RedListStatus enum.
// (EX was missing from the original UI; DD had no badge CSS — both fixed.)
type RedListId = 'All' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC' | 'DD' | 'EX' | 'NA';
type BloomId = 'any' | 'spring' | 'summer' | 'autumn' | 'winter' | 'all';
type AdoptedId = 'any' | 'true' | 'false';

interface PlantIndexProps {
  locale: string;
  apiUrl: string;
  initialItems: PlantIndexItem[];
  initialTotal: number;
  initialTotalPages: number;
}

interface FamilyOption {
  family: string;
  count: number;
}

const PAGE_SIZE = 24;
const RED_LIST_ORDER: RedListId[] = ['All', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'EX', 'NA'];
const BLOOM_ORDER: BloomId[] = ['any', 'spring', 'summer', 'autumn', 'winter', 'all'];
const ADOPTED_ORDER: AdoptedId[] = ['any', 'false', 'true'];

const RED_LIST_DOT: Partial<Record<RedListId, string>> = {
  CR: '#B8513A',
  EN: '#C77E45',
  VU: '#C19A3D',
  NT: '#88A050',
  EX: '#2a2a2a',
};

const BLOOM_KEY: Record<BloomId, string> = {
  any: 'bloomFilterAll',
  spring: 'bloomFilterSpring',
  summer: 'bloomFilterSummer',
  autumn: 'bloomFilterAutumn',
  winter: 'bloomFilterWinter',
  all: 'bloomFilterYearRound',
};

const ADOPTED_KEY: Record<AdoptedId, string> = {
  any: 'adoptionFilterAll',
  false: 'adoptionFilterAvailable',
  true: 'adoptionFilterAdopted',
};

/**
 * Build the elided page-number sequence for the pagination strip.
 * Returns positive integers (real pages) and the sentinel 0 (= ellipsis).
 *
 *   total=20, current=10 → [1, 0, 8, 9, 10, 11, 12, 0, 20]
 *
 * Anchors first and last; window of ±2 around current; collapses gaps to
 * a single ellipsis token. Keeps the strip 5-9 buttons wide regardless of
 * total page count.
 */
function pagerSequence(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const seq: number[] = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  if (start > 2) seq.push(0);
  for (let p = start; p <= end; p++) seq.push(p);
  if (end < total - 1) seq.push(0);
  seq.push(total);
  return seq;
}

export function PlantIndex({
  locale,
  apiUrl,
  initialItems,
  initialTotal,
  initialTotalPages,
}: PlantIndexProps) {
  const t = useTranslations('Plants');

  const [query, setQuery] = useState('');
  const [redList, setRedList] = useState<RedListId>('All');
  const [bloom, setBloom] = useState<BloomId>('any');
  const [adopted, setAdopted] = useState<AdoptedId>('any');
  const [family, setFamily] = useState<string>('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<PlantIndexItem[]>(initialItems);
  const [total, setTotal] = useState<number>(initialTotal);
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const isFirstRun = useRef(true);

  const hasFilter =
    query.trim().length >= 2 ||
    redList !== 'All' ||
    bloom !== 'any' ||
    adopted !== 'any' ||
    family !== '';

  // ── Data fetching ─────────────────────────────────────────────────

  const buildUrl = (path: 'plants' | 'plants/count', p: number): string => {
    const params = new URLSearchParams();
    if (path === 'plants') {
      params.set('limit', String(PAGE_SIZE));
      params.set('page', String(p));
    }
    if (query.trim().length >= 2) params.set('q', query.trim());
    if (redList !== 'All') params.set('redList', redList);
    if (bloom !== 'any') params.set('bloomSeason', bloom);
    if (adopted !== 'any') params.set('hasAdopters', adopted);
    if (family) params.set('family', family);
    return `${apiUrl}/v1/${path}?${params.toString()}`;
  };

  const fetchPage = async (p: number) => {
    const myReqId = ++reqIdRef.current;
    try {
      const res = await fetch(buildUrl('plants', p), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (myReqId !== reqIdRef.current) return; // a newer request superseded
      setItems(data.items ?? []);
      setTotal(typeof data.total === 'number' ? data.total : (data.items?.length ?? 0));
      setTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1);
      setError(null);
    } catch (e) {
      if (myReqId !== reqIdRef.current) return;
      setError((e as Error).message);
    }
  };

  // Re-fetch on filter / search / page change. Filter changes reset page
  // to 1 via their setters (see handlers); this effect just observes.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return; // initial SSR data already loaded — skip the first run
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        fetchPage(page);
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, redList, bloom, adopted, family, page]);

  // Fetch families once on mount for the dropdown.
  useEffect(() => {
    let alive = true;
    fetch(`${apiUrl}/v1/plants/families?limit=80`, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (alive) setFamilies(d.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [apiUrl]);

  // ── Filter setters (reset page to 1) ──────────────────────────────

  const setRedListAndReset = (v: RedListId) => {
    setRedList(v);
    setPage(1);
  };
  const setBloomAndReset = (v: BloomId) => {
    setBloom(v);
    setPage(1);
  };
  const setAdoptedAndReset = (v: AdoptedId) => {
    setAdopted(v);
    setPage(1);
  };
  const setFamilyAndReset = (v: string) => {
    setFamily(v);
    setPage(1);
  };
  const setQueryAndReset = (v: string) => {
    setQuery(v);
    setPage(1);
  };

  const clearAll = () => {
    setQuery('');
    setRedList('All');
    setBloom('any');
    setAdopted('any');
    setFamily('');
    setPage(1);
  };

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    // Scroll the grid into view smoothly so the new page isn't off-screen.
    requestAnimationFrame(() => {
      gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // ── Computed labels ───────────────────────────────────────────────

  /**
   * Counter label shown after the X/Y count. Picks the most specific
   * single filter, else falls back to a generic "plants".
   */
  const counterLabel = useMemo((): string => {
    const activeCount =
      (redList !== 'All' ? 1 : 0) +
      (bloom !== 'any' ? 1 : 0) +
      (adopted !== 'any' ? 1 : 0) +
      (family ? 1 : 0);
    const plantsWord = t('labelPlants');
    if (activeCount === 0) return plantsWord;
    if (activeCount === 1) {
      if (redList !== 'All') return `${t(`filter${redList}` as 'filterAll')} ${plantsWord}`;
      if (bloom !== 'any') return `${t(BLOOM_KEY[bloom] as 'bloomFilterAll')} ${plantsWord}`;
      if (adopted !== 'any') return t(ADOPTED_KEY[adopted] as 'adoptionFilterAll');
      if (family) return `${family} ${plantsWord}`;
    }
    return plantsWord;
  }, [redList, bloom, adopted, family, t]);

  const showEmpty = !isPending && items.length === 0;
  const pages = useMemo(() => pagerSequence(page, totalPages), [page, totalPages]);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <section className="container" id="plants" style={{ paddingTop: 64, paddingBottom: 64 }}>
      {/* ── Header + search ──────────────────────────────────────── */}
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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%', maxWidth: 320 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <label htmlFor="plant-search" className="sr-only">
              {t('searchAria')}
            </label>
            <input
              id="plant-search"
              type="search"
              placeholder={t('search')}
              value={query}
              onChange={(e) => setQueryAndReset(e.target.value)}
              aria-label={t('searchAria')}
              style={{
                padding: '12px 40px 12px 40px',
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--paper)',
                width: '100%',
                maxWidth: 320,
                fontSize: 14,
                color: 'var(--ink)',
                outline: 'none',
                boxSizing: 'border-box',
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
                onClick={() => setQueryAndReset('')}
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

      {/* ── Filter rows ──────────────────────────────────────────── */}
      <div
        className="plant-filters"
        style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}
      >
        {/* Red list */}
        <FilterRow label={t('filters')}>
          {RED_LIST_ORDER.map((f) => (
            <PillButton
              key={f}
              active={redList === f}
              onClick={() => setRedListAndReset(f)}
              dot={RED_LIST_DOT[f]}
              label={t(`filter${f}` as 'filterAll')}
            />
          ))}
        </FilterRow>

        {/* Bloom season */}
        <FilterRow label={t('bloomFilterTitle')}>
          {BLOOM_ORDER.map((b) => (
            <PillButton
              key={b}
              active={bloom === b}
              onClick={() => setBloomAndReset(b)}
              label={t(BLOOM_KEY[b] as 'bloomFilterAll')}
            />
          ))}
        </FilterRow>

        {/* Adopted status + Family dropdown share a row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 24,
            alignItems: 'center',
          }}
        >
          <FilterRow label={t('adoptionFilterTitle')} inline>
            {ADOPTED_ORDER.map((a) => (
              <PillButton
                key={a}
                active={adopted === a}
                onClick={() => setAdoptedAndReset(a)}
                label={t(ADOPTED_KEY[a] as 'adoptionFilterAll')}
              />
            ))}
          </FilterRow>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="tiny"
              style={{ color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}
            >
              {t('familyFilterTitle')}
            </span>
            <input
              list="plant-family-list"
              type="search"
              value={family}
              onChange={(e) => setFamilyAndReset(e.target.value)}
              placeholder={t('familyFilterPlaceholder')}
              aria-label={t('familyFilterTitle')}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--paper)',
                width: 220,
                fontSize: 13,
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
            <datalist id="plant-family-list">
              {families.map((f) => (
                <option key={f.family} value={f.family}>
                  {f.count} plants
                </option>
              ))}
            </datalist>
            {family && (
              <button
                type="button"
                onClick={() => setFamilyAndReset('')}
                aria-label={t('clearSearch')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--ink-mute)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Counter ──────────────────────────────────────────────── */}
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
          : items.length > 0
            ? t('showingOf', { count: items.length, total, label: counterLabel })
            : ''}
      </div>

      {/* ── Empty state ──────────────────────────────────────────── */}
      {showEmpty && (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 36 }} aria-hidden="true">🔍</div>
          <div className="serif" style={{ fontSize: 22, marginTop: 12 }}>
            {t('noMatch')}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {t('noMatchHint')}
          </p>
          {hasFilter && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 18 }}
              onClick={clearAll}
            >
              {t('clearSearch')}
            </button>
          )}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────── */}
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

      {/* ── Plant grid ───────────────────────────────────────────── */}
      {items.length > 0 && (
        <div
          ref={gridRef}
          data-grid-mobile="2"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 20,
            opacity: isPending ? 0.55 : 1,
            transition: 'opacity 120ms',
            scrollMarginTop: 24,
          }}
        >
          {items.map((p) => (
            <PlantCard key={p.id} plant={p} locale={locale} adoptersLabel={t('adopters')} />
          ))}
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────────── */}
      {items.length > 0 && totalPages > 1 && (
        <nav
          aria-label={t('filters')}
          style={{
            marginTop: 32,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <PagerButton
            disabled={page <= 1 || isPending}
            onClick={() => goToPage(page - 1)}
            label={`‹ ${t('prevPage')}`}
            ariaLabel={t('prevPage')}
          />
          {pages.map((p, i) =>
            p === 0 ? (
              <span
                key={`ellipsis-${i}`}
                aria-hidden="true"
                style={{ padding: '0 6px', color: 'var(--ink-mute)' }}
              >
                …
              </span>
            ) : (
              <PagerButton
                key={p}
                active={p === page}
                disabled={isPending}
                onClick={() => goToPage(p)}
                label={String(p)}
                ariaLabel={`${t('pageOfTotal', { page: p, total: totalPages })}`}
              />
            ),
          )}
          <PagerButton
            disabled={page >= totalPages || isPending}
            onClick={() => goToPage(page + 1)}
            label={`${t('nextPage')} ›`}
            ariaLabel={t('nextPage')}
          />
        </nav>
      )}

      {/* Page-of-total caption under the pager, redundant with the buttons
          but a useful at-a-glance for screen readers / wide screens. */}
      {items.length > 0 && totalPages > 1 && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 12,
            fontSize: 12,
            color: 'var(--ink-mute)',
          }}
        >
          {t('pageOfTotal', { page, total: totalPages })}
        </div>
      )}
    </section>
  );
}

// ── Local presentational components ───────────────────────────────────

function FilterRow({
  label,
  inline,
  children,
}: {
  label: string;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        ...(inline ? {} : { width: '100%' }),
      }}
    >
      <span
        className="tiny"
        style={{
          color: 'var(--ink-mute)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          minWidth: 96,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function PillButton({
  active,
  onClick,
  dot,
  label,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="pill"
      style={{
        cursor: 'pointer',
        background: active ? 'var(--forest)' : 'rgba(31,58,44,0.06)',
        color: active ? 'var(--cream)' : 'var(--ink-2)',
        padding: '7px 14px',
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
      {label}
    </button>
  );
}

function PagerButton({
  active,
  disabled,
  onClick,
  label,
  ariaLabel,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      style={{
        minWidth: 36,
        height: 36,
        padding: '0 10px',
        borderRadius: 8,
        border: active ? '1px solid var(--forest)' : '1px solid var(--line)',
        background: active ? 'var(--forest)' : 'var(--paper)',
        color: active ? 'var(--cream)' : 'var(--ink)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !active ? 0.4 : 1,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      {label}
    </button>
  );
}
