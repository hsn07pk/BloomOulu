'use client';
/**
 * Minimal first-visit cookie banner.
 *
 * BloomOulu uses only essential cookies (Auth.js session). No tracking, no
 * analytics, no third-party pixels. GDPR + ePrivacy do not actually require
 * a consent banner for essential cookies alone, but we surface a single
 * notice so the donor knows what's going on. Once dismissed, the choice
 * persists in localStorage and the banner doesn't reappear.
 *
 * a11y: live region for the banner; the button receives focus on mount so
 * keyboard users can dismiss without tabbing. Reduced-motion respected.
 */
import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'bloomoulu.cookieNoticeDismissed';

export function CookieBanner({
  message,
  acknowledge,
  moreInfo,
  moreInfoHref,
}: {
  message: string;
  acknowledge: string;
  moreInfo: string;
  moreInfoHref: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      // localStorage blocked (private mode in some browsers) — show every visit.
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (open) btnRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* fall through — they'll see it again next visit */
    }
    setOpen(false);
  }

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="cookie-banner"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1000,
        maxWidth: 380,
        background: '#FFFFFF',
        color: '#1F3C2D',
        boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
        borderRadius: 8,
        padding: '14px 16px',
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <p style={{ margin: '0 0 8px' }}>{message}</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          ref={btnRef}
          type="button"
          onClick={dismiss}
          style={{
            background: '#2D5440',
            color: '#FFFFFF',
            border: 0,
            padding: '10px 16px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            minHeight: 40,
          }}
        >
          {acknowledge}
        </button>
        <a
          href={moreInfoHref}
          style={{
            color: '#2D5440',
            textDecoration: 'underline',
            fontSize: 13,
            padding: '8px 4px',
            minHeight: 40,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {moreInfo}
        </a>
      </div>
    </div>
  );
}
