/**
 * /donors — public donor wall.
 *
 * Lists every adoption flagged `showOnDonorWall=true` (and not anonymous)
 * grouped by tier. Surfaces the donor's `publicName` if set, else the
 * `User.name`, else a friendly fallback. Includes the plant the donor
 * adopted, their nickname for it, and any public dedication. No email,
 * no PII beyond what the donor consented to display.
 */
import { getInternalApiUrl } from '@bloomoulu/constants';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

interface WallAdoption {
  id: string;
  displayName: string;
  nickname: string | null;
  dedication: string | null;
  intent: 'for_self' | 'gift' | 'memorial' | 'class' | 'corporate';
  memorialOf: string | null;
  startedAt: string | null;
  plant: { slug: string; nameEn: string; nameFi: string; nameSv: string };
  tier: { id: string; name: string; nameFi: string; nameSv: string; priceCents: number };
}

async function fetchWall(): Promise<WallAdoption[]> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/stats/donor-wall`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { adoptions: WallAdoption[] };
    return data.adoptions ?? [];
  } catch {
    return [];
  }
}

const TIER_ORDER = ['corporate', 'endangered', 'vulnerable', 'rooted', 'seedling'] as const;

export default async function DonorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await getTranslations({ locale, namespace: 'Home' });
  const all = await fetchWall();

  // Group by tier id, preserving the TIER_ORDER (high → low so big
  // donors land at the top of the page).
  const byTier = new Map<string, WallAdoption[]>();
  for (const a of all) {
    const list = byTier.get(a.tier.id) ?? [];
    list.push(a);
    byTier.set(a.tier.id, list);
  }
  const ordered = TIER_ORDER
    .map((id) => ({ id, list: byTier.get(id) ?? [] }))
    .filter((g) => g.list.length > 0);

  const localisedPlantName = (p: WallAdoption['plant']): string => {
    if (locale === 'fi') return p.nameFi || p.nameEn;
    if (locale === 'sv') return p.nameSv || p.nameEn;
    return p.nameEn;
  };
  const localisedTierName = (t: WallAdoption['tier']): string => {
    if (locale === 'fi') return t.nameFi || t.name;
    if (locale === 'sv') return t.nameSv || t.name;
    return t.name;
  };

  return (
    <main
      className="container fade-in"
      style={{ padding: '48px 24px 80px', maxWidth: 1200, margin: '0 auto' }}
    >
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <p className="eyebrow" style={{ color: 'var(--moss)', letterSpacing: 3 }}>
          {locale === 'fi'
            ? 'Lahjoittajaseinä'
            : locale === 'sv'
              ? 'Donatorernas vägg'
              : 'Donor wall'}
        </p>
        <h1
          className="serif"
          style={{
            fontSize: 'clamp(36px, 5vw, 52px)',
            margin: '12px 0 16px',
            lineHeight: 1.05,
          }}
        >
          {locale === 'fi'
            ? 'Kiitos jokaiselle adoptiosta.'
            : locale === 'sv'
              ? 'Tack till varje adoptör.'
              : 'Thank you to every adopter.'}
        </h1>
        <p className="muted" style={{ maxWidth: 640, margin: '0 auto', fontSize: 17 }}>
          {locale === 'fi'
            ? `${all.length} adoptiota tukee Suomen kasvilajien suojelua. Lahjoittajat näkyvät tällä sivulla suostumuksellaan.`
            : locale === 'sv'
              ? `${all.length} adoptioner stöder bevarandet av Finlands flora. Donatorerna visas på denna sida med deras samtycke.`
              : `${all.length} adoptions support the conservation of Finnish flora. Donors appear here with their consent.`}
        </p>
      </div>

      {ordered.length === 0 ? (
        <div
          className="card card-pad"
          style={{ textAlign: 'center', padding: 48, maxWidth: 520, margin: '0 auto' }}
        >
          <p className="muted">
            {locale === 'fi'
              ? 'Ole ensimmäinen joka adoptoi kasvin.'
              : locale === 'sv'
                ? 'Var den första att adoptera en växt.'
                : 'Be the first to adopt a plant.'}
          </p>
          <p style={{ marginTop: 24 }}>
            <Link href={`/${locale}/adopt`} className="btn btn-primary">
              {locale === 'fi' ? 'Adoptoi nyt' : locale === 'sv' ? 'Adoptera nu' : 'Adopt now'}
            </Link>
          </p>
        </div>
      ) : (
        ordered.map((g) => (
          <section key={g.id} style={{ marginBottom: 56 }} aria-labelledby={`tier-${g.id}`}>
            <h2
              id={`tier-${g.id}`}
              className="serif"
              style={{
                fontSize: 28,
                marginBottom: 20,
                paddingBottom: 8,
                borderBottom: '1px solid var(--line-soft)',
                color: 'var(--forest-deep)',
              }}
            >
              {localisedTierName(g.list[0]!.tier)}{' '}
              <span
                className="tiny"
                style={{
                  color: 'var(--ink-mute)',
                  fontWeight: 'normal',
                  marginLeft: 8,
                }}
              >
                · {g.list.length}
              </span>
            </h2>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {g.list.map((a) => (
                <li
                  key={a.id}
                  className="card"
                  style={{
                    padding: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minHeight: 130,
                  }}
                >
                  <div style={{ fontFamily: 'var(--f-display)', fontSize: 17, lineHeight: 1.2 }}>
                    {a.displayName}
                    {a.intent === 'corporate' && (
                      <span
                        className="tiny"
                        style={{
                          marginLeft: 8,
                          color: 'var(--accent)',
                          letterSpacing: 1,
                          textTransform: 'uppercase',
                        }}
                      >
                        · Corporate
                      </span>
                    )}
                  </div>
                  {a.intent === 'memorial' && a.memorialOf && (
                    <div className="tiny" style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}>
                      {locale === 'fi'
                        ? `Muistolahjoitus: ${a.memorialOf}`
                        : locale === 'sv'
                          ? `Till minne av: ${a.memorialOf}`
                          : `In memory of: ${a.memorialOf}`}
                    </div>
                  )}
                  <Link
                    href={`/${locale}/plants/${a.plant.slug}`}
                    style={{
                      fontStyle: 'italic',
                      fontSize: 14,
                      color: 'var(--moss)',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      minHeight: 32,
                      padding: '4px 0',
                    }}
                  >
                    {localisedPlantName(a.plant)}
                    {a.nickname ? ` · "${a.nickname}"` : ''}
                  </Link>
                  {a.dedication && (
                    <div
                      className="small"
                      style={{
                        fontStyle: 'italic',
                        color: 'var(--ink-soft)',
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      &ldquo;{a.dedication}&rdquo;
                    </div>
                  )}
                  {a.startedAt && (
                    <div className="tiny" style={{ color: 'var(--ink-faint)', marginTop: 'auto' }}>
                      {locale === 'fi' ? 'Aloitettu' : locale === 'sv' ? 'Startade' : 'Started'}{' '}
                      {new Date(a.startedAt).toLocaleDateString(
                        locale === 'en' ? 'en-GB' : `${locale}-FI`,
                        { day: 'numeric', month: 'short', year: 'numeric' },
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
