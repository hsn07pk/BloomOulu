'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getBrowserApiUrl } from '@bloomoulu/constants';
import { redListBadgeClass, redListBucketLabel } from '@/lib/redlist';

export interface SpeciesLite {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus?: string | null;
}

function speciesName(p: SpeciesLite, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

/**
 * Optional "direct your gift to a species" control for the donate form.
 * Replaces a 48-option <select> with: a collapsed disclosure → a typeahead
 * that searches the whole catalogue (debounced) → the choice shown as a
 * removable chip. Emits the selection via a hidden `plantSlug` input so the
 * existing server action is unchanged. A general gift = no selection.
 */
export function SpeciesSearch({
  locale,
  suggestions,
  preset,
}: {
  locale: string;
  suggestions: SpeciesLite[];
  preset: SpeciesLite | null;
}) {
  const t = useTranslations('Donate');
  const [selected, setSelected] = useState<SpeciesLite | null>(preset);
  // Open the search when the donor expands it, or auto-open if no preset chip.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpeciesLite[]>(suggestions);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced catalogue search. Empty query → show the curated suggestions.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(suggestions);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          `${getBrowserApiUrl()}/v1/plants?q=${encodeURIComponent(q)}&limit=8`,
          { cache: 'no-store' },
        );
        const data = res.ok ? await res.json() : { items: [] };
        setResults((data.items ?? []) as SpeciesLite[]);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query, open, suggestions]);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(p: SpeciesLite) {
    setSelected(p);
    setOpen(false);
    setQuery('');
  }
  function clear() {
    setSelected(null);
    setQuery('');
    setOpen(true);
  }

  return (
    <div className="species" ref={boxRef}>
      <input type="hidden" name="plantSlug" value={selected?.slug ?? ''} />

      {selected ? (
        <div className="field" style={{ gap: 8 }}>
          <span className="label">{t('speciesChosenLabel')}</span>
          <span className="species-chip">
            <span>
              {speciesName(selected, locale)}
              {selected.redListStatus && (
                <span className={redListBadgeClass(selected.redListStatus)} style={{ marginLeft: 8 }}>
                  {redListBucketLabel(selected.redListStatus, locale)}
                </span>
              )}
            </span>
            <button type="button" onClick={clear} aria-label={t('speciesClear')}>
              ×
            </button>
          </span>
        </div>
      ) : !open ? (
        <button
          type="button"
          className="disclosure-toggle"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <span className="caret" aria-hidden="true">▸</span>
          {t('speciesToggle')}
        </button>
      ) : (
        <div className="field">
          <span className="label">{t('speciesLabel')}</span>
          <input
            type="search"
            className="input"
            autoFocus
            placeholder={t('speciesPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            role="combobox"
            aria-expanded
            aria-controls="species-menu"
            aria-autocomplete="list"
          />
          <span className="tiny muted" style={{ letterSpacing: 0, textTransform: 'none' }}>
            {t('speciesHint')}
          </span>
          <div className="species-menu" id="species-menu" role="listbox">
            {query.trim().length < 2 && (
              <div className="tiny muted" style={{ padding: '4px 10px 8px', letterSpacing: 0, textTransform: 'none' }}>
                {t('speciesSuggested')}
              </div>
            )}
            {loading && (
              <div className="species-opt" aria-disabled>
                {t('speciesSearching')}
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="species-opt" aria-disabled>
                {t('speciesNoMatch')}
              </div>
            )}
            {!loading &&
              results.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  className="species-opt"
                  role="option"
                  aria-selected={false}
                  onClick={() => choose(p)}
                >
                  <span style={{ flex: 1 }}>{speciesName(p, locale)}</span>
                  {p.redListStatus && (
                    <span className={redListBadgeClass(p.redListStatus)}>
                      {redListBucketLabel(p.redListStatus, locale)}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
