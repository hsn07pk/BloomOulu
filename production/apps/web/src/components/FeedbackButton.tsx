'use client';

import { useTranslations } from 'next-intl';

/**
 * Floating "Feedback" pill — bottom-left, every page, sits horizontally
 * adjacent to the A11y pill. Just an external link to the Google Form
 * where we collect site-wide UX feedback. No panel to expand, no
 * preferences to persist.
 *
 * Placement notes:
 *   - The A11y pill is at left: 16. Its rendered width depends on
 *     locale ("Accessibility" / "Saavutettavuus" / "Tillgänglighet"),
 *     longest being Swedish at ~200px. We start this pill at left: 220
 *     so the two never overlap even in the widest-text locale.
 *   - zIndex matches the A11y pill (100). The CookieBanner sits at
 *     zIndex: 1000 on the OPPOSITE corner (bottom-right) so there's no
 *     interaction.
 *
 * To rotate the form (new questions, different audience), just swap
 * the URL constant below — no other change is needed; the pill is
 * already wired to open it in a new tab.
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
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 100,
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
      {t('title')}
    </a>
  );
}
