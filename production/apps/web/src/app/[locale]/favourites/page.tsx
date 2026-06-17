import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { VoteButton } from './vote-button.client';

export const dynamic = 'force-dynamic';

interface LeaderboardPlant {
  rank: number;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus?: string | null;
  voteCount: number;
  donorCount: number;
  fundedCents: number;
  primaryImage?: { url: string; altEn: string } | null;
}

async function fetchLeaderboard(): Promise<LeaderboardPlant[]> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/votes/leaderboard?limit=50`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.plants ?? [];
  } catch {
    return [];
  }
}

function plantName(p: LeaderboardPlant, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

// Top-three get a subtle medal tint drawn from the botanical palette.
const MEDAL: Record<number, string> = {
  1: 'var(--amber)',
  2: 'var(--sage-bright)',
  3: 'var(--teal-soft)',
};

export default async function FavouritesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Favourites' });
  const plants = await fetchLeaderboard();

  return (
    <article className="fade-in container" style={{ maxWidth: 760, margin: '0 auto', paddingTop: 40, paddingBottom: 72 }}>
      <header style={{ marginBottom: 28 }}>
        <p className="eyebrow eyebrow--rust">{t('eyebrow')}</p>
        <h1 className="serif" style={{ fontSize: 'clamp(32px, 6vw, 48px)', lineHeight: 1.05, marginTop: 8 }}>
          {t('title')}
        </h1>
        <p className="muted" style={{ marginTop: 12, maxWidth: 560, lineHeight: 1.55 }}>{t('lead')}</p>
      </header>

      {plants.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <p className="muted">{t('empty')}</p>
        </div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {plants.map((p) => (
            <li
              key={p.slug}
              className="card card-pad"
              style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
            >
              {/* Rank medal */}
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--f-display)',
                  fontSize: 17,
                  fontWeight: 600,
                  background: MEDAL[p.rank] ?? 'transparent',
                  color: MEDAL[p.rank] ? 'var(--forest-deep)' : 'var(--ink-mute)',
                  border: MEDAL[p.rank] ? 'none' : '1px solid var(--line)',
                }}
              >
                {p.rank}
              </span>

              {/* Thumbnail */}
              {p.primaryImage?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.primaryImage.url}
                  alt={p.primaryImage.altEn ?? ''}
                  width={60}
                  height={60}
                  style={{ objectFit: 'cover', borderRadius: 'var(--radius-lg)', flexShrink: 0 }}
                  loading="lazy"
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 60, height: 60, borderRadius: 'var(--radius-lg)', flexShrink: 0,
                    background: 'var(--sage-pale)', display: 'inline-flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 26,
                  }}
                >
                  🌿
                </span>
              )}

              {/* Name + rarity + count */}
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <Link
                  href={`/${locale}/plants/${p.slug}`}
                  className="serif"
                  style={{ fontSize: 18, color: 'var(--ink)', textDecoration: 'none' }}
                >
                  {plantName(p, locale)}
                </Link>
                {p.redListStatus && (
                  <span className={`badge badge-${p.redListStatus.toLowerCase()}`} style={{ marginLeft: 8 }}>
                    {p.redListStatus}
                  </span>
                )}
                <div className="tiny muted" style={{ marginTop: 4, letterSpacing: 0, textTransform: 'none' }}>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--forest)' }}>{p.voteCount}</span>{' '}
                  {t('voteCount', { count: p.voteCount }).replace(String(p.voteCount), '').trim()}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
                <VoteButton slug={p.slug} initialCount={p.voteCount} locale={locale} />
                <Link href={`/${locale}/donate?plant=${p.slug}`} className="btn btn-primary">
                  {t('donateCta')}
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
