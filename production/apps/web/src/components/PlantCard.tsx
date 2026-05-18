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

interface PlantCardProps {
  plant: PlantIndexItem;
  locale: string;
  adoptersLabel: string;
}

export function PlantCard({ plant: p, locale, adoptersLabel }: PlantCardProps) {
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
          {p.taxon?.latinName ?? p.nameEn}
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {plantLocalisedName(p, locale)}
          {locale !== 'en' ? ` · ${p.nameEn}` : ''}
        </div>
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
            {p.bloomWindow ?? p.bloomSeason}
          </span>
        </div>
      </div>
    </Link>
  );
}
