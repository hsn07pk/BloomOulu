'use client';
/**
 * Topbar cart indicator. Shows the current item count, and on click
 * expands into a small dropdown listing each item (plant + tier) so
 * visitors can glance at what's queued without leaving the page.
 *
 * Hidden until hydrated (the server has no localStorage). Plant titles
 * are fetched lazily on first open and cached per slug; the dropdown
 * still renders immediately with the raw slug as a placeholder so the
 * UI doesn't block on the network.
 *
 * Closes on:
 *   - click outside the dropdown
 *   - Escape key
 *   - navigation to /cart or /adopt
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCart, type CartItem } from '../lib/cart.client';

interface PlantSummary {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  taxon?: { latinName: string } | null;
}

const TIER_LABEL: Record<CartItem['tierId'], string> = {
  seedling: 'Seedling',
  rooted: 'Rooted',
  vulnerable: 'Vulnerable',
  endangered: 'Endangered',
  corporate: 'Corporate',
};

function tierLabel(id: CartItem['tierId']): string {
  return TIER_LABEL[id] ?? id;
}

function localisedPlantTitle(p: PlantSummary, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

export default function CartBadge({ locale }: { locale: string }) {
  const { cart, count, hydrated, remove } = useCart();
  const [open, setOpen] = useState(false);
  const [plants, setPlants] = useState<Record<string, PlantSummary>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Lazy-fetch plant titles for every slug we haven't seen yet.
  // Same-origin /v1/* is rewritten by next.config.mjs to the api so no
  // CORS dance and no need for an apiUrl prop.
  useEffect(() => {
    if (!hydrated || !open) return;
    const slugs = cart.items.map((i) => i.plantSlug).filter((s) => !(s in plants));
    if (slugs.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        slugs.map(async (slug) => {
          try {
            const res = await fetch(`/v1/plants/${encodeURIComponent(slug)}`, {
              cache: 'force-cache',
            });
            return res.ok ? ((await res.json()) as PlantSummary) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setPlants((prev) => {
        const next = { ...prev };
        for (let i = 0; i < slugs.length; i++) {
          const data = results[i];
          if (data) next[slugs[i]!] = { ...data, slug: slugs[i]! };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, open, cart.items, plants]);

  // Click-outside + ESC close the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // SSR + empty-cart fall-through: render nothing (matches previous behaviour).
  if (!hydrated || count === 0) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Adoption cart, ${count} item${count === 1 ? '' : 's'}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 999,
          background: open ? 'var(--forest)' : 'var(--sage-pale)',
          color: open ? 'var(--cream)' : 'var(--forest-deep)',
          textDecoration: 'none',
          fontSize: 14,
          fontWeight: 500,
          border: '1px solid var(--line)',
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">🌿</span>
        <span>{count}</span>
        <span aria-hidden="true" style={{ fontSize: 10, marginLeft: 2 }}>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Cart contents"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 280,
            maxWidth: 360,
            background: 'var(--paper, #FFFFFF)',
            border: '1px solid var(--line, rgba(31,58,44,0.12))',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            zIndex: 50,
            padding: 8,
          }}
        >
          <div
            className="tiny"
            style={{
              padding: '6px 10px',
              color: 'var(--ink-mute, #5A6E63)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {locale === 'fi' ? 'Korissa' : locale === 'sv' ? 'I korgen' : 'In cart'} ·{' '}
            {count} {count === 1 ? (locale === 'fi' ? 'kasvi' : locale === 'sv' ? 'växt' : 'plant') : (locale === 'fi' ? 'kasvia' : locale === 'sv' ? 'växter' : 'plants')}
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {cart.items.map((it) => {
              const p = plants[it.plantSlug];
              const title = p
                ? localisedPlantTitle(p, locale)
                : it.plantSlug.replace(/-/g, ' ');
              const latin = p?.taxon?.latinName ?? null;
              return (
                <li
                  key={it.plantSlug}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px',
                    borderTop: '1px solid var(--line, rgba(31,58,44,0.08))',
                  }}
                >
                  <Link
                    href={`/${locale}/plants/${it.plantSlug}`}
                    onClick={close}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: 'inherit',
                      textDecoration: 'none',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: 'var(--ink, #1F3C2D)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {latin ?? title}
                    </div>
                    <div
                      className="tiny"
                      style={{
                        color: 'var(--ink-mute, #5A6E63)',
                        marginTop: 2,
                      }}
                    >
                      {latin ? title : ''}
                      {latin ? ' · ' : ''}
                      {tierLabel(it.tierId)}
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(it.plantSlug)}
                    aria-label={`Remove ${title} from cart`}
                    title={locale === 'fi' ? 'Poista' : locale === 'sv' ? 'Ta bort' : 'Remove'}
                    style={{
                      flexShrink: 0,
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--ink-mute, #5A6E63)',
                      cursor: 'pointer',
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: 8,
              borderTop: '1px solid var(--line, rgba(31,58,44,0.08))',
            }}
          >
            <Link
              href={`/${locale}/cart`}
              onClick={close}
              className="btn btn-secondary small"
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 13,
                padding: '8px 12px',
              }}
            >
              {locale === 'fi' ? 'Tarkastele' : locale === 'sv' ? 'Visa' : 'View cart'}
            </Link>
            <Link
              href={`/${locale}/adopt`}
              onClick={close}
              className="btn btn-primary small"
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 13,
                padding: '8px 12px',
              }}
            >
              {locale === 'fi' ? 'Maksulle' : locale === 'sv' ? 'Till kassan' : 'Checkout'}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
