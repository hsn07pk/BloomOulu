import { getTranslations } from 'next-intl/server';
import { adoptAction } from './actions';

export const dynamic = 'force-dynamic';

interface Tier {
  id: 'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate';
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
  monthlyPriceCents?: number | null;
  blurbEn: string;
  blurbFi: string;
  blurbSv: string;
  perks: Array<{ labelKey?: string; label?: string } | string> | null;
  color: string;
  bg: string;
  sortOrder?: number;
}

interface Plant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  taxon?: { latinName: string } | null;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
}

async function fetchTiers(): Promise<Tier[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/v1/tiers`, { next: { revalidate: 300 } });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

async function fetchPlant(slug: string | undefined): Promise<Plant | null> {
  if (!slug) return null;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/v1/plants/${slug}`, { next: { revalidate: 60 } });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

function localisedTierName(t: Tier, locale: string) {
  if (locale === 'fi') return t.nameFi || t.name;
  if (locale === 'sv') return t.nameSv || t.name;
  return t.name;
}
function localisedTierBlurb(t: Tier, locale: string) {
  if (locale === 'fi') return t.blurbFi || t.blurbEn;
  if (locale === 'sv') return t.blurbSv || t.blurbEn;
  return t.blurbEn;
}
function localisedPlantName(p: Plant, locale: string) {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

const TIER_ORDER: Tier['id'][] = ['seedling', 'rooted', 'vulnerable', 'endangered', 'corporate'];

export default async function AdoptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plant?: string; tier?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Adopt' });

  const allTiers = await fetchTiers();
  const tiers = allTiers
    .filter((tt) => tt.id !== 'corporate')
    .sort((a, b) => TIER_ORDER.indexOf(a.id) - TIER_ORDER.indexOf(b.id));
  const corporate = allTiers.find((tt) => tt.id === 'corporate');
  const plant = await fetchPlant(sp.plant);
  const presetTier = (sp.tier as Tier['id']) ?? 'vulnerable';

  return (
    <article className="fade-in">
      <div className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <header style={{ marginBottom: 32 }}>
          <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
            {locale === 'fi' ? 'Adoptio' : 'Adoption'}
          </div>
          <h1 style={{ fontSize: 'clamp(40px, 6vw, 64px)', marginTop: 12 }}>{t('title')}</h1>
          {plant && (
            <p className="muted" style={{ marginTop: 12, fontSize: 16 }}>
              {locale === 'fi' ? 'Adoptoit kasvin' : 'You are adopting'}:{' '}
              <em style={{ fontFamily: 'var(--f-display)' }}>{plant.taxon?.latinName ?? plant.nameEn}</em>{' '}
              ({localisedPlantName(plant, locale)})
            </p>
          )}
        </header>

        <form action={adoptAction} aria-labelledby="adopt-title">
          <input type="hidden" name="locale" value={locale} />
          {plant && <input type="hidden" name="plantSlug" value={plant.slug} />}

          {/* Tier ladder */}
          <fieldset
            style={{
              border: 0,
              padding: 0,
              margin: 0,
              marginBottom: 40,
            }}
          >
            <legend className="tiny" style={{ color: 'var(--rust-on-light)', marginBottom: 16 }}>
              {locale === 'fi' ? 'Vaihe 1 / 3 · Tukitaso' : 'Step 1 of 3 · Tier'}
            </legend>
            <div
              data-grid-mobile="2"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 16,
              }}
            >
              {tiers.map((tier) => {
                const cents = tier.annualPriceCents;
                const isPreset = tier.id === presetTier;
                return (
                  <label
                    key={tier.id}
                    className="card"
                    style={{
                      padding: 0,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      display: 'block',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <input
                      type="radio"
                      name="tierId"
                      value={tier.id}
                      defaultChecked={isPreset}
                      required
                      className="sr-only"
                    />
                    <div
                      style={{
                        padding: '20px 24px 24px',
                        background: tier.bg ?? 'var(--sage-pale)',
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background: tier.color ?? 'var(--forest)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          marginBottom: 16,
                          fontSize: 18,
                        }}
                        aria-hidden="true"
                      >
                        🌱
                      </div>
                      <div className="serif" style={{ fontSize: 26 }}>
                        {localisedTierName(tier, locale)}
                      </div>
                      <div
                        style={{
                          marginTop: 12,
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 6,
                        }}
                      >
                        <span className="serif" style={{ fontSize: 36 }}>
                          €{(cents / 100).toFixed(0)}
                        </span>
                        <span className="muted small">
                          {locale === 'fi' ? '/ vuosi' : '/ year'}
                        </span>
                      </div>
                    </div>
                    <div style={{ padding: 18 }}>
                      <p
                        className="small muted"
                        style={{ marginBottom: 12, lineHeight: 1.5 }}
                      >
                        {localisedTierBlurb(tier, locale)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Corporate strip */}
            {corporate && (
              <div
                className="card"
                style={{
                  marginTop: 24,
                  padding: 0,
                  overflow: 'hidden',
                  background: 'var(--forest-deep)',
                  color: 'var(--cream)',
                }}
              >
                <label
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.4fr 1fr',
                    gap: 0,
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="tierId"
                    value="corporate"
                    defaultChecked={presetTier === 'corporate'}
                    className="sr-only"
                  />
                  <div style={{ padding: 32 }}>
                    <div className="tiny" style={{ color: 'var(--sage-bright)' }}>
                      {locale === 'fi' ? 'Yritystaso' : 'Corporate'}
                    </div>
                    <h3
                      className="serif"
                      style={{ fontSize: 28, marginTop: 8, color: 'var(--cream)' }}
                    >
                      {localisedTierName(corporate, locale)}
                    </h3>
                    <p
                      className="small"
                      style={{
                        marginTop: 12,
                        color: 'rgba(248,244,230,0.7)',
                        lineHeight: 1.5,
                      }}
                    >
                      {localisedTierBlurb(corporate, locale)}
                    </p>
                  </div>
                  <div style={{ padding: 32, borderLeft: '1px solid rgba(248,244,230,0.15)' }}>
                    <div className="serif" style={{ fontSize: 38, color: 'var(--cream)' }}>
                      €{(corporate.annualPriceCents / 100).toLocaleString(locale)}
                      <span
                        style={{ fontSize: 13, color: 'rgba(248,244,230,0.6)', marginLeft: 4 }}
                      >
                        /{locale === 'fi' ? 'vuosi' : 'year'}
                      </span>
                    </div>
                    <p
                      className="small"
                      style={{ marginTop: 8, color: 'rgba(248,244,230,0.7)' }}
                    >
                      {locale === 'fi'
                        ? 'TVL §57 vähennyskelpoinen suomalaisille yrityksille'
                        : 'TVL §57 deductible for Finnish corporates'}
                    </p>
                  </div>
                </label>
              </div>
            )}
          </fieldset>

          {/* Step 2 — billing + payment */}
          <fieldset
            style={{
              border: 0,
              padding: 0,
              margin: 0,
              marginBottom: 40,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 24,
            }}
          >
            <legend
              className="tiny"
              style={{ color: 'var(--rust-on-light)', marginBottom: 16, gridColumn: '1 / -1' }}
            >
              {locale === 'fi' ? 'Vaihe 2 / 3 · Maksu' : 'Step 2 of 3 · Payment'}
            </legend>

            <div className="card card-pad">
              <div className="label">{t('billing')}</div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label className="pill" style={{ padding: '8px 16px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="billingInterval"
                    value="annual"
                    defaultChecked
                    className="sr-only"
                  />
                  {t('annual')}
                </label>
                <label className="pill" style={{ padding: '8px 16px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="billingInterval"
                    value="monthly"
                    className="sr-only"
                  />
                  {t('monthly')}
                </label>
                <label className="pill" style={{ padding: '8px 16px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="billingInterval"
                    value="one_time"
                    className="sr-only"
                  />
                  {t('oneTime')}
                </label>
              </div>
            </div>

            <div className="card card-pad">
              <div className="label">{t('paymentMethod')}</div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="preferredProvider"
                    value="bank_transfer"
                    defaultChecked
                  />
                  <span>
                    {t('bankTransfer')}
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      {locale === 'fi' ? '0 € maksukuluja' : 'zero fees'}
                    </span>
                  </span>
                </label>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="radio" name="preferredProvider" value="paytrail" />
                  <span>{t('card')}</span>
                </label>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="radio" name="preferredProvider" value="mobilepay" />
                  <span>{t('mobilepay')}</span>
                </label>
              </div>
            </div>
          </fieldset>

          {/* Step 3 — donor + dedication */}
          <fieldset
            style={{
              border: 0,
              padding: 0,
              margin: 0,
              marginBottom: 32,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
            }}
          >
            <legend
              className="tiny"
              style={{ color: 'var(--rust-on-light)', marginBottom: 16, gridColumn: '1 / -1' }}
            >
              {locale === 'fi' ? 'Vaihe 3 / 3 · Tiedot' : 'Step 3 of 3 · Your details'}
            </legend>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="label">{t('email')}</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  background: 'var(--paper)',
                  fontSize: 15,
                  minHeight: 44,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="label">{t('name')}</span>
              <input
                type="text"
                name="name"
                autoComplete="name"
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  background: 'var(--paper)',
                  fontSize: 15,
                  minHeight: 44,
                }}
              />
            </label>
          </fieldset>

          <button type="submit" className="btn btn-lg btn-rust" style={{ minWidth: 280 }}>
            {t('submit')} →
          </button>
        </form>
      </div>
    </article>
  );
}
