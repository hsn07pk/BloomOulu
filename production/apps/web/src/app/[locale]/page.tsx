import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { type PlantIndexItem } from '../../components/PlantIndex.client';
import { PlantCard, plantSubName } from '../../components/PlantCard';
import { internalApiUrl } from '../../lib/api';

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

/**
 * Live count of catalogued (active) plants. Falls back to null on error so
 * the hero tile can degrade to a sensible static placeholder without
 * breaking SSR.
 */
async function fetchPlantCount(): Promise<number | null> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/plants/count`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.total === 'number' ? data.total : null;
  } catch {
    return null;
  }
}

/** Locale-aware number formatting — '1 234' in fi/sv, '1,234' in en. */
function formatCount(n: number, locale: string): string {
  const tag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
  return new Intl.NumberFormat(tag).format(n);
}


export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tn = await getTranslations({ locale, namespace: 'Nav' });
  const tp = await getTranslations({ locale, namespace: 'Plants' });
  const [{ items: plants }, plantCount] = await Promise.all([
    fetchInitialPlants(),
    fetchPlantCount(),
  ]);
  const previewPlants = plants.slice(3, 11);

  // First hero stat is live-from-DB. The other three are LIFE+ ESCAPE
  // conservation context (external project, not platform metrics) so they
  // stay hardcoded — see docs/handover-files/homepage-stats.md for the
  // rationale.
  const heroPlantCountLabel =
    plantCount !== null
      ? formatCount(plantCount, locale)
      : '4 000+';

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
                <Link href={`/${locale}/adopt`} className="btn btn-lg btn-rust">
                  🌱 {t('heroCta')}
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
                  [heroPlantCountLabel, locale === 'fi' ? 'kasvilajia Oulun kokoelmassa' : 'plant species in the Oulu collection'],
                  ['175', 'taxa collected · 148 banked (LIFE+ ESCAPE)'],
                  ['1.7M', 'seeds collected · LIFE+ ESCAPE 2012–2017'],
                  ['56 %', locale === 'fi' ? 'uhanalaisten Suomen kasvien ex-situ-kattavuus' : 'ex-situ coverage of threatened Finnish plants'],
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
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.primaryImage.url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                      />
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

      {/* ── JOURNEY ──────────────────────────────────────────────── */}
      <section className="container" style={{ paddingTop: 64, paddingBottom: 80 }}>
        <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
          {t('howItWorks')}
        </div>
        <h2 style={{ fontSize: 48, marginTop: 12, marginBottom: 40 }}>
          {locale === 'fi' ? 'Skannaa · Kysy · Adoptoi · Palaa' : 'Scan · Ask · Adopt · Return'}
        </h2>
        <div
          data-grid-mobile="2"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}
        >
          {(
            [
              ['01', '📱', locale === 'fi' ? 'Skannaa kasvi' : 'Scan a plant', locale === 'fi' ? 'Jokaisessa kyltissä on QR-koodi — kuuntele 30 s tarina suomeksi, ruotsiksi tai englanniksi.' : 'Every label has a QR code — 30-second audio in FI / SV / EN.'],
              ['02', '🤖', locale === 'fi' ? 'Kysy puutarhalta' : 'Ask the Garden', locale === 'fi' ? 'Tekoälymme nojaa puutarhan tietokantaan. Jokainen vastaus on lähteistetty.' : "Our AI is grounded in the Garden's accession database. Every answer cites its source."],
              ['03', '🌱', locale === 'fi' ? 'Adoptoi' : 'Adopt', locale === 'fi' ? '25 € siemenestä 1 250 € yritystasoon. Lahja-, muisto- ja luokka-adoptiot mahdollisia.' : '€25 Seedling to €1,250 Corporate. Gift, memorial, and class adoptions supported.'],
              ['04', '🔔', locale === 'fi' ? 'Palaa' : 'Return', locale === 'fi' ? 'Saat sähköpostin, kun kasvisi kukkii. Adoptoijien avoimet ovet kesäkuussa.' : 'When your plant flowers, we email you. Adopters\' Open Day in June.'],
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
    </div>
  );
}
