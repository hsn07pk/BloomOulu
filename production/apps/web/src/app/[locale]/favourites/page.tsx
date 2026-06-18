import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { VoteButton } from './vote-button.client';
import { redListBadgeClass, redListBucketLabel } from '@/lib/redlist';

export const dynamic = 'force-dynamic';

// The leaderboard shows the top 20 plants; everything beyond lives in the full
// plant catalogue (linked via "Browse all plants" at the foot of the page).
const MAX_PLANTS = 20;

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
    const res = await fetch(`${getInternalApiUrl()}/v1/votes/leaderboard?limit=${MAX_PLANTS}`, {
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

// 🥇🥈🥉 for the podium; a plain number for the rest.
const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default async function FavouritesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Favourites' });
  const plants = await fetchLeaderboard();

  // Buzz bars are drawn relative to the leader's vote count.
  const maxVotes = Math.max(1, plants[0]?.voteCount ?? 1);

  // Localised "{count} supporters", stripped to just the word (matches the
  // existing voteCount pattern) so we can keep the number in mono.
  const supportersWord = (n: number) => t('supporterCount', { count: n }).replace(String(n), '').trim();

  return (
    <article className="fade-in container" style={{ maxWidth: 780, margin: '0 auto', paddingTop: 40, paddingBottom: 72 }}>
      <header style={{ marginBottom: 28 }}>
        <p className="eyebrow eyebrow--rust">{t('eyebrow')}</p>
        <h1 className="serif" style={{ fontSize: 'clamp(32px, 6vw, 48px)', lineHeight: 1.05, marginTop: 8 }}>
          {t('title')}
        </h1>
        <p className="muted" style={{ marginTop: 12, maxWidth: 560, lineHeight: 1.55 }}>{t('lead')}</p>
      </header>

      {plants.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div aria-hidden="true" style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
          <p className="muted" style={{ marginBottom: 20 }}>{t('empty')}</p>
          <Link href={`/${locale}/plants`} className="btn btn-primary">
            {t('browseAll')}
          </Link>
        </div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {plants.map((p) => {
            const isPodium = p.rank <= 3;
            const barPct = Math.max(4, Math.round((p.voteCount / maxVotes) * 100));
            return (
              <li
                key={p.slug}
                className="card card-pad"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                  // Subtle highlight for the current leader.
                  ...(p.rank === 1 ? { borderColor: 'var(--forest)', background: 'var(--sage-pale)' } : {}),
                }}
              >
                {/* Rank — medal for the podium, number otherwise */}
                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    width: 40,
                    textAlign: 'center',
                    fontSize: isPodium ? 26 : 16,
                    fontFamily: 'var(--f-display)',
                    fontWeight: 600,
                    color: 'var(--ink-mute)',
                    lineHeight: 1,
                  }}
                >
                  {MEDAL[p.rank] ?? p.rank}
                </span>

                {/* Thumbnail with the Red-List badge tucked into the corner */}
                <div style={{ flexShrink: 0, width: 76, height: 76 }}>
                  {p.primaryImage?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.primaryImage.url}
                      alt={p.primaryImage.altEn ?? ''}
                      width={76}
                      height={76}
                      style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 'var(--radius-lg)' }}
                      loading="lazy"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 76, height: 76, borderRadius: 'var(--radius-lg)',
                        background: 'var(--sage-pale)', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 32,
                      }}
                    >
                      🌿
                    </span>
                  )}
                </div>

                {/* Name + buzz bar + counts */}
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <Link
                    href={`/${locale}/plants/${p.slug}`}
                    className="serif"
                    style={{ fontSize: 19, color: 'var(--ink)', textDecoration: 'none' }}
                  >
                    {plantName(p, locale)}
                  </Link>
                  <div
                    aria-hidden="true"
                    style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'var(--sage-pale)', overflow: 'hidden' }}
                  >
                    <div style={{ width: `${barPct}%`, height: '100%', background: 'var(--forest)' }} />
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Red-List bucket — flows inline here so the long "Non-endangered" / "Endangered" label can't overflow the thumbnail */}
                    {p.redListStatus && (
                      <span className={redListBadgeClass(p.redListStatus)}>
                        {redListBucketLabel(p.redListStatus, locale)}
                      </span>
                    )}
                    {/* Buzz — anonymous favourites */}
                    <span
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13,
                        color: 'var(--rust-on-light)', background: 'var(--rust-soft)',
                        borderRadius: 999, padding: '2px 10px',
                      }}
                    >
                      <span aria-hidden="true" style={{ color: 'var(--rust)' }}>♥</span>
                      <span className="mono">{p.voteCount}</span>
                    </span>
                    {/* Supporters — donors who actually gave */}
                    {p.donorCount > 0 && (
                      <span
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13,
                          color: 'var(--forest-deep)', background: 'var(--paper)',
                          border: '1px solid var(--sage-bright)', borderRadius: 999, padding: '1px 9px',
                        }}
                      >
                        <span aria-hidden="true">🌱</span>
                        <span className="mono">{p.donorCount}</span>
                        {supportersWord(p.donorCount)}
                      </span>
                    )}
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
            );
          })}
        </ol>
      )}

      {/* Browse the full catalogue — beyond the top 20 shown above. */}
      {plants.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 36 }}>
          <Link href={`/${locale}/plants`} className="btn btn-secondary" style={{ background: 'transparent' }}>
            {t('browseAll')} →
          </Link>
        </div>
      )}
    </article>
  );
}
