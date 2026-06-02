'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * Locale switcher. Desktop renders the classic inline EN · FI · SV pill (the
 * `.lang-options` wrapper dissolves via `display: contents` in globals.css, so
 * the links stay direct flex children and look identical to before). On mobile
 * (≤768px) it collapses to a single "EN ▾" toggle that opens a small popover —
 * reclaiming ~100px from the cramped topbar row. State lives here; all layout
 * is in globals.css (`.lang-toggle` / `.lang-options` / `.lang-caret`).
 */
const LOCALES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'fi', label: 'FI', name: 'Suomi' },
  { code: 'sv', label: 'SV', name: 'Svenska' },
] as const;

export function LangSwitcher({ locale }: { locale: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  // Close the mobile popover on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="lang-pill"
      role="group"
      aria-label="Language"
      data-open={open || undefined}
    >
      <button
        type="button"
        className="lang-toggle"
        aria-expanded={open}
        aria-controls="lang-options"
        aria-label={`Language: ${current.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {current.label}
        <span aria-hidden="true" className="lang-caret">▾</span>
      </button>
      <div className="lang-options" id="lang-options">
        {LOCALES.map((l) => (
          <Link
            key={l.code}
            href={`/${l.code}`}
            className={locale === l.code ? 'active' : ''}
            hrefLang={l.code}
            aria-label={l.name}
            onClick={() => setOpen(false)}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
