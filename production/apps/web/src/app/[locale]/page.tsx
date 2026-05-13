import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export const revalidate = 60;

interface Plant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  bloomSeason: string;
  bloomWindow?: string | null;
  targetCents?: number;
  adopterCount?: number;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
  taxon?: { latinName: string } | null;
}

async function fetchFeaturedPlants(): Promise<Plant[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/v1/plants?limit=12`, { next: { revalidate: 60, tags: ['plants'] } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function localisedName(p: Plant, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

function rarityClass(s: string): string {
  return `badge badge-${s.toLowerCase()}`;
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tn = await getTranslations({ locale, namespace: 'Nav' });
  const plants = await fetchFeaturedPlants();

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
                  ['4 000+', locale === 'fi' ? 'kasvilajia Oulun kokoelmassa' : 'plant species in the Oulu collection'],
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
                  <div className="tiny">{locale === 'fi' ? 'Tällä viikolla puutarhassa' : 'This week in the garden'}</div>
                  <div className="serif" style={{ fontSize: 22, color: 'var(--ink)', marginTop: 2 }}>
                    {t('featured')}
                  </div>
                </div>
              </div>
              {plants.slice(0, 3).map((p, i) => (
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
                    <div className="serif" style={{ fontSize: 18, color: 'var(--ink)' }}>
                      {localisedName(p, locale)}
                    </div>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      {p.taxon?.latinName ?? ''} · {p.bloomWindow ?? p.bloomSeason}
                    </div>
                  </div>
                  <span aria-hidden="true" style={{ color: 'var(--ink-mute)' }}>→</span>
                </Link>
              ))}
              <div style={{ padding: '14px 24px', background: 'rgba(31,58,44,0.04)', textAlign: 'center' }}>
                <Link href={`/${locale}#plants`} className="btn btn-ghost small">
                  🏛 {locale === 'fi' ? 'Selaa kaikki kasvit' : 'Browse all plants'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PLANT INDEX ──────────────────────────────────────────────── */}
      <section className="container" id="plants" style={{ paddingTop: 64, paddingBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 32,
          }}
        >
          <div>
            <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
              {locale === 'fi' ? 'Elävä kokoelma' : 'The living collection'}
            </div>
            <h2 style={{ fontSize: 52, marginTop: 8 }}>
              {locale === 'fi' ? 'Selaa elävää indeksiä' : 'Browse the living index'}
            </h2>
            <p className="muted" style={{ marginTop: 12, maxWidth: 520 }}>
              {locale === 'fi'
                ? 'Jokaisella puutarhan kasvilla on oma sivu, oma äänikerronta — ja monella myös adoptiokutsu.'
                : 'Every plant has its own page, its own audio narration, and — for many — a sponsorship invitation.'}
            </p>
          </div>
        </div>

        <div
          data-grid-mobile="2"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}
        >
          {plants.map((p) => {
            const accent = ['#E8EEDE', '#F1E6CB', '#F0DCD0', '#D6EBE3'][
              Number.parseInt(p.id.replace(/-/g, '').slice(-1), 16) % 4
            ];
            const altText =
              locale === 'fi'
                ? p.primaryImage?.altFi
                : locale === 'sv'
                  ? p.primaryImage?.altSv
                  : p.primaryImage?.altEn;
            return (
              <Link
                key={p.id}
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
                    background: accent,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {p.primaryImage?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.primaryImage.url}
                      alt={altText ?? p.nameEn}
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
                    >
                      🌿
                    </div>
                  )}
                  <div style={{ position: 'absolute', top: 14, left: 14 }}>
                    <span className={rarityClass(p.redListStatus)}>{p.redListStatus}</span>
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
                    {localisedName(p, locale)}
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
                      <div className="tiny">{locale === 'fi' ? 'Adoptoijia' : 'Adopters'}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                        {p.adopterCount ?? 0}
                      </div>
                    </div>
                    <span className="pill" style={{ fontSize: 11 }}>
                      {p.bloomWindow ?? p.bloomSeason}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── CONSERVATION STORY BAND ─────────────────────────────────── */}
      <section
        style={{
          background: 'var(--paper)',
          borderTop: '1px solid var(--line)',
          borderBottom: '1px solid var(--line)',
          marginTop: 64,
        }}
      >
        <div
          className="container"
          style={{
            paddingTop: 64,
            paddingBottom: 64,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 64,
            alignItems: 'center',
          }}
        >
          <div>
            <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
              {locale === 'fi' ? 'Suojelutarina' : 'The conservation story'}
            </div>
            <h2 style={{ fontSize: 48, marginTop: 12 }}>
              {locale === 'fi' ? '11 %:sta 56 %:iin.' : 'From 11 % to 56 %.'}
              <br />
              <span style={{ fontStyle: 'italic' }}>
                {locale === 'fi' ? 'Mitattava kansallinen hanke.' : 'A measurable national project.'}
              </span>
            </h2>
            <p
              className="muted"
              style={{ marginTop: 20, fontSize: 16, lineHeight: 1.6, maxWidth: 480 }}
            >
              {locale === 'fi'
                ? 'Vuosina 2012–2017 LIFE+ ESCAPE -ohjelma nosti uhanalaisten suomalaisten kasvien ex-situ-kattavuuden 11 %:sta 56 %:iin, talletti 1,7 miljoonaa siementä 175 lajista ja täytti Suomen kansallisen geenipankin 148 lajilla. Oulu oli partneripuutarha. Adoptio rahoittaa seuraavan luvun.'
                : "Between 2012 and 2017, the LIFE+ ESCAPE programme lifted ex-situ coverage of Finland's threatened plants from 11 % to 56 %, banked 1.7 million seeds across 175 taxa, and seeded the Finnish national gene bank with 148 species. Oulu was a partner garden then. Adoption funds the next chapter."}
            </p>
          </div>
          <div className="card card-pad" style={{ background: 'var(--bg)', borderRadius: 24 }}>
            <div className="tiny">{locale === 'fi' ? 'Jokaisesta €100:sta' : 'Of every €100 adopted'}</div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(
                [
                  [locale === 'fi' ? 'Ex-situ-suojelutyö' : 'Direct ex-situ work', 62, 'var(--forest)'],
                  [locale === 'fi' ? 'Siemenpankki (Luomus)' : 'Seed bank deposits (Luomus)', 18, 'var(--moss)'],
                  [locale === 'fi' ? 'Puutarhan toiminta + opasteet' : 'Garden operations & signage', 12, 'var(--bloom)'],
                  [locale === 'fi' ? 'Maksu- + alustakulut' : 'Payment & platform costs', 8, 'var(--ink-3)'],
                ] as const
              ).map(([label, pct, color]) => (
                <div key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className="small">{label}</span>
                    <span className="serif" style={{ fontSize: 18 }}>
                      €{pct}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      background: 'rgba(31,58,44,0.08)',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ width: `${pct}%`, height: '100%', background: color }} />
                  </div>
                </div>
              ))}
            </div>
            <p
              style={{
                marginTop: 24,
                padding: 16,
                background: 'var(--paper)',
                borderRadius: 12,
                fontSize: 13,
                color: 'var(--ink-2)',
              }}
            >
              ℹ{' '}
              {locale === 'fi'
                ? 'Tarkastettu vuosittain. Avoin varaintilavirta julkaistaan tammikuussa.'
                : 'Audited annually; transparent funds-flow page published every January.'}
            </p>
          </div>
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
