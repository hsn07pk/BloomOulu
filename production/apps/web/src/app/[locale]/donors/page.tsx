/**
 * /donors — public donor wall.
 *
 * Lists every completed donation flagged `showOnWall=true` (and not
 * anonymous), newest first. Surfaces the donor's display name, the gift
 * amount, the optional directed species (a general gift has no plant), and
 * any public dedication. No email, no PII beyond what the donor consented
 * to display.
 */
import { getInternalApiUrl } from '@bloomoulu/constants';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

interface WallDonation {
  id: string;
  displayName: string;
  dedication: string | null;
  amountCents: number;
  startedAt: string | null;
  plant: { slug: string; nameEn: string; nameFi: string; nameSv: string } | null;
}

async function fetchWall(): Promise<{ donations: WallDonation[]; count: number }> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/stats/donor-wall`, {
      cache: 'no-store',
    });
    if (!res.ok) return { donations: [], count: 0 };
    const data = (await res.json()) as { donations?: WallDonation[]; count?: number };
    const donations = data.donations ?? [];
    return { donations, count: data.count ?? donations.length };
  } catch {
    return { donations: [], count: 0 };
  }
}

export default async function DonorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { donations, count } = await fetchWall();

  const localisedPlantName = (p: NonNullable<WallDonation['plant']>): string => {
    if (locale === 'fi') return p.nameFi || p.nameEn;
    if (locale === 'sv') return p.nameSv || p.nameEn;
    return p.nameEn;
  };

  const numberTag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
  const fmtEur = (cents: number): string => {
    const v = cents / 100;
    return new Intl.NumberFormat(numberTag, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: v % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(v);
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
            ? 'Kiitos jokaiselle lahjoittajalle.'
            : locale === 'sv'
              ? 'Tack till varje donator.'
              : 'Thank you to every donor.'}
        </h1>
        <p className="muted" style={{ maxWidth: 640, margin: '0 auto', fontSize: 17 }}>
          {locale === 'fi'
            ? `${count} lahjoitusta tukee Suomen kasvilajien suojelua. Lahjoittajat näkyvät tällä sivulla suostumuksellaan.`
            : locale === 'sv'
              ? `${count} gåvor stöder bevarandet av Finlands flora. Donatorerna visas på denna sida med deras samtycke.`
              : `${count} gifts support the conservation of Finnish flora. Donors appear here with their consent.`}
        </p>
      </div>

      {donations.length === 0 ? (
        <div
          className="card card-pad"
          style={{ textAlign: 'center', padding: 48, maxWidth: 520, margin: '0 auto' }}
        >
          <p className="muted">
            {locale === 'fi'
              ? 'Ole ensimmäinen joka lahjoittaa.'
              : locale === 'sv'
                ? 'Var den första att ge en gåva.'
                : 'Be the first to give.'}
          </p>
          <p style={{ marginTop: 24 }}>
            <Link href={`/${locale}/donate`} className="btn btn-primary">
              {locale === 'fi' ? 'Lahjoita nyt' : locale === 'sv' ? 'Ge en gåva' : 'Donate now'}
            </Link>
          </p>
        </div>
      ) : (
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
          {donations.map((d) => (
            <li
              key={d.id}
              className="card"
              style={{
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                minHeight: 130,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                }}
              >
                <span style={{ fontFamily: 'var(--f-display)', fontSize: 17, lineHeight: 1.2 }}>
                  {d.displayName}
                </span>
                <span className="pill" style={{ flexShrink: 0 }}>
                  {fmtEur(d.amountCents)}
                </span>
              </div>
              {d.plant && (
                <Link
                  href={`/${locale}/plants/${d.plant.slug}`}
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
                  {localisedPlantName(d.plant)}
                </Link>
              )}
              {d.dedication && (
                <div
                  className="small"
                  style={{
                    fontStyle: 'italic',
                    color: 'var(--ink-soft)',
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}
                >
                  &ldquo;{d.dedication}&rdquo;
                </div>
              )}
              {d.startedAt && (
                <div className="tiny" style={{ color: 'var(--ink-faint)', marginTop: 'auto' }}>
                  {locale === 'fi' ? 'Lahjoitettu' : locale === 'sv' ? 'Donerat' : 'Given'}{' '}
                  {new Date(d.startedAt).toLocaleDateString(
                    locale === 'en' ? 'en-GB' : `${locale}-FI`,
                    { day: 'numeric', month: 'short', year: 'numeric' },
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
