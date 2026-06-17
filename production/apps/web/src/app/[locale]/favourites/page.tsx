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

export default async function FavouritesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Favourites' });
  const plants = await fetchLeaderboard();

  return (
    <article className="fade-in container" style={{ maxWidth: 820, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <p className="eyebrow eyebrow--rust">{t('eyebrow')}</p>
        <h1 className="serif">{t('title')}</h1>
        <p className="muted">{t('lead')}</p>
      </header>

      {plants.length === 0 ? (
        <p className="muted">{t('empty')}</p>
      ) : (
        <ol className="col" style={{ gap: 10, listStyle: 'none', padding: 0 }}>
          {plants.map((p) => (
            <li key={p.slug} className="card card-pad row between" style={{ gap: 12, alignItems: 'center' }}>
              <div className="row" style={{ gap: 12, alignItems: 'center', minWidth: 0 }}>
                <span className="serif" aria-hidden="true" style={{ fontSize: 20, width: 28, textAlign: 'right' }}>
                  {p.rank}
                </span>
                {p.primaryImage?.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.primaryImage.url}
                    alt={p.primaryImage.altEn ?? ''}
                    width={48}
                    height={48}
                    style={{ objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  <Link href={`/${locale}/plants/${p.slug}`} className="serif">
                    {plantName(p, locale)}
                  </Link>
                  {p.redListStatus && (
                    <span className={`badge badge-${p.redListStatus.toLowerCase()}`} style={{ marginLeft: 8 }}>
                      {p.redListStatus}
                    </span>
                  )}
                  <div className="tiny muted">{t('voteCount', { count: p.voteCount })}</div>
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
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
