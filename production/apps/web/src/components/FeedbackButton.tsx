'use client';

import { useTranslations } from 'next-intl';

/**
 * Floating "Feedback" pill — an external link to the Google Form where we
 * collect site-wide UX feedback. No panel to expand, no preferences to persist.
 *
 * Positioning is NOT here: it renders as a flex item inside the shared
 * FloatingTools dock (bottom-left, below the Accessibility pill), which owns
 * the fixed position, z-index and the footer-aware hide. On mobile the dock's
 * CSS turns this into a compact icon-only circle (`.fab-label` is hidden).
 *
 * To rotate the form (new questions, different audience), just swap the URL
 * constant below — no other change is needed; the pill opens it in a new tab.
 */

// Env-driven so a new instance points the pill at its own form without a code
// edit. Falls back to the BloomOulu form; build-time NEXT_PUBLIC_* inline.
const FEEDBACK_FORM_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? 'https://forms.gle/6U2eujFaoZqfsiJQ6';

export function FeedbackButton(): JSX.Element {
  const t = useTranslations('Feedback');

  return (
    <a
      className="feedback-fab"
      href={FEEDBACK_FORM_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('aria')}
      title={t('title')}
      style={{
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
        textDecoration: 'none',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
        💬
      </span>
      <span className="fab-label">{t('title')}</span>
    </a>
  );
}
