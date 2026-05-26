/**
 * My Garden — the donor dashboard.
 *
 *   - Confetti banner ("Welcome to your garden") shown when ?just=adopted
 *   - Adopter loyalty card (Silver / Gold / Platinum, progress to next)
 *   - Conservation impact breakdown (% of donation by line)
 *   - Adoptions grid with the latest curator note + plaque state
 *   - Receipts list (PDF download via presigned URL)
 *   - Annual tax certificates
 *   - GDPR self-service (export / erase)
 */
import { redirect } from 'next/navigation';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { getSession } from '../../../lib/session';
import { curatorEmail } from '../../../lib/contact';

export const dynamic = 'force-dynamic';

interface GardenView {
  id: string;
  email: string;
  name: string | null;
  locale: 'en' | 'fi' | 'sv';
  createdAt: string;
  lifetimeCents: number;
  paymentCount: number;
  loyalty: 'Seedling' | 'Silver' | 'Gold' | 'Platinum';
  nextThresholdCents: number | null;
  impact: {
    directExSitu: number;
    seedBank: number;
    gardenOperations: number;
    platformCosts: number;
  };
  adoptions: Array<{
    id: string;
    status: string;
    tierId: string;
    amountCents: number;
    billingInterval: string;
    nickname: string | null;
    dedication: string | null;
    startedAt: string | null;
    createdAt: string;
    // Gift / memorial fields — sourced from Adoption.intent + the
    // Adoption gift / memorial columns. Drive the Gifts + In-memoriam
    // cards below the adoptions grid.
    intent: 'for_self' | 'gift' | 'memorial' | 'class' | 'corporate';
    memorialOf: string | null;
    giftDeliverOn: string | null;
    giftAnonymous: boolean;
    giftRecipient: { id: string; name: string | null; email: string } | null;
    plant: {
      id: string;
      slug: string;
      nameEn: string;
      nameFi: string;
      nameSv: string;
      redListStatus: string;
      primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
      taxon?: { latinName: string } | null;
    };
    tier: { id: string; name: string; nameFi: string; nameSv: string; color: string };
    plaque: { status: string; engravedText: string; photoUrl: string | null } | null;
  }>;
  receipts: Array<{
    id: string;
    number: string;
    amountCents: number;
    currency: string;
    issuedAt: string;
    pdfUrl: string | null;
  }>;
  taxCertificates: Array<{
    id: string;
    taxYear: number;
    totalCents: number;
    scheme: string;
    pdfUrl: string | null;
  }>;
}

async function fetchGarden(userId: string, jwt: string): Promise<GardenView | null> {
  // SSR runs inside the container; prefer INTERNAL_API_URL when running
  // under Docker (the public NEXT_PUBLIC_API_URL is host-relative and
  // doesn't resolve from inside the bridge network).
  const apiUrl =
    getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/users/${userId}/garden`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: 'no-store',
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

interface SavedRow {
  id: string;
  savedAt: string;
  plant: {
    id: string;
    slug: string;
    nameEn: string;
    nameFi: string;
    nameSv: string;
    redListStatus: string;
    primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
    taxon?: { latinName: string } | null;
  };
}

async function fetchSaved(jwt: string): Promise<SavedRow[]> {
  const apiUrl =
    getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/me/saved`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: SavedRow[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

interface AskHistoryRow {
  id: string;
  // The API field is `text` (matches AskMessage.text in Prisma). The
  // page used to call this `prompt`, which crashed at runtime because
  // q.prompt was undefined. Both this type and the JSX below now match
  // the real /v1/ask/history shape.
  text: string;
  createdAt: string;
  sessionId?: string | null;
  answer?: { text: string | null } | null;
}
async function fetchAskHistory(userId: string): Promise<AskHistoryRow[]> {
  const apiUrl =
    getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/ask/history?userId=${encodeURIComponent(userId)}&limit=5`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: AskHistoryRow[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

function localisedPlantName(p: GardenView['adoptions'][number]['plant'], locale: string) {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

// ── Activity feed (Phase B) ──────────────────────────────────────────
//
// Pulls a unified donor timeline from /v1/me/activity (four event
// sources joined on the API side: adoptions, payments, asks, saves).
// The page renders a small vertical timeline card after Gifts/Memorials.
// See docs/handover-files/stats-roadmap.md (My Garden, Phase B).
type ActivityItem =
  | {
      kind: 'adoption_created';
      ts: string;
      adoption: {
        id: string;
        plantSlug: string;
        plantNameEn: string;
        plantNameFi: string;
        plantNameSv: string;
        plantLatin: string | null;
        intent: 'for_self' | 'gift' | 'memorial' | 'class' | 'corporate';
      };
    }
  | {
      kind: 'payment_succeeded';
      ts: string;
      payment: { id: string; amountCents: number; currency: string };
    }
  | {
      kind: 'ask_asked';
      ts: string;
      ask: { messageId: string; prompt: string };
    }
  | {
      kind: 'plant_saved';
      ts: string;
      plantSaved: {
        plantSlug: string;
        plantNameEn: string;
        plantNameFi: string;
        plantNameSv: string;
        plantLatin: string | null;
      };
    };

async function fetchActivity(jwt: string): Promise<ActivityItem[]> {
  if (!jwt) return [];
  const apiUrl = getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/me/activity`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: ActivityItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

/**
 * Server-side relative-time formatter. Buckets a past ISO timestamp
 * into "just now / N min / N h / yesterday / N days / N weeks /
 * N months / N years" in the right locale. No client component needed.
 */
function relativeTime(iso: string, locale: string): string {
  const tag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
  const fmt = new Intl.NumberFormat(tag);
  const fmtN = (n: number) => fmt.format(Math.max(1, Math.round(n)));
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return '';
  const sec = diffMs / 1000;
  const min = sec / 60;
  const hr = min / 60;
  const day = hr / 24;
  const week = day / 7;
  const month = day / 30.44;
  const year = day / 365.25;
  const t = (en: string, fi: string, sv: string) =>
    locale === 'fi' ? fi : locale === 'sv' ? sv : en;
  if (sec < 60) return t('just now', 'juuri nyt', 'just nu');
  if (min < 60) return t(`${fmtN(min)} min ago`, `${fmtN(min)} min sitten`, `${fmtN(min)} min sedan`);
  if (hr < 24) return t(`${fmtN(hr)} h ago`, `${fmtN(hr)} t sitten`, `${fmtN(hr)} h sedan`);
  if (day < 2) return t('yesterday', 'eilen', 'i går');
  if (day < 7) return t(`${fmtN(day)} days ago`, `${fmtN(day)} päivää sitten`, `${fmtN(day)} dagar sedan`);
  if (week < 5) return t(`${fmtN(week)} weeks ago`, `${fmtN(week)} viikkoa sitten`, `${fmtN(week)} veckor sedan`);
  if (month < 12) return t(`${fmtN(month)} months ago`, `${fmtN(month)} kuukautta sitten`, `${fmtN(month)} månader sedan`);
  return t(`${fmtN(year)} years ago`, `${fmtN(year)} vuotta sitten`, `${fmtN(year)} år sedan`);
}

function localisedTierName(t: GardenView['adoptions'][number]['tier'], locale: string) {
  if (locale === 'fi') return t.nameFi || t.name;
  if (locale === 'sv') return t.nameSv || t.name;
  return t.name;
}

export default async function GardenPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ just?: string; gdpr?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await getSession();
  if (!session.user?.id) redirect(`/${locale}/sign-in`);
  const t = await getTranslations({ locale, namespace: 'Garden' });
  const tr = await getTranslations({ locale, namespace: 'Receipts' });
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  const sessionJwt = jar.get('bloomoulu.session')?.value ?? '';
  const [garden, saved, askHistory, activity] = await Promise.all([
    fetchGarden(session.user.id, sessionJwt),
    sessionJwt ? fetchSaved(sessionJwt) : Promise.resolve([] as SavedRow[]),
    fetchAskHistory(session.user.id),
    fetchActivity(sessionJwt),
  ]);

  if (!garden) {
    return (
      <main className="container">
        <h1>{t('title')}</h1>
        <p className="muted">
          {locale === 'fi' ? 'Tietoja ei vielä ole.' : 'No data yet.'}
        </p>
      </main>
    );
  }

  const justAdopted = sp.just === 'adopted';
  const progressToNext =
    garden.nextThresholdCents && garden.nextThresholdCents > 0
      ? Math.min(garden.lifetimeCents / garden.nextThresholdCents, 1)
      : 1;
  const loyaltyTiers = ['Seedling', 'Silver', 'Gold', 'Platinum'] as const;
  const nextLoyalty =
    garden.loyalty === 'Platinum' ? null : loyaltyTiers[loyaltyTiers.indexOf(garden.loyalty) + 1];

  return (
    <article className="fade-in">
      {justAdopted && (
        <div style={{ background: 'var(--forest-deep)', color: 'var(--cream)' }}>
          <div
            className="container"
            style={{
              padding: '20px 32px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--sage-bright)',
                color: 'var(--forest-deep)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
              aria-hidden="true"
            >
              ✓
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="serif" style={{ fontSize: 22, color: 'var(--cream)' }}>
                {locale === 'fi'
                  ? `Tervetuloa puutarhaasi, ${garden.name ?? garden.email}.`
                  : locale === 'sv'
                    ? `Välkommen till din trädgård, ${garden.name ?? garden.email}.`
                    : `Welcome to your garden, ${garden.name ?? garden.email}.`}
              </div>
              <div className="small" style={{ color: 'rgba(250,247,238,0.7)' }}>
                {locale === 'fi'
                  ? 'Lahjoituksesi on vahvistettu. Kuitti lähetetty sähköpostiisi.'
                  : 'Your adoption is confirmed. Receipt sent to your email.'}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container" style={{ paddingTop: 48, paddingBottom: 64 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: 48,
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div>
            <div className="eyebrow">
              {t('title')} · {garden.name ?? garden.email}
            </div>
            <h1 style={{ fontSize: 'clamp(40px, 6vw, 64px)', marginTop: 12 }}>
              {locale === 'fi' ? (
                <>
                  Tervetuloa takaisin,<br />
                  <span className="italic-serif accent-grad">{garden.name?.split(' ')[0] ?? 'sinä'}</span>.
                </>
              ) : locale === 'sv' ? (
                <>
                  Välkommen tillbaka,<br />
                  <span className="italic-serif accent-grad">{garden.name?.split(' ')[0] ?? 'du'}</span>.
                </>
              ) : (
                <>
                  Welcome back,<br />
                  <span className="italic-serif accent-grad">{garden.name?.split(' ')[0] ?? 'friend'}</span>.
                </>
              )}
            </h1>
            <p className="muted" style={{ marginTop: 16, fontSize: 16, maxWidth: 560 }}>
              {garden.adoptions.length}{' '}
              {locale === 'fi'
                ? `adoptiota · €${(garden.lifetimeCents / 100).toLocaleString('fi-FI')} koko ajalta.`
                : locale === 'sv'
                  ? `adoptioner · €${(garden.lifetimeCents / 100).toLocaleString('sv-FI')} sammanlagt.`
                  : `adoptions · €${(garden.lifetimeCents / 100).toLocaleString('en-FI')} lifetime giving.`}
            </p>
          </div>
          <Link href={`/${locale}/adopt`} className="btn btn-primary">
            + {locale === 'fi' ? 'Adoptoi toinen' : locale === 'sv' ? 'Adoptera till' : 'Adopt another'}
          </Link>
        </div>

        {/* Loyalty + impact + next milestone */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr 1fr',
            gap: 16,
            marginBottom: 48,
          }}
        >
          {/* Loyalty card */}
          <div
            className="card"
            style={{
              padding: 0,
              overflow: 'hidden',
              background: 'var(--forest-deep)',
              color: 'var(--cream)',
              position: 'relative',
            }}
          >
            <div style={{ padding: 28 }}>
              <div className="eyebrow" style={{ color: 'var(--sage-bright)' }}>
                {locale === 'fi' ? 'Adoptoijan taso' : 'Adopter status'}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
                <div className="serif" style={{ fontSize: 56, color: 'var(--cream)', lineHeight: 1 }}>
                  {garden.loyalty}
                </div>
                <span className="pill pill-on-dark">
                  €{(garden.lifetimeCents / 100).toLocaleString('en-FI')}{' '}
                  {locale === 'fi' ? 'koko ajalta' : 'lifetime'}
                </span>
              </div>
              {nextLoyalty && garden.nextThresholdCents && (
                <>
                  <div className="small" style={{ color: 'rgba(250,247,238,0.7)', marginTop: 8 }}>
                    €{((garden.nextThresholdCents - garden.lifetimeCents) / 100).toFixed(0)}{' '}
                    {locale === 'fi' ? 'tasoon' : 'to'}{' '}
                    <b style={{ color: 'var(--sage-bright)' }}>{nextLoyalty}</b>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        height: 6,
                        background: 'rgba(250,247,238,0.14)',
                        borderRadius: 999,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${progressToNext * 100}%`,
                          height: '100%',
                          background:
                            'linear-gradient(90deg, var(--sage) 0%, var(--sage-bright) 100%)',
                        }}
                        role="progressbar"
                        aria-valuenow={Math.round(progressToNext * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Progress to ${nextLoyalty}`}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Impact breakdown */}
          <div className="card card-pad">
            <div className="eyebrow">
              {locale === 'fi' ? 'Suojeluvaikutuksesi' : 'Your conservation impact'}
            </div>
            <div className="serif" style={{ fontSize: 36, marginTop: 12 }}>
              €{(garden.impact.directExSitu / 100).toFixed(0)}
            </div>
            <div className="small muted">
              {locale === 'fi'
                ? 'suoraan ex-situ-työhön · 62%'
                : 'to direct ex-situ work · 62 %'}
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(
                [
                  [
                    locale === 'fi' ? 'Siemenpankki' : 'Seed bank deposits',
                    garden.impact.seedBank,
                    'var(--sage)',
                  ],
                  [
                    locale === 'fi' ? 'Puutarhan toiminta' : 'Garden operations',
                    garden.impact.gardenOperations,
                    'var(--teal)',
                  ],
                  [
                    locale === 'fi' ? 'Alustakulut' : 'Platform costs',
                    garden.impact.platformCosts,
                    'var(--ink-mute)',
                  ],
                ] as const
              ).map(([label, cents, color]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12,
                  }}
                >
                  <span className="muted">{label}</span>
                  <span className="mono" style={{ color, fontWeight: 600 }}>
                    €{(cents / 100).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Next milestone */}
          <div className="card card-pad" style={{ background: 'var(--sage-pale)' }}>
            <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
              {locale === 'fi' ? 'Tulossa' : 'Coming up'}
            </div>
            <div className="serif" style={{ fontSize: 26, marginTop: 12, lineHeight: 1.15 }}>
              {locale === 'fi' ? "Adopters' Open Day" : "Adopters' Open Day"}
            </div>
            <div className="small" style={{ marginTop: 4, color: 'var(--ink-soft)' }}>
              {locale === 'fi'
                ? 'Lauantai 21.6.2026 · 13:00'
                : 'Saturday 21 June 2026 · 13:00'}
            </div>
            <p className="small" style={{ marginTop: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              {locale === 'fi'
                ? 'Opastettu kierros, kukinnan huippu Romeo & Julia -kasvihuoneissa.'
                : 'Guided tour at peak bloom in Romeo & Julia greenhouses.'}
            </p>
          </div>
        </div>

        {/* Adoptions */}
        <section aria-labelledby="adoptions-h" style={{ marginBottom: 56 }}>
          <div className="eyebrow">{t('adoptions')}</div>
          <h2 id="adoptions-h" style={{ fontSize: 36, marginTop: 8, marginBottom: 24 }}>
            {garden.adoptions.length}{' '}
            {garden.adoptions.length === 1
              ? locale === 'fi'
                ? 'elävä omistautuminen'
                : 'living dedication'
              : locale === 'fi'
                ? 'elävää omistautumista'
                : 'living dedications'}
          </h2>
          {garden.adoptions.length === 0 ? (
            <p className="muted">
              {locale === 'fi'
                ? 'Et ole vielä adoptoinut kasvia.'
                : "You haven't adopted a plant yet."}
            </p>
          ) : (
            <div
              data-grid-mobile="2"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}
            >
              {garden.adoptions.map((a) => (
                <article key={a.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: 200,
                      background: 'var(--sage-pale)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {a.plant.primaryImage?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.plant.primaryImage.url}
                        alt={
                          locale === 'fi'
                            ? a.plant.primaryImage.altFi
                            : locale === 'sv'
                              ? a.plant.primaryImage.altSv
                              : a.plant.primaryImage.altEn
                        }
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 56 }}>🌿</div>
                    )}
                    <span
                      className={`badge badge-${a.plant.redListStatus.toLowerCase()}`}
                      style={{ position: 'absolute', top: 14, left: 14 }}
                    >
                      {a.plant.redListStatus}
                    </span>
                  </div>
                  <div style={{ padding: 18 }}>
                    <div className="eyebrow">
                      {localisedTierName(a.tier, locale)} · €
                      {(a.amountCents / 100).toFixed(0)}/
                      {a.billingInterval === 'monthly' ? 'mo' : 'yr'}
                    </div>
                    <h3
                      className="serif"
                      style={{ fontSize: 22, fontStyle: 'italic', marginTop: 8, lineHeight: 1.1 }}
                    >
                      {a.plant.taxon?.latinName ?? a.plant.nameEn}
                    </h3>
                    <p className="small muted" style={{ marginTop: 4 }}>
                      {localisedPlantName(a.plant, locale)}
                      {a.startedAt && (
                        <>
                          {' '}
                          ·{' '}
                          {new Date(a.startedAt).toLocaleDateString(locale, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </>
                      )}
                    </p>
                    {a.nickname && (
                      <p className="small" style={{ marginTop: 10, fontStyle: 'italic' }}>
                        "{a.nickname}"
                      </p>
                    )}
                    {a.plaque && (
                      <p
                        className="pill"
                        style={{
                          marginTop: 12,
                          fontSize: 11,
                          background: a.plaque.status === 'installed'
                            ? 'var(--sage-pale)'
                            : 'var(--amber-soft)',
                          color: 'var(--ink-soft)',
                        }}
                      >
                        🏷{' '}
                        {a.plaque.status === 'installed'
                          ? locale === 'fi'
                            ? 'Laatta asennettu'
                            : 'Plaque installed'
                          : locale === 'fi'
                            ? 'Laatta valmistuksessa'
                            : 'Plaque being engraved'}
                        : "{a.plaque.engravedText}"
                      </p>
                    )}
                    <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                      <Link
                        href={`/${locale}/plants/${a.plant.slug}`}
                        className="btn btn-secondary"
                        style={{ padding: '8px 14px', fontSize: 13 }}
                      >
                        {locale === 'fi' ? 'Avaa sivu' : 'View page'}
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* ── Gifts sent + In memoriam ─────────────────────────────────
            Both sections are derived purely from the adoption rows we
            already fetched (intent='gift' and memorialOf!==null). No
            extra API call, no new schema. The wrapper section only
            renders when at least one card has content — new donors
            with neither don't see an empty placeholder. */}
        {(() => {
          const gifts = garden.adoptions.filter((a) => a.intent === 'gift');
          const memorials = garden.adoptions.filter((a) => a.memorialOf);
          if (gifts.length === 0 && memorials.length === 0) return null;
          const hasBoth = gifts.length > 0 && memorials.length > 0;
          const dateFmt = new Intl.DateTimeFormat(
            locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB',
            { year: 'numeric', month: 'short' },
          );
          const gT = (en: string, fi: string, sv: string) =>
            locale === 'fi' ? fi : locale === 'sv' ? sv : en;
          return (
            <section
              aria-labelledby="gifts-memorials-h"
              style={{
                marginBottom: 56,
                display: 'grid',
                gridTemplateColumns: hasBoth ? '1fr 1fr' : '1fr',
                gap: 24,
              }}
            >
              <h2
                id="gifts-memorials-h"
                className="sr-only"
              >
                {gT('Gifts and memorials', 'Lahjat ja muistot', 'Gåvor och minnen')}
              </h2>

              {gifts.length > 0 && (
                <article
                  className="card card-pad"
                  aria-label={gT(
                    "Gifts you've sent",
                    'Antamasi lahjat',
                    'Gåvor du har skickat',
                  )}
                >
                  <div className="eyebrow">
                    {gT(
                      "Gifts you've sent",
                      'Antamasi lahjat',
                      'Gåvor du har skickat',
                    )}
                  </div>
                  <div
                    className="serif"
                    style={{ fontSize: 26, marginTop: 8, marginBottom: 16 }}
                  >
                    {gifts.length}{' '}
                    {gifts.length === 1
                      ? gT('gift', 'lahja', 'gåva')
                      : gT('gifts', 'lahjaa', 'gåvor')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {gifts.map((g) => {
                      const recipient = g.giftAnonymous
                        ? gT('Sent anonymously', 'Lähetetty nimettömänä', 'Skickat anonymt')
                        : g.giftRecipient?.name?.trim() ||
                          g.giftRecipient?.email ||
                          gT('Recipient pending', 'Vastaanottaja odottaa', 'Mottagare väntar');
                      const future = g.giftDeliverOn
                        ? new Date(g.giftDeliverOn) > new Date()
                        : false;
                      const statusKey = future
                        ? gT('Scheduled', 'Ajastettu', 'Schemalagd')
                        : g.status === 'active'
                          ? gT('Active', 'Aktiivinen', 'Aktiv')
                          : gT('Pending', 'Odottaa', 'Väntande');
                      const latinName = g.plant.taxon?.latinName ?? g.plant.nameEn;
                      return (
                        <div
                          key={g.id}
                          style={{
                            padding: 12,
                            background: 'var(--cream-deep, rgba(31,58,44,0.04))',
                            borderRadius: 10,
                            fontSize: 13,
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
                            <span style={{ fontWeight: 500 }}>{recipient}</span>
                            <span className="badge badge-nt" style={{ flexShrink: 0 }}>
                              {statusKey}
                            </span>
                          </div>
                          <div className="small muted" style={{ marginTop: 4 }}>
                            <Link
                              href={`/${locale}/plants/${g.plant.slug}`}
                              style={{ color: 'inherit', fontStyle: 'italic' }}
                            >
                              {latinName}
                            </Link>{' '}
                            · {dateFmt.format(new Date(g.createdAt))}
                            {g.giftDeliverOn && future && (
                              <>
                                {' '}
                                ·{' '}
                                {gT('delivers', 'toimitetaan', 'levereras')}{' '}
                                {dateFmt.format(new Date(g.giftDeliverOn))}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              )}

              {memorials.length > 0 && (
                <article
                  className="card card-pad"
                  aria-label={gT('In memoriam', 'Muistoksi', 'In memoriam')}
                  style={{ background: 'linear-gradient(180deg, #fbf6e8 0%, var(--cream, #FAF7EE) 100%)' }}
                >
                  <div
                    className="eyebrow eyebrow--rust"
                    style={{ color: 'var(--rust-on-light)' }}
                  >
                    {gT('In memoriam', 'Muistoksi', 'In memoriam')}
                  </div>
                  <div
                    className="serif"
                    style={{ fontSize: 26, marginTop: 8, marginBottom: 16 }}
                  >
                    {memorials.length}{' '}
                    {memorials.length === 1
                      ? gT('dedication', 'omistautuminen', 'tillägnan')
                      : gT('dedications', 'omistautumista', 'tillägnar')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {memorials.map((m) => {
                      const latinName = m.plant.taxon?.latinName ?? m.plant.nameEn;
                      return (
                        <div
                          key={m.id}
                          style={{
                            padding: 14,
                            background: 'var(--paper, #FFFFFF)',
                            borderRadius: 10,
                            fontSize: 13,
                            lineHeight: 1.55,
                          }}
                        >
                          <div
                            className="serif"
                            style={{ fontSize: 16, fontStyle: 'italic' }}
                          >
                            {gT('For', 'Muistolle', 'För')} {m.memorialOf}
                          </div>
                          {m.dedication && (
                            <p
                              className="small"
                              style={{
                                marginTop: 6,
                                color: 'var(--ink-soft, #5A6E63)',
                                fontStyle: 'italic',
                              }}
                            >
                              &ldquo;{m.dedication}&rdquo;
                            </p>
                          )}
                          <div className="small muted" style={{ marginTop: 6 }}>
                            <Link
                              href={`/${locale}/plants/${m.plant.slug}`}
                              style={{ color: 'inherit' }}
                            >
                              {latinName}
                            </Link>{' '}
                            · {dateFmt.format(new Date(m.createdAt))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              )}
            </section>
          );
        })()}

        {/* ── Activity feed (Phase B) ──────────────────────────────────
            Unified donor timeline aggregating adoptions / payments /
            asks / saves from /v1/me/activity. The card hides itself
            for new donors with no events. See stats-roadmap.md. */}
        {activity.length > 0 && (() => {
          const gT = (en: string, fi: string, sv: string) =>
            locale === 'fi' ? fi : locale === 'sv' ? sv : en;
          // Per-event icon + accent colour. Keeping the visual language
          // tight (one emoji + the existing palette tokens) instead of
          // pulling in a dedicated icon set.
          const ICONS: Record<ActivityItem['kind'], { icon: string; bg: string }> = {
            adoption_created:  { icon: '🌱', bg: 'rgba(111,143,120,0.18)' }, // sage
            payment_succeeded: { icon: '✓', bg: 'rgba(31,58,44,0.10)'  }, // forest
            ask_asked:         { icon: '💬', bg: 'rgba(99,143,140,0.18)' }, // teal
            plant_saved:       { icon: '♥', bg: 'rgba(182,90,63,0.16)' }, // rust
          };
          // Render a single line: <Title> · plant-link / amount / prompt.
          const renderItem = (it: ActivityItem) => {
            const meta = ICONS[it.kind];
            let title: React.ReactNode = '';
            let body: React.ReactNode = '';
            const plantLink = (slug: string, latin: string | null, fallback: string) => (
              <Link
                href={`/${locale}/plants/${slug}`}
                style={{ color: 'inherit', fontStyle: 'italic' }}
              >
                {latin ?? fallback}
              </Link>
            );
            if (it.kind === 'adoption_created') {
              const a = it.adoption;
              const verbEn =
                a.intent === 'gift'
                  ? 'gifted'
                  : a.intent === 'memorial'
                    ? 'dedicated'
                    : 'adopted';
              const verbFi =
                a.intent === 'gift' ? 'lahjoitit' : a.intent === 'memorial' ? 'omistit' : 'adoptoit';
              const verbSv =
                a.intent === 'gift' ? 'gav' : a.intent === 'memorial' ? 'tillägnade' : 'adopterade';
              title = `${gT('You', 'Sinä', 'Du')} ${gT(verbEn, verbFi, verbSv)} `;
              body = plantLink(a.plantSlug, a.plantLatin, a.plantNameEn);
            } else if (it.kind === 'payment_succeeded') {
              const p = it.payment;
              const tag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
              const fmtEur = new Intl.NumberFormat(tag, {
                style: 'currency',
                currency: p.currency || 'EUR',
                maximumFractionDigits: 0,
              });
              title = gT('Donation processed', 'Lahjoitus käsitelty', 'Donation behandlad');
              body = fmtEur.format(p.amountCents / 100);
            } else if (it.kind === 'ask_asked') {
              title = gT('You asked the garden', 'Kysyit puutarhalta', 'Du frågade trädgården');
              body = `“${it.ask.prompt}${it.ask.prompt.length >= 120 ? '…' : ''}”`;
            } else {
              const s = it.plantSaved;
              title = gT('You saved ', 'Tallensit ', 'Du sparade ');
              body = plantLink(s.plantSlug, s.plantLatin, s.plantNameEn);
            }
            return (
              <div
                key={`${it.kind}-${it.ts}`}
                style={{
                  display: 'flex',
                  gap: 14,
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--line, rgba(31,58,44,0.08))',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: meta.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 16,
                  }}
                >
                  {meta.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                      fontSize: 14,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>
                      {title}
                      {body}
                    </span>
                    <span
                      className="tiny"
                      style={{
                        flexShrink: 0,
                        color: 'var(--ink-mute, #5A6E63)',
                      }}
                    >
                      {relativeTime(it.ts, locale)}
                    </span>
                  </div>
                </div>
              </div>
            );
          };
          return (
            <section aria-labelledby="activity-h" style={{ marginBottom: 56 }}>
              <div className="eyebrow">
                {gT('Activity', 'Toiminta', 'Aktivitet')}
              </div>
              <h2
                id="activity-h"
                style={{ fontSize: 28, marginTop: 8, marginBottom: 16 }}
              >
                {gT('Recent activity', 'Viimeisin toiminta', 'Senaste aktivitet')}
              </h2>
              <div
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderRadius: 16,
                }}
              >
                {activity.map(renderItem)}
              </div>
              <div
                className="tiny muted"
                style={{ marginTop: 8, textAlign: 'right' }}
              >
                {gT(
                  `${activity.length} most recent`,
                  `${activity.length} viimeisintä`,
                  `${activity.length} senaste`,
                )}
              </div>
            </section>
          );
        })()}

        {/* Recent AskTheGarden conversations */}
        <section aria-labelledby="conversations-h" style={{ marginBottom: 56 }}>
          <div className="eyebrow">
            {locale === 'fi' ? 'Keskustelut' : locale === 'sv' ? 'Konversationer' : 'Conversations'}
          </div>
          <h2 id="conversations-h" style={{ fontSize: 28, marginTop: 8, marginBottom: 16 }}>
            {askHistory.length}{' '}
            {askHistory.length === 1
              ? locale === 'fi'
                ? 'kysymys puutarhasta'
                : locale === 'sv'
                  ? 'fråga till trädgården'
                  : 'recent question'
              : locale === 'fi'
                ? 'kysymystä puutarhasta'
                : locale === 'sv'
                  ? 'frågor till trädgården'
                  : 'recent questions'}
          </h2>
          {askHistory.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center' }}>
              <p className="muted small" style={{ marginBottom: 12 }}>
                {locale === 'fi'
                  ? 'Et ole vielä kysynyt puutarhalta. AskTheGarden tuntee kokoelman ja vastaa lainauksin.'
                  : locale === 'sv'
                    ? 'Du har inte frågat trädgården än. AskTheGarden känner samlingen och svarar med citat.'
                    : "You haven't asked the garden anything yet. AskTheGarden knows the collection and answers with citations."}
              </p>
              <Link href={`/${locale}/ask`} className="btn btn-secondary">
                {locale === 'fi' ? 'Avaa AskTheGarden' : locale === 'sv' ? 'Öppna AskTheGarden' : 'Open AskTheGarden'}
              </Link>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {askHistory.map((q) => (
                <li key={q.id}>
                  <Link
                    href={(`/${locale}/ask${q.sessionId ? `?session=${encodeURIComponent(q.sessionId)}` : ''}`) as Parameters<typeof Link>[0]['href']}
                    className="card card-pad"
                    style={{
                      display: 'block',
                      textDecoration: 'none',
                      color: 'var(--ink)',
                      transition: 'border-color 0.12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18, color: 'var(--forest-deep)', fontFamily: 'var(--f-display)', flex: 1, minWidth: 240 }}>
                        {q.text.slice(0, 140)}{q.text.length > 140 ? '…' : ''}
                      </span>
                      <span className="small muted">
                        {new Date(q.createdAt).toLocaleDateString(locale)}
                      </span>
                    </div>
                    {q.answer?.text && (
                      <p className="small muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                        {q.answer.text.slice(0, 220)}{q.answer.text.length > 220 ? '…' : ''}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {askHistory.length > 0 && (
            <p style={{ marginTop: 14 }}>
              <Link href={`/${locale}/ask`} className="small muted">
                {locale === 'fi' ? 'Näytä kaikki keskustelut →' : locale === 'sv' ? 'Visa alla konversationer →' : 'See all conversations →'}
              </Link>
            </p>
          )}
        </section>

        {/* Saved plants (bookmarks) */}
        <section aria-labelledby="saved-h" style={{ marginBottom: 56 }}>
          <div className="eyebrow">
            {locale === 'fi' ? 'Kirjanmerkit' : locale === 'sv' ? 'Bokmärken' : 'Bookmarks'}
          </div>
          <h2 id="saved-h" style={{ fontSize: 28, marginTop: 8, marginBottom: 16 }}>
            {saved.length}{' '}
            {saved.length === 1
              ? locale === 'fi'
                ? 'tallennettu kasvi'
                : locale === 'sv'
                  ? 'sparad växt'
                  : 'saved plant'
              : locale === 'fi'
                ? 'tallennettua kasvia'
                : locale === 'sv'
                  ? 'sparade växter'
                  : 'saved plants'}
          </h2>
          {saved.length === 0 ? (
            <p className="muted">
              {locale === 'fi'
                ? 'Klikkaa ☆ kasvisivulla tallentaaksesi kasveja tähän.'
                : locale === 'sv'
                  ? 'Klicka på ☆ på en växtsida för att spara hit.'
                  : 'Click the ☆ on any plant page to save it here.'}
            </p>
          ) : (
            <div
              data-grid-mobile="2"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}
            >
              {saved.map((s) => (
                <Link
                  key={s.id}
                  href={`/${locale}/plants/${s.plant.slug}`}
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
                      height: 140,
                      background: 'var(--sage-pale)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {s.plant.primaryImage?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.plant.primaryImage.url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          fontSize: 44,
                        }}
                        aria-hidden="true"
                      >
                        🌿
                      </div>
                    )}
                    <span
                      className={`badge badge-${s.plant.redListStatus.toLowerCase()}`}
                      style={{ position: 'absolute', top: 10, left: 10 }}
                    >
                      {s.plant.redListStatus}
                    </span>
                  </div>
                  <div style={{ padding: 14 }}>
                    <div className="serif" style={{ fontSize: 16, fontStyle: 'italic', lineHeight: 1.1 }}>
                      {s.plant.taxon?.latinName ?? s.plant.nameEn}
                    </div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {locale === 'fi'
                        ? s.plant.nameFi || s.plant.nameEn
                        : locale === 'sv'
                          ? s.plant.nameSv || s.plant.nameEn
                          : s.plant.nameEn}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Receipts + tax certs side-by-side */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: 24,
            marginBottom: 56,
          }}
        >
          <section aria-labelledby="receipts-h">
            <div className="eyebrow">{t('receipts')}</div>
            <h2 id="receipts-h" style={{ fontSize: 26, marginTop: 8, marginBottom: 16 }}>
              {locale === 'fi' ? 'Lahjoituskuitit' : 'Donation receipts'}
            </h2>
            <div className="card" style={{ padding: 0 }}>
              {garden.receipts.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  {locale === 'fi' ? 'Ei vielä kuitteja.' : 'No receipts yet.'}
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {garden.receipts.map((r, i) => (
                    <li
                      key={r.id}
                      style={{
                        padding: '14px 18px',
                        borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <span className="mono small" style={{ color: 'var(--forest)' }}>
                          {r.number}
                        </span>
                        <span className="muted small" style={{ marginLeft: 12 }}>
                          {new Date(r.issuedAt).toLocaleDateString(locale)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="mono">
                          €{(r.amountCents / 100).toFixed(2)}
                        </span>
                        {r.pdfUrl && (
                          <a
                            href={`/api/receipts/${encodeURIComponent(r.number)}/pdf`}
                            target="_blank"
                            rel="noopener"
                            className="btn btn-ghost"
                            style={{ padding: '6px 14px', fontSize: 12 }}
                          >
                            {tr('downloadPdf')}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="taxcert-h">
            <div className="eyebrow">{t('taxCertificates')}</div>
            <h2 id="taxcert-h" style={{ fontSize: 26, marginTop: 8, marginBottom: 16 }}>
              {locale === 'fi' ? 'Verotodistukset' : 'Tax certificates'}
            </h2>
            <div className="card" style={{ padding: 0 }}>
              {garden.taxCertificates.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  {locale === 'fi'
                    ? 'Vuositodistus annetaan tammikuussa.'
                    : 'Annual certificate issued in January.'}
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {garden.taxCertificates.map((c, i) => (
                    <li
                      key={c.id}
                      style={{
                        padding: '14px 18px',
                        borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="mono">{c.taxYear}</span>
                        <span className="mono">€{(c.totalCents / 100).toFixed(2)}</span>
                      </div>
                      <div className="tiny" style={{ marginTop: 4 }}>{c.scheme}</div>
                      {c.pdfUrl && (
                        <a
                          href={c.pdfUrl}
                          target="_blank"
                          rel="noopener"
                          className="btn btn-ghost"
                          style={{ padding: '6px 14px', fontSize: 12, marginTop: 8 }}
                        >
                          {tr('downloadPdf')}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* GDPR self-service */}
        <section aria-labelledby="gdpr-h" className="card card-pad">
          <div className="eyebrow">{t('gdpr')}</div>
          <h2 id="gdpr-h" style={{ fontSize: 22, marginTop: 8 }}>
            {locale === 'fi'
              ? 'Yksityisyytesi'
              : locale === 'sv'
                ? 'Din integritet'
                : 'Your privacy'}
          </h2>
          <p className="small muted" style={{ marginTop: 8 }}>
            {locale === 'fi'
              ? 'Lataa kopio tiedoistasi tai pyydä pseudonymisointi. Säilytämme taloustiedot 6 vuotta Suomen kirjanpitolain mukaisesti.'
              : 'Download a copy of your data or request pseudonymisation. We retain financial records for 6 years per Finnish accounting law.'}
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <form action="/api/gdpr/export" method="post">
              <button type="submit" className="btn btn-secondary">
                {t('exportData')}
              </button>
            </form>
            <form action="/api/gdpr/erase" method="post">
              <button type="submit" className="btn btn-secondary">
                {t('eraseData')}
              </button>
            </form>
          </div>
          {sp.gdpr && (
            <div
              role="status"
              style={{
                marginTop: 14,
                padding: '10px 14px',
                borderRadius: 10,
                background:
                  sp.gdpr === 'export_failed' || sp.gdpr === 'erase_failed'
                    ? '#FFF3EE'
                    : '#E8EEDE',
                color:
                  sp.gdpr === 'export_failed' || sp.gdpr === 'erase_failed'
                    ? '#B8513A'
                    : '#2D5440',
                border: '1px solid',
                borderColor:
                  sp.gdpr === 'export_failed' || sp.gdpr === 'erase_failed'
                    ? '#B8513A'
                    : '#A8C060',
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {sp.gdpr === 'export_queued'
                ? (locale === 'fi'
                    ? 'Tietopyyntö lähetetty. Lähetämme sinulle latauslinkin sähköpostiin pian.'
                    : locale === 'sv'
                      ? 'Begäran skickad. Vi mejlar en nedladdningslänk inom kort.'
                      : 'Export queued. We’ll email you a download link shortly.')
                : sp.gdpr === 'erase_pending'
                  ? (locale === 'fi'
                      ? 'Poistopyyntö vastaanotettu. Puutarhan vastuuhenkilö käsittelee sen 30 päivässä (GDPR Art. 12).'
                      : locale === 'sv'
                        ? 'Begäran mottagen. En trädgårdsansvarig granskar inom 30 dagar (GDPR Art. 12).'
                        : 'Erasure request received. A garden admin will review within 30 days (GDPR Art. 12).')
                  : (locale === 'fi'
                      ? `Pyyntö epäonnistui. Yritä uudelleen tai ota yhteys ${curatorEmail()}.`
                      : locale === 'sv'
                        ? `Begäran misslyckades. Försök igen eller mejla ${curatorEmail()}.`
                        : `Request failed. Please retry or email ${curatorEmail()}.`)}
            </div>
          )}
        </section>
      </div>
    </article>
  );
}
