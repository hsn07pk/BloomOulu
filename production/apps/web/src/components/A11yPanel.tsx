'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { getBrowserApiUrl } from '@bloomoulu/constants';

/**
 * Floating accessibility panel — bottom-left, every page.
 *
 * Toggles three preference dimensions:
 *   - Text size:   small / normal / large
 *   - Contrast:    normal / high
 *   - Motion:      normal / reduced
 *
 * Each preference maps to a body class (e.g. `bloom-larger-text`) that
 * globals.css responds to. Settings persist in TWO places:
 *
 *   1. localStorage  — anonymous users; instant first paint on revisit
 *   2. User.preferences.a11y (server) — signed-in users; roams across
 *      devices. Pushed to the API on each change (best-effort; anonymous
 *      requests get 401 silently). On mount we fetch the server copy and
 *      merge it over the localStorage one — server wins because it's the
 *      most recent change from any device.
 *
 * The component is keyboard-accessible (visible focus rings, native
 * <button>/<input>, ARIA expanded/controls wiring) and renders into a
 * small fixed island so it never obscures more than its own footprint.
 */

type TextSize = 'small' | 'normal' | 'large';
type Contrast = 'normal' | 'high';
type Motion = 'normal' | 'reduced';

interface Prefs {
  textSize: TextSize;
  contrast: Contrast;
  motion: Motion;
}

const DEFAULT_PREFS: Prefs = {
  textSize: 'normal',
  contrast: 'normal',
  motion: 'normal',
};

const LS_KEY = 'a11y.prefs.v2';
const SERVER_DEBOUNCE_MS = 400;

function applyToBody(p: Prefs): void {
  if (typeof document === 'undefined') return;
  const b = document.body.classList;
  b.toggle('bloom-smaller-text', p.textSize === 'small');
  b.toggle('bloom-larger-text', p.textSize === 'large');
  b.toggle('bloom-high-contrast', p.contrast === 'high');
  b.toggle('bloom-reduced-motion', p.motion === 'reduced');
}

function loadFromLocalStorage(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    // New canonical key
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      return {
        textSize: parsed.textSize ?? 'normal',
        contrast: parsed.contrast ?? 'normal',
        motion: parsed.motion ?? 'normal',
      };
    }
    // One-shot migration from the v1 split keys (a11y.textSize / .contrast / .motion).
    // If any are set, lift them into v2 shape and drop the old ones.
    const oldText = window.localStorage.getItem('a11y.textSize');
    const oldContrast = window.localStorage.getItem('a11y.contrast');
    const oldMotion = window.localStorage.getItem('a11y.motion');
    if (oldText || oldContrast || oldMotion) {
      const migrated: Prefs = {
        textSize: oldText === 'large' ? 'large' : 'normal',
        contrast: oldContrast === 'high' ? 'high' : 'normal',
        motion: oldMotion === 'reduced' ? 'reduced' : 'normal',
      };
      window.localStorage.setItem(LS_KEY, JSON.stringify(migrated));
      window.localStorage.removeItem('a11y.textSize');
      window.localStorage.removeItem('a11y.contrast');
      window.localStorage.removeItem('a11y.motion');
      return migrated;
    }
  } catch {
    /* localStorage disabled / corrupt — fall through to defaults */
  }
  return DEFAULT_PREFS;
}

export function A11yPanel() {
  const t = useTranslations('A11y');
  const locale = useLocale();
  const apiUrl = getBrowserApiUrl();

  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push a delta to the server. Anonymous users return 401, which we
  // silently swallow — localStorage is still authoritative for them.
  const pushToServer = useCallback(
    (delta: Partial<Prefs>) => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        fetch(`${apiUrl}/v1/me/a11y`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(delta),
        }).catch(() => undefined);
      }, SERVER_DEBOUNCE_MS);
    },
    [apiUrl],
  );

  // First paint: load from localStorage, apply immediately so SSR markup
  // doesn't "flash" the wrong size/contrast. Then async-fetch the server
  // copy for signed-in roaming.
  useEffect(() => {
    const local = loadFromLocalStorage();
    setPrefs(local);
    applyToBody(local);

    let cancelled = false;
    fetch(`${apiUrl}/v1/me/a11y`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<Partial<Prefs>>) : null))
      .then((server) => {
        if (cancelled || !server) return;
        const merged: Prefs = {
          textSize: server.textSize ?? local.textSize,
          contrast: server.contrast ?? local.contrast,
          motion: server.motion ?? local.motion,
        };
        setPrefs(merged);
        applyToBody(merged);
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(merged));
        } catch {
          /* localStorage disabled — server stays authoritative for this session */
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback(
    (patch: Partial<Prefs>) => {
      setPrefs((cur) => {
        const next = { ...cur, ...patch };
        applyToBody(next);
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(next));
        } catch {
          /* no-op */
        }
        pushToServer(patch);
        return next;
      });
    },
    [pushToServer],
  );

  // ── Styles ─────────────────────────────────────────────────────────
  // Inline so the floating panel never inherits page CSS quirks (the
  // big-font + high-contrast users actually *use* this panel must
  // always render legibly regardless of body state).

  const triggerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 999,
    background: '#1F3C2D',
    color: '#F8F4E6',
    border: '1px solid rgba(0,0,0,0.2)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  };

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    left: 0,
    minWidth: 280,
    background: '#FFFFFF',
    color: '#1F3C2D',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 16,
    boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
    padding: 16,
    fontSize: 14,
    lineHeight: 1.4,
  };

  const segmentedWrap: React.CSSProperties = {
    display: 'inline-flex',
    background: 'rgba(31,58,44,0.06)',
    borderRadius: 999,
    padding: 3,
    gap: 2,
  };

  const segmentBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 999,
    border: 'none',
    background: active ? '#1F3C2D' : 'transparent',
    color: active ? '#F8F4E6' : '#1F3C2D',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    transition: 'background 120ms',
  });

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    margin: '12px 0',
  };

  return (
    <div className="a11y-fab" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="a11y-panel-content"
        aria-label={open ? t('close') : t('open')}
        title={t('title')}
        style={triggerStyle}
      >
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
          ♿
        </span>
        <span className="fab-label">{open ? t('close') : t('title')}</span>
      </button>
      {open && (
        <div
          id="a11y-panel-content"
          role="group"
          aria-label={t('title')}
          style={panelStyle}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <strong style={{ fontSize: 15, color: '#1F3C2D' }}>{t('title')}</strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#5A6E63',
                fontSize: 18,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ×
            </button>
          </div>

          {/* Text size — three-step segmented control */}
          <div style={rowStyle}>
            <span style={{ color: '#1F3C2D' }}>{t('textSize')}</span>
            <div
              role="radiogroup"
              aria-label={t('textSize')}
              style={segmentedWrap}
            >
              {(
                [
                  ['small', t('textSizeSmall')],
                  ['normal', t('textSizeNormal')],
                  ['large', t('textSizeLarge')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={prefs.textSize === value}
                  onClick={() => update({ textSize: value })}
                  style={segmentBtn(prefs.textSize === value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* High contrast */}
          <label style={{ ...rowStyle, cursor: 'pointer' }}>
            <span style={{ color: '#1F3C2D' }}>{t('highContrast')}</span>
            <input
              type="checkbox"
              checked={prefs.contrast === 'high'}
              onChange={(e) =>
                update({ contrast: e.target.checked ? 'high' : 'normal' })
              }
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
          </label>

          {/* Reduce motion */}
          <label style={{ ...rowStyle, cursor: 'pointer' }}>
            <span style={{ color: '#1F3C2D' }}>{t('reduceMotion')}</span>
            <input
              type="checkbox"
              checked={prefs.motion === 'reduced'}
              onChange={(e) =>
                update({ motion: e.target.checked ? 'reduced' : 'normal' })
              }
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
          </label>

          {/* Footer: link to the full accessibility statement page */}
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid rgba(0,0,0,0.08)',
            }}
          >
            <Link
              href={`/${locale}/accessibility-statement`}
              onClick={() => setOpen(false)}
              style={{
                color: '#B65A3F',
                fontSize: 13,
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}
            >
              {t('readStatement')} →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
