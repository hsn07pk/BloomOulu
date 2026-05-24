import Link from 'next/link';
import type { PlantIndexItem } from './PlantIndex.client';

const ACCENT_PALETTE = ['#E8EEDE', '#F1E6CB', '#F0DCD0', '#D6EBE3'];

export function plantCardAccent(id: string): string {
  const key = id.replace(/-/g, '').slice(-1);
  return ACCENT_PALETTE[Number.parseInt(key, 16) % ACCENT_PALETTE.length]!;
}

export function plantLocalisedName(p: PlantIndexItem, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

export function plantAltText(p: PlantIndexItem, locale: string): string {
  if (!p.primaryImage) return p.nameEn;
  if (locale === 'fi') return p.primaryImage.altFi;
  if (locale === 'sv') return p.primaryImage.altSv;
  return p.primaryImage.altEn;
}

/**
 * Localised human label for the `BloomSeason` enum
 * (spring | summer | autumn | winter | all). The DB stores raw enum values;
 * UI surfaces ('all' especially) were leaking through as cryptic tags.
 * Kept here so every plant-display site renders the same wording.
 */
const BLOOM_SEASON_LABELS: Record<string, Record<string, string>> = {
  en: { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter', all: 'Year-round' },
  fi: { spring: 'Kevät', summer: 'Kesä', autumn: 'Syksy', winter: 'Talvi', all: 'Vuoden ympäri' },
  sv: { spring: 'Vår', summer: 'Sommar', autumn: 'Höst', winter: 'Vinter', all: 'Året om' },
};

export function bloomSeasonLabel(
  season: string | null | undefined,
  locale: string,
): string {
  if (!season) return '';
  const dict = BLOOM_SEASON_LABELS[locale] ?? BLOOM_SEASON_LABELS.en!;
  return dict[season] ?? BLOOM_SEASON_LABELS.en![season] ?? season;
}

/**
 * Best display string for a plant's bloom timing. Prefers the curator-set
 * `bloomWindow` (e.g. "May–June") when present, otherwise falls back to a
 * localised enum label.
 */
export function plantBloomLabel(p: PlantIndexItem, locale: string): string {
  return p.bloomWindow ?? bloomSeasonLabel(p.bloomSeason, locale);
}

/**
 * Common-name subline for plant cards, robust against the data shape where
 * 99% of `nameEn` rows fall back to the Latin name. Returns null when the
 * available common-name candidates are all identical to the Latin name —
 * so the caller can hide the line entirely instead of rendering a
 * duplicate of the main heading.
 *
 *   - locale=en  →  nameEn, hidden if same as latin
 *   - locale=fi  →  nameFi, plus ` · nameEn` if distinct; both hidden if same as latin
 *   - locale=sv  →  nameSv, plus ` · nameEn` if distinct; both hidden if same as latin
 */
export function plantSubName(
  p: PlantIndexItem,
  locale: string,
  latin: string | null | undefined,
): string | null {
  const norm = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : '');
  const latinKey = norm(latin);
  const same = (s: string | null | undefined) => norm(s) === latinKey;

  const local = plantLocalisedName(p, locale);
  const parts: string[] = [];
  const seen = new Set<string>();

  const push = (s: string | null | undefined) => {
    if (!s) return;
    if (latinKey && same(s)) return;
    const key = norm(s);
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(s);
  };

  push(local);
  if (locale !== 'en') push(p.nameEn);

  return parts.length ? parts.join(' · ') : null;
}

interface PlantCardProps {
  plant: PlantIndexItem;
  locale: string;
  adoptersLabel: string;
}

export function PlantCard({ plant: p, locale, adoptersLabel }: PlantCardProps) {
  const latin = p.taxon?.latinName ?? null;
  const sub = plantSubName(p, locale, latin);
  return (
    <Link
      href={`/${locale}/plants/${p.slug}`}
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
      }}
    >
      <div
        style={{
          height: 220,
          background: plantCardAccent(p.id),
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {p.primaryImage?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.primaryImage.url}
            alt={plantAltText(p, locale)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 64,
            }}
            aria-hidden="true"
          >
            🌿
          </div>
        )}
        <div style={{ position: 'absolute', top: 14, left: 14 }}>
          <span className={`badge badge-${p.redListStatus.toLowerCase()}`}>{p.redListStatus}</span>
        </div>
      </div>
      <div style={{ padding: 18 }}>
        <div
          className="serif"
          style={{
            fontSize: 22,
            color: 'var(--ink)',
            fontStyle: 'italic',
            lineHeight: 1.05,
          }}
        >
          {latin ?? p.nameEn}
        </div>
        {sub && (
          <div className="small muted" style={{ marginTop: 4 }}>
            {sub}
          </div>
        )}
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div className="tiny">{adoptersLabel}</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{p.adopterCount ?? 0}</div>
          </div>
          <span className="pill" style={{ fontSize: 11 }}>
            {plantBloomLabel(p, locale)}
          </span>
        </div>
      </div>
    </Link>
  );
}
