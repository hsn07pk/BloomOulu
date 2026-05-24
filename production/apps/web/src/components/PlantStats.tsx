'use client';

import { useTranslations } from 'next-intl';

/**
 * Community-engagement tile for the plant detail page. Sits above the
 * adoption card in the sticky right column so donors see "X people care
 * about this plant" right before the donation CTA — social-proof framing.
 *
 * Stats wired:
 *   - scanCount     QR scans on the physical garden label
 *   - saveCount     Users who bookmarked the plant
 *   - lastAdoptedAt Most recent active adoption (relative time)
 *   - askCount      RAG answers whose retrieved chunks linked to this plant
 *
 * All four feed off DB columns / aggregates that the /v1/plants/:slug
 * controller now returns. See docs/handover-files/stats-roadmap.md for
 * the broader plan.
 *
 * A "client" component because:
 *   - It picks a translation key based on locale-aware relative-time math
 *     that's nicer to compute in the browser (timezone, DST, etc.)
 *   - Composes inside the existing `plant.client.tsx` ('use client') so
 *     server/client boundary is irrelevant here.
 */

export interface PlantStatsProps {
  scanCount: number;
  saveCount: number;
  askCount: number;
  /** ISO string from the controller; null if no active adoptions yet. */
  lastAdoptedAt: string | null;
  locale: string;
}

const numberLocale = (locale: string): string =>
  locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';

/**
 * Build a locale-aware "N units ago" string from a past ISO timestamp.
 * Buckets: just now (<1 min), N min, N h, yesterday, N days, N weeks,
 * N months, N years. Returns null when the input is null.
 */
function useRelativeTime(iso: string | null, locale: string): string | null {
  const t = useTranslations('Plant');
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return null;

  const sec = diffMs / 1000;
  const min = sec / 60;
  const hr = min / 60;
  const day = hr / 24;
  const week = day / 7;
  const month = day / 30.44;
  const year = day / 365.25;

  const fmt = new Intl.NumberFormat(numberLocale(locale));
  const fmtN = (n: number) => fmt.format(Math.max(1, Math.round(n)));

  if (sec < 60) return t('timeJustNow');
  if (min < 60) return t('timeMinutesAgo', { n: fmtN(min) });
  if (hr < 24) return t('timeHoursAgo', { n: fmtN(hr) });
  if (day < 2) return t('timeYesterday');
  if (day < 7) return t('timeDaysAgo', { n: fmtN(day) });
  if (week < 5) return t('timeWeeksAgo', { n: fmtN(week) });
  if (month < 12) return t('timeMonthsAgo', { n: fmtN(month) });
  return t('timeYearsAgo', { n: fmtN(year) });
}

export function PlantStats({
  scanCount,
  saveCount,
  askCount,
  lastAdoptedAt,
  locale,
}: PlantStatsProps) {
  const t = useTranslations('Plant');
  const fmt = new Intl.NumberFormat(numberLocale(locale));
  const adoptedRelative = useRelativeTime(lastAdoptedAt, locale);

  const tiles: Array<{ icon: string; value: string; label: string; muted?: boolean }> = [
    { icon: '👁', value: fmt.format(scanCount), label: t('statsVisits') },
    { icon: '♥', value: fmt.format(saveCount), label: t('statsSaved') },
    {
      icon: '🌱',
      value: adoptedRelative ?? t('statsLastAdoptedNever'),
      label: t('statsLastAdopted'),
      muted: !adoptedRelative,
    },
    { icon: '🤖', value: fmt.format(askCount), label: t('statsQuestions') },
  ];

  return (
    <div
      className="card"
      style={{
        padding: 16,
        marginBottom: 16,
        borderRadius: 24,
        background: 'var(--paper)',
      }}
    >
      <div
        className="tiny"
        style={{
          color: 'var(--ink-mute)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        {t('statsTitle')}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
        }}
      >
        {tiles.map((tile) => (
          <div
            key={tile.label}
            style={{
              padding: '12px 14px',
              background: 'var(--bg, rgba(31,58,44,0.03))',
              borderRadius: 14,
              minHeight: 64,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
                {tile.icon}
              </span>
              <span
                className="serif"
                style={{
                  fontSize: tile.muted ? 13 : 18,
                  color: tile.muted ? 'var(--ink-mute)' : 'var(--ink)',
                  fontStyle: tile.muted ? 'italic' : 'normal',
                  lineHeight: 1.1,
                  fontWeight: 600,
                }}
              >
                {tile.value}
              </span>
            </div>
            <div
              className="tiny"
              style={{
                color: 'var(--ink-mute)',
                marginTop: 6,
              }}
            >
              {tile.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
