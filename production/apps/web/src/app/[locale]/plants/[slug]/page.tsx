import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export const dynamicParams = true;
export const revalidate = 3600;

interface Plant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  bloomSeason: string;
  bloomWindow?: string | null;
  origin: string;
  habitat: string;
  biome: string;
  story: Record<string, string>;
  quickFacts?: unknown;
  adopterCount?: number;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string; attribution?: string } | null;
  images?: Array<{ id: string; url: string; altEn: string; altFi: string; altSv: string; attribution?: string }>;
  taxon?: { latinName: string; family: string } | null;
  narrations?: Array<{ locale: string; audioUrl: string; durationMs: number; transcript: string }>;
  citations?: Array<{ citation: { displayTitle: string; authors?: string | null; year?: number | null; url?: string | null } }>;
}

type Mode = 'adult' | 'kid' | 'school';

export async function generateStaticParams() {
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${api}/v1/plants?limit=200`);
    if (!res.ok) return [];
    const plants = (await res.json()) as Array<{ slug: string }>;
    return plants.flatMap((p) => [
      { locale: 'fi', slug: p.slug },
      { locale: 'en', slug: p.slug },
      { locale: 'sv', slug: p.slug },
    ]);
  } catch {
    return [];
  }
}

function localisedName(p: Plant, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

function localisedAlt(img: { altEn: string; altFi: string; altSv: string } | null | undefined, locale: string): string {
  if (!img) return '';
  if (locale === 'fi') return img.altFi || img.altEn;
  if (locale === 'sv') return img.altSv || img.altEn;
  return img.altEn;
}

export default async function PlantPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ mode?: Mode }>;
}) {
  const { locale, slug } = await params;
  const sp = await searchParams;
  const mode: Mode = sp.mode === 'kid' || sp.mode === 'school' ? sp.mode : 'adult';

  const t = await getTranslations({ locale, namespace: 'Plant' });
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${api}/v1/plants/${slug}`, { next: { revalidate: 3600 } });
  if (!res.ok) notFound();
  const plant = (await res.json()) as Plant;

  const story = (plant.story && (plant.story[locale] || plant.story.en)) ?? '';
  const name = localisedName(plant, locale);
  const altText = localisedAlt(plant.primaryImage, locale);
  const narration = plant.narrations?.find((n) => n.locale === locale) ?? plant.narrations?.[0];

  return (
    <article className="fade-in">
      {/* Hero image + plant identity */}
      <header
        style={{
          background: 'var(--forest-deep)',
          color: 'var(--cream)',
          position: 'relative',
        }}
      >
        <div
          className="container"
          style={{
            paddingTop: 48,
            paddingBottom: 48,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 48,
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <span className={`badge badge-${plant.redListStatus.toLowerCase()}`}>{plant.redListStatus}</span>
              <span className="pill pill-on-dark">{plant.bloomWindow ?? plant.bloomSeason}</span>
              <span className="pill pill-on-dark">{plant.taxon?.family}</span>
            </div>
            <h1
              className="serif"
              style={{
                fontSize: 'clamp(40px, 6vw, 72px)',
                color: 'var(--cream)',
                fontStyle: 'italic',
              }}
            >
              {plant.taxon?.latinName ?? plant.nameEn}
            </h1>
            <p
              style={{
                marginTop: 8,
                fontSize: 22,
                color: 'rgba(248,244,230,0.78)',
                fontFamily: 'var(--f-display)',
              }}
            >
              {name}
            </p>
            <p style={{ marginTop: 20, fontSize: 15, color: 'rgba(248,244,230,0.6)' }}>
              {plant.origin} · {plant.habitat}
            </p>
            <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link
                href={`/${locale}/adopt?plant=${plant.slug}`}
                className="btn btn-lg btn-rust"
              >
                🌱 {t('adoptCta')}
              </Link>
              {/* Mode switcher */}
              <div
                className="lang-pill"
                role="group"
                aria-label={t('modeAdult')}
                style={{ background: 'rgba(248,244,230,0.12)' }}
              >
                {(['adult', 'kid', 'school'] as const).map((m) => (
                  <Link
                    key={m}
                    href={`/${locale}/plants/${plant.slug}${m === 'adult' ? '' : `?mode=${m}`}`}
                    className={mode === m ? 'active' : ''}
                    aria-current={mode === m ? 'page' : undefined}
                    style={mode === m ? { color: 'var(--forest-deep)' } : { color: 'var(--cream)' }}
                  >
                    {t(`mode${m[0]!.toUpperCase()}${m.slice(1)}` as 'modeAdult' | 'modeKid' | 'modeSchool')}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div
            style={{
              aspectRatio: '4/3',
              borderRadius: 24,
              overflow: 'hidden',
              background: 'rgba(248,244,230,0.05)',
            }}
          >
            {plant.primaryImage?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={plant.primaryImage.url}
                alt={altText}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="eager"
              />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 96,
                }}
              >
                🌿
              </div>
            )}
          </div>
        </div>
      </header>

      <section
        className="container"
        style={{
          paddingTop: 48,
          paddingBottom: 64,
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 48,
        }}
      >
        {/* Main story */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            {t('story')}
          </div>
          <p
            style={{
              fontSize: mode === 'kid' ? 19 : 17,
              lineHeight: 1.65,
              color: 'var(--ink-soft)',
              fontFamily: mode === 'kid' ? 'var(--f-display)' : 'var(--f-body)',
            }}
          >
            {story}
          </p>

          {mode === 'school' && (
            <div
              className="card card-pad"
              style={{ marginTop: 32, background: 'var(--sage-pale)' }}
            >
              <div className="tiny" style={{ color: 'var(--forest)' }}>
                {locale === 'fi' ? 'Koulutilan tietoja' : 'School-mode notes'}
              </div>
              <h3 style={{ fontSize: 24, marginTop: 6 }}>
                {locale === 'fi' ? 'Mitä opit?' : 'What will you learn?'}
              </h3>
              <ul style={{ marginTop: 12, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>
                  {locale === 'fi'
                    ? `Lajin uhanalaisuusluokka: ${plant.redListStatus}`
                    : `Red-List status: ${plant.redListStatus}`}
                </li>
                <li>{locale === 'fi' ? `Elinympäristö: ${plant.habitat}` : `Habitat: ${plant.habitat}`}</li>
                <li>{locale === 'fi' ? `Kasvuvyöhyke: ${plant.biome}` : `Biome: ${plant.biome}`}</li>
              </ul>
            </div>
          )}

          {mode === 'kid' && (
            <div
              className="card card-pad"
              style={{ marginTop: 32, background: 'var(--amber-soft)' }}
            >
              <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
                {locale === 'fi' ? 'Tarrakirja' : 'Sticker book'}
              </div>
              <p style={{ marginTop: 8, fontFamily: 'var(--f-display)', fontSize: 18 }}>
                {locale === 'fi'
                  ? `Kerää ${name}-tarra omaan kirjaasi tämän käynnin merkiksi.`
                  : `Collect a ${name} sticker in your book for this visit.`}
              </p>
            </div>
          )}

          {narration && (
            <figure style={{ marginTop: 32 }}>
              <figcaption className="eyebrow" style={{ marginBottom: 8 }}>
                {t('audio')} · {(narration.durationMs / 1000).toFixed(0)}s
              </figcaption>
              <audio controls preload="none" style={{ width: '100%' }}>
                <source src={narration.audioUrl} />
              </audio>
              {narration.transcript && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                    {locale === 'fi' ? 'Näytä litterointi' : 'Show transcript'}
                  </summary>
                  <p
                    style={{
                      marginTop: 8,
                      padding: 16,
                      background: 'var(--cream)',
                      borderRadius: 8,
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    {narration.transcript}
                  </p>
                </details>
              )}
            </figure>
          )}
        </div>

        {/* Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-pad">
            <div className="tiny">{t('habitat')}</div>
            <p style={{ marginTop: 6 }}>{plant.habitat}</p>
            <div className="tiny" style={{ marginTop: 16 }}>
              {t('bloomWindow')}
            </div>
            <p style={{ marginTop: 6 }}>{plant.bloomWindow ?? plant.bloomSeason}</p>
            <div className="tiny" style={{ marginTop: 16 }}>
              {t('redList')}
            </div>
            <p style={{ marginTop: 6 }}>
              <span className={`badge badge-${plant.redListStatus.toLowerCase()}`}>
                {plant.redListStatus}
              </span>
            </p>
          </div>

          {plant.citations && plant.citations.length > 0 && (
            <div className="card card-pad">
              <div className="tiny">{t('citations')}</div>
              <ul style={{ marginTop: 12, listStyle: 'none', padding: 0, fontSize: 13, lineHeight: 1.55 }}>
                {plant.citations.slice(0, 5).map((c, i) => (
                  <li
                    key={i}
                    style={{
                      paddingTop: 8,
                      paddingBottom: 8,
                      borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    {c.citation.url ? (
                      <a href={c.citation.url} target="_blank" rel="noopener noreferrer">
                        {c.citation.displayTitle}
                      </a>
                    ) : (
                      c.citation.displayTitle
                    )}
                    {c.citation.authors && (
                      <span className="muted"> · {c.citation.authors}</span>
                    )}
                    {c.citation.year && <span className="muted"> · {c.citation.year}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plant.primaryImage?.attribution && (
            <p className="muted" style={{ fontSize: 11 }}>
              {plant.primaryImage.attribution}
            </p>
          )}
        </aside>
      </section>
    </article>
  );
}
