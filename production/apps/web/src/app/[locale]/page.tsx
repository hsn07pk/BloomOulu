import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { type PlantIndexItem } from '../../components/PlantIndex.client';
import { PlantCard, plantSubName } from '../../components/PlantCard';
import { InstagramSection } from '../../components/InstagramSection';
import { PlantImage } from '../../components/PlantImage.client';
import { internalApiUrl } from '../../lib/api';
import { redListBadgeClass, redListBucketLabel } from '../../lib/redlist';

export const revalidate = 60;

type Plant = PlantIndexItem;

// 3 for the hero "Featured plants" card + 8 for the preview grid below.
const HOME_PLANT_LIMIT = 11;

async function fetchInitialPlants(): Promise<{ items: Plant[] }> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/plants?limit=${HOME_PLANT_LIMIT}`, {
      cache: 'no-store',
    });
    if (!res.ok) return { items: [] };
    const data = await res.json();
    if (Array.isArray(data)) return { items: data };
    return { items: data.items ?? [] };
  } catch {
    return { items: [] };
  }
}

interface HomepageStats {
  plantCount: number;
  donationCount: number;
  raisedCents: number;
}

/**
 * Live homepage hero stats — single round-trip pulling plant count,
 * donation count, and total raised in one shot. Falls back to null on
 * error so the hero tile can degrade to sensible static placeholders
 * without breaking SSR.
 *
 * The fourth hero tile (56 % ex-situ coverage) is kept hardcoded — it's
 * LIFE+ESCAPE conservation context, not a platform metric. Rationale +
 * the whole audience-by-audience stats plan: docs/handover-files/
 * stats-roadmap.md.
 */
async function fetchHomepageStats(): Promise<HomepageStats | null> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/stats/homepage`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (
      typeof data.plantCount !== 'number' ||
      typeof data.donationCount !== 'number' ||
      typeof data.raisedCents !== 'number'
    ) {
      return null;
    }
    return {
      plantCount: data.plantCount,
      donationCount: data.donationCount,
      raisedCents: data.raisedCents,
    };
  } catch {
    return null;
  }
}

/** Locale-aware number formatting — '1 234' in fi/sv, '1,234' in en. */
function formatCount(n: number, locale: string): string {
  const tag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
  return new Intl.NumberFormat(tag).format(n);
}

/**
 * Locale-aware EUR formatting with no fractional cents shown — the hero
 * tile reads better as '€1,266' / '1 266 €' than '€1,266.00'. Currency
 * symbol position differs by locale (Intl handles it).
 */
function formatEur(cents: number, locale: string): string {
  const tag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}


interface TopFav {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus?: string | null;
  voteCount: number;
  primaryImage?: { url: string; altEn: string } | null;
}
async function fetchTopFavourites(): Promise<TopFav[]> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/votes/leaderboard?limit=4`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.plants ?? []) as TopFav[];
  } catch {
    return [];
  }
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tn = await getTranslations({ locale, namespace: 'Nav' });
  const tp = await getTranslations({ locale, namespace: 'Plants' });
  const [{ items: plants }, stats, topFavourites] = await Promise.all([
    fetchInitialPlants(),
    fetchHomepageStats(),
    fetchTopFavourites(),
  ]);
  const previewPlants = plants.slice(3, 11);

  // Hero strip: three live engagement stats + one LIFE+ESCAPE mission
  // anchor (the 56 % ex-situ tile). If the stats endpoint is unreachable
  // the live tiles degrade to '—' placeholders rather than misleading
  // static numbers. See docs/handover-files/stats-roadmap.md.
  const heroPlantCount =
    stats !== null ? formatCount(stats.plantCount, locale) : '—';
  const heroDonationCount =
    stats !== null ? formatCount(stats.donationCount, locale) : '—';
  const heroRaised =
    stats !== null ? formatEur(stats.raisedCents, locale) : '—';

  return (
    <div className="fade-in">
      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section
        className="veining"
        style={{
          background: 'var(--forest-deep)',
          color: 'var(--cream)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          className="container"
          style={{ paddingTop: 56, paddingBottom: 72, position: 'relative', zIndex: 2 }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr',
              gap: 56,
              alignItems: 'end',
            }}
          >
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
                <span className="pill pill-on-dark">🌿 Oulun yliopiston kasvitieteellinen puutarha</span>
                <span className="pill pill-on-dark">📍 65°N · {locale === 'fi' ? 'Pohjoisin tieteellinen puutarha' : 'Northernmost scientific garden'}</span>
              </div>
              <h1
                style={{
                  fontSize: 'clamp(48px, 7vw, 92px)',
                  color: 'var(--cream)',
                  lineHeight: 0.95,
                }}
              >
                {t('heroTitle')}
              </h1>
              <p
                style={{
                  marginTop: 28,
                  fontSize: 18,
                  color: 'rgba(248,244,230,0.78)',
                  maxWidth: 540,
                  lineHeight: 1.5,
                }}
              >
                {t('heroLead')}
              </p>
              <div
                style={{
                  marginTop: 36,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <Link href={`/${locale}/donate`} className="btn btn-lg btn-rust">
                  🌿 {t('heroCta')}
                </Link>
                <Link
                  href={`/${locale}/ask`}
                  className="btn btn-lg btn-ghost"
                  style={{
                    color: 'var(--cream)',
                    border: '1px solid rgba(248,244,230,0.3)',
                  }}
                >
                  🤖 {tn('ask')}
                </Link>
              </div>
              {/* Conservation stat strip */}
              <div
                data-grid-mobile="2"
                style={{
                  marginTop: 64,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 0,
                  borderTop: '1px solid rgba(248,244,230,0.18)',
                  paddingTop: 28,
                }}
              >
                {[
                  [
                    heroPlantCount,
                    locale === 'fi'
                      ? 'kasvilajia Oulun kokoelmassa'
                      : locale === 'sv'
                        ? 'växtarter i Uleåborgs samling'
                        : 'plant species in the Oulu collection',
                  ],
                  [
                    heroDonationCount,
                    locale === 'fi'
                      ? 'lahjoitusta puutarhalle'
                      : locale === 'sv'
                        ? 'donationer till trädgården'
                        : 'gifts to the Garden',
                  ],
                  [
                    heroRaised,
                    locale === 'fi'
                      ? 'kerätty puutarhan suojeluun'
                      : locale === 'sv'
                        ? 'insamlat för trädgårdens bevarande'
                        : 'raised for garden conservation',
                  ],
                  [
                    '56 %',
                    locale === 'fi'
                      ? 'uhanalaisten Suomen kasvien ex-situ-kattavuus'
                      : locale === 'sv'
                        ? 'ex-situ-täckning av hotade finska växter'
                        : 'ex-situ coverage of threatened Finnish plants',
                  ],
                ].map(([n, l]) => (
                  <div key={l} style={{ paddingRight: 16 }}>
                    <div
                      className="serif"
                      style={{ fontSize: 36, color: 'var(--sage-bright)', letterSpacing: '-0.02em' }}
                    >
                      {n}
                    </div>
                    <div className="small" style={{ color: 'rgba(248,244,230,0.6)', marginTop: 4 }}>
                      {l}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Featured plants card */}
            <div
              className="card"
              style={{
                background: 'var(--paper)',
                padding: 0,
                overflow: 'hidden',
                borderRadius: 24,
              }}
            >
              <div
                style={{
                  padding: '20px 24px',
                  borderBottom: '1px solid var(--line-soft)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div className="tiny">{t('thisWeek')}</div>
                  <div className="serif" style={{ fontSize: 22, color: 'var(--ink)', marginTop: 2 }}>
                    {t('featured')}
                  </div>
                </div>
              </div>
              {plants.slice(0, 3).map((p, i) => {
                const latin = p.taxon?.latinName ?? null;
                const sub = plantSubName(p, locale, latin);
                return (
                <Link
                  key={p.id}
                  href={`/${locale}/plants/${p.slug}`}
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '16px 24px',
                    width: '100%',
                    textAlign: 'left',
                    borderBottom: i < 2 ? '1px solid var(--line-soft)' : 'none',
                    alignItems: 'center',
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      background: 'var(--sage-pale)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {p.primaryImage?.url ? (
                      <PlantImage src={p.primaryImage.url} alt="" variant="thumb" />
                    ) : (
                      <span style={{ fontSize: 28 }}>🌿</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="serif"
                      style={{
                        fontSize: 18,
                        color: 'var(--ink)',
                        fontStyle: 'italic',
                        lineHeight: 1.15,
                      }}
                    >
                      {latin ?? p.nameEn}
                    </div>
                    {sub && (
                      <div className="small muted" style={{ marginTop: 2 }}>
                        {sub}
                      </div>
                    )}
                  </div>
                  <span aria-hidden="true" style={{ color: 'var(--ink-mute)' }}>→</span>
                </Link>
                );
              })}
              <div style={{ padding: '14px 24px', background: 'rgba(31,58,44,0.04)', textAlign: 'center' }}>
                <Link href={`/${locale}/plants`} className="btn btn-ghost small">
                  🏛 {t('browseAll')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PLANT PREVIEW (8 cards · full browse lives on /plants) ── */}
      <section className="container" id="plants" style={{ paddingTop: 64, paddingBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
              {tp('collection')}
            </div>
            <h2 style={{ fontSize: 52, marginTop: 8 }}>{tp('indexTitle')}</h2>
            <p className="muted" style={{ marginTop: 12, maxWidth: 520 }}>
              {tp('indexDesc')}
            </p>
          </div>
          <Link href={`/${locale}/plants`} className="btn btn-secondary">
            🏛 {t('browseAll')}
          </Link>
        </div>

        {previewPlants.length > 0 && (
          <div
            data-grid-mobile="2"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 20,
            }}
          >
            {previewPlants.map((p) => (
              <PlantCard
                key={p.id}
                plant={p}
                locale={locale}
                adoptersLabel={tp('adopters')}
              />
            ))}
          </div>
        )}

        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <Link
            href={`/${locale}/plants`}
            className="btn btn-primary"
            style={{ minWidth: 220 }}
          >
            {t('browseAll')} →
          </Link>
        </div>
      </section>

      {/* ── MOST-LOVED ───────────────────────────────────────────── */}
      {topFavourites.length > 0 && (
        <section className="container" style={{ paddingTop: 8, paddingBottom: 56 }}>
          <div className="row between" style={{ alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p className="eyebrow eyebrow--rust">
                {locale === 'fi' ? 'Suosikit' : locale === 'sv' ? 'Favoriter' : 'Most loved'}
              </p>
              <h2 className="serif" style={{ fontSize: 'clamp(26px, 4vw, 38px)', marginTop: 8 }}>
                {locale === 'fi'
                  ? 'Yleisön suosikkikasvit'
                  : locale === 'sv'
                    ? 'Besökarnas favoriter'
                    : 'The plants people love most'}
              </h2>
            </div>
            <Link href={`/${locale}/favourites`} className="small" style={{ color: 'var(--forest)' }}>
              {locale === 'fi'
                ? 'Katso koko lista →'
                : locale === 'sv'
                  ? 'Se hela listan →'
                  : 'See the leaderboard →'}
            </Link>
          </div>
          <div data-grid-mobile="2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {topFavourites.map((p) => {
              const nm =
                locale === 'fi' ? p.nameFi || p.nameEn : locale === 'sv' ? p.nameSv || p.nameEn : p.nameEn;
              return (
                <Link
                  key={p.slug}
                  href={`/${locale}/donate?plant=${p.slug}`}
                  className="card"
                  style={{ padding: 0, overflow: 'hidden', textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  <div style={{ height: 120, background: 'var(--sage-pale)', position: 'relative', overflow: 'hidden' }}>
                    {p.primaryImage?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.primaryImage.url}
                        alt={p.primaryImage.altEn ?? ''}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 36 }} aria-hidden="true">
                        🌿
                      </div>
                    )}
                    {p.redListStatus && (
                      <span className={redListBadgeClass(p.redListStatus)} style={{ position: 'absolute', top: 10, left: 10 }}>
                        {redListBucketLabel(p.redListStatus, locale)}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: 14 }}>
                    <div className="serif" style={{ fontSize: 15, lineHeight: 1.15 }}>{nm}</div>
                    <div className="tiny muted" style={{ marginTop: 6, letterSpacing: 0, textTransform: 'none' }}>
                      <span style={{ color: 'var(--rust)' }}>♥</span> {p.voteCount} ·{' '}
                      {locale === 'fi' ? 'Lahjoita' : locale === 'sv' ? 'Donera' : 'Donate'}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── JOURNEY ──────────────────────────────────────────────── */}
      <section className="container" style={{ paddingTop: 64, paddingBottom: 80 }}>
        <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
          {t('howItWorks')}
        </div>
        <h2 style={{ fontSize: 48, marginTop: 12, marginBottom: 40 }}>
          {locale === 'fi' ? 'Skannaa · Kysy · Lahjoita · Palaa' : 'Scan · Ask · Donate · Return'}
        </h2>
        <div
          data-grid-mobile="2"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}
        >
          {(
            [
              ['01', '📱', locale === 'fi' ? 'Skannaa kasvi' : 'Scan a plant', locale === 'fi' ? 'Jokaisessa kyltissä on QR-koodi — avaa kasvin sivu suomeksi, ruotsiksi tai englanniksi.' : 'Every label has a QR code — open its page in FI / SV / EN.'],
              ['02', '🤖', locale === 'fi' ? 'Kysy puutarhalta' : 'Ask the Garden', locale === 'fi' ? 'Tekoälymme nojaa puutarhan tietokantaan. Jokainen vastaus on lähteistetty.' : "Our AI is grounded in the Garden's accession database. Every answer cites its source."],
              ['03', '🌿', locale === 'fi' ? 'Lahjoita' : 'Donate', locale === 'fi' ? 'Anna haluamasi summa puutarhan suojelutyölle — yleisesti tai valitsemallesi lajille.' : 'Give any amount to the Garden’s conservation work — generally, or directed to a species you choose.'],
              ['04', '🔔', locale === 'fi' ? 'Palaa' : 'Return', locale === 'fi' ? 'Äänestä suosikkikasvejasi ja seuraa puutarhan kuulumisia. Tukijoiden avoimet ovet kesäkuussa.' : 'Vote for your favourite plants and follow the Garden’s news. Supporters’ Open Day in June.'],
            ] as const
          ).map(([num, icon, title, body]) => (
            <div key={num} className="card card-pad">
              <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>{num}</div>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'rgba(31,58,44,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  marginTop: 16,
                  marginBottom: 16,
                }}
                aria-hidden="true"
              >
                {icon}
              </div>
              <div className="serif" style={{ fontSize: 24 }}>{title}</div>
              <p className="muted small" style={{ marginTop: 10, lineHeight: 1.6 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>
      {/* ── INSTAGRAM ────────────────────────────────────────────── */}
      <InstagramSection locale={locale} />
    </div>
  );
}
