/**
 * My Garden — the donor dashboard.
 *
 *   - Your gifts (one-time donations): amount, status, optional directed
 *     species, dedication and date
 *   - Recent AskTheGarden conversations
 *   - Donation receipts (PDF) + annual tax certificates (PDF)
 *   - GDPR self-service (export / erase)
 *
 * Reads GET /v1/me/donations with the donor's session JWT. The previous
 * recurring-membership dashboard has been retired in the move to one-time
 * donations.
 */
import { redirect } from 'next/navigation';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { getSession } from '../../../lib/session';
import { curatorEmail } from '../../../lib/contact';

export const dynamic = 'force-dynamic';

interface DonationsView {
  donations: Array<{
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    dedication: string | null;
    startedAt: string | null;
    createdAt: string;
    plant: { slug: string; nameEn: string; nameFi: string; nameSv: string } | null;
  }>;
  receipts: Array<{
    id: string;
    number: string;
    kind: string;
    amountCents: number;
    currency: string;
    pdfUrl: string | null;
    issuedAt: string;
  }>;
  taxCertificates: Array<{
    id: string;
    taxYear: number;
    totalCents: number;
    scheme: string;
    pdfUrl: string | null;
    issuedAt: string;
  }>;
}

async function fetchDonations(jwt: string): Promise<DonationsView | null> {
  // SSR runs inside the container; the internal API URL resolves on the
  // bridge network where the public host-relative URL does not.
  const apiUrl = getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/me/donations`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: 'no-store',
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

interface AskHistoryRow {
  id: string;
  // The API field is `text` (matches AskMessage.text in Prisma).
  text: string;
  createdAt: string;
  sessionId?: string | null;
  answer?: { text: string | null } | null;
}
async function fetchAskHistory(userId: string): Promise<AskHistoryRow[]> {
  const apiUrl = getInternalApiUrl();
  try {
    const res = await fetch(
      `${apiUrl}/v1/ask/history?userId=${encodeURIComponent(userId)}&limit=5`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: AskHistoryRow[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

function localisedPlantName(
  p: { nameEn: string; nameFi: string; nameSv: string },
  locale: string,
) {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

export default async function GardenPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ gdpr?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await getSession();
  if (!session.user?.id) redirect(`/${locale}/sign-in`);
  const user = session.user;
  const t = await getTranslations({ locale, namespace: 'Garden' });
  const tr = await getTranslations({ locale, namespace: 'Receipts' });
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  const sessionJwt = jar.get('bloomoulu.session')?.value ?? '';
  const [data, askHistory] = await Promise.all([
    fetchDonations(sessionJwt),
    fetchAskHistory(user.id),
  ]);

  if (!data) {
    return (
      <main className="container" style={{ padding: '48px 32px' }}>
        <h1>{t('title')}</h1>
        <p className="muted">
          {locale === 'fi'
            ? 'Tietoja ei voitu ladata juuri nyt.'
            : locale === 'sv'
              ? 'Kunde inte ladda data just nu.'
              : 'Could not load your data right now.'}
        </p>
      </main>
    );
  }

  const { donations, receipts, taxCertificates } = data;
  const displayName = user.name ?? user.email;
  const firstName =
    user.name?.split(' ')[0] ??
    (locale === 'fi' ? 'sinä' : locale === 'sv' ? 'du' : 'friend');
  const numberTag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
  const completedTotalCents = donations
    .filter((d) => d.status === 'completed')
    .reduce((sum, d) => sum + d.amountCents, 0);
  const fmtEur = (cents: number, currency = 'EUR'): string => {
    const v = cents / 100;
    return new Intl.NumberFormat(numberTag, {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: v % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(v);
  };
  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : `${locale}-FI`, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const statusLabel = (status: string): string => {
    const m: Record<string, [string, string, string]> = {
      completed: ['Confirmed', 'Vahvistettu', 'Bekräftad'],
      pending: ['Pending', 'Odottaa', 'Väntande'],
      processing: ['Processing', 'Käsitellään', 'Behandlas'],
      failed: ['Failed', 'Epäonnistui', 'Misslyckades'],
      refunded: ['Refunded', 'Hyvitetty', 'Återbetald'],
      cancelled: ['Cancelled', 'Peruutettu', 'Avbruten'],
    };
    const row = m[status];
    if (!row) return status;
    return locale === 'fi' ? row[1] : locale === 'sv' ? row[2] : row[0];
  };

  return (
    <article className="fade-in">
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
              {t('title')} · {displayName}
            </div>
            <h1 style={{ fontSize: 'clamp(40px, 6vw, 64px)', marginTop: 12 }}>
              {locale === 'fi' ? (
                <>
                  Tervetuloa takaisin,<br />
                  <span className="italic-serif accent-grad">{firstName}</span>.
                </>
              ) : locale === 'sv' ? (
                <>
                  Välkommen tillbaka,<br />
                  <span className="italic-serif accent-grad">{firstName}</span>.
                </>
              ) : (
                <>
                  Welcome back,<br />
                  <span className="italic-serif accent-grad">{firstName}</span>.
                </>
              )}
            </h1>
            <p className="muted" style={{ marginTop: 16, fontSize: 16, maxWidth: 560 }}>
              {donations.length}{' '}
              {locale === 'fi'
                ? `lahjoitusta${completedTotalCents > 0 ? ` · ${fmtEur(completedTotalCents)} annettu` : ''}.`
                : locale === 'sv'
                  ? `gåvor${completedTotalCents > 0 ? ` · ${fmtEur(completedTotalCents)} givet` : ''}.`
                  : `gifts${completedTotalCents > 0 ? ` · ${fmtEur(completedTotalCents)} given` : ''}.`}
            </p>
          </div>
          <Link href={`/${locale}/donate`} className="btn btn-primary">
            +{' '}
            {locale === 'fi'
              ? 'Lahjoita lisää'
              : locale === 'sv'
                ? 'Ge en gåva till'
                : 'Make another gift'}
          </Link>
        </div>

        {/* Your gifts (one-time donations) */}
        <section aria-labelledby="donations-h" style={{ marginBottom: 56 }}>
          <div className="eyebrow">{t('donations')}</div>
          <h2 id="donations-h" style={{ fontSize: 36, marginTop: 8, marginBottom: 24 }}>
            {donations.length}{' '}
            {donations.length === 1
              ? locale === 'fi'
                ? 'lahja'
                : locale === 'sv'
                  ? 'gåva'
                  : 'gift'
              : locale === 'fi'
                ? 'lahjaa'
                : locale === 'sv'
                  ? 'gåvor'
                  : 'gifts'}
          </h2>
          {donations.length === 0 ? (
            <p className="muted">{t('empty')}</p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {donations.map((d) => (
                <article
                  key={d.id}
                  className="card card-pad"
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 140 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                    }}
                  >
                    <span className="serif" style={{ fontSize: 28, lineHeight: 1 }}>
                      {fmtEur(d.amountCents, d.currency)}
                    </span>
                    <span className="pill" style={{ flexShrink: 0 }}>
                      {statusLabel(d.status)}
                    </span>
                  </div>
                  {d.plant && (
                    <Link
                      href={`/${locale}/plants/${d.plant.slug}`}
                      style={{
                        fontStyle: 'italic',
                        fontSize: 15,
                        color: 'var(--moss)',
                        textDecoration: 'none',
                      }}
                    >
                      {localisedPlantName(d.plant, locale)}
                    </Link>
                  )}
                  {d.dedication && (
                    <p
                      className="small"
                      style={{ fontStyle: 'italic', color: 'var(--ink-soft)', lineHeight: 1.4 }}
                    >
                      &ldquo;{d.dedication}&rdquo;
                    </p>
                  )}
                  <div className="tiny" style={{ color: 'var(--ink-faint)', marginTop: 'auto' }}>
                    {dateFmt(d.startedAt ?? d.createdAt)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

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
              {locale === 'fi' ? 'Lahjoituskuitit' : locale === 'sv' ? 'Donationskvitton' : 'Donation receipts'}
            </h2>
            <div className="card" style={{ padding: 0 }}>
              {receipts.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  {locale === 'fi'
                    ? 'Ei vielä kuitteja.'
                    : locale === 'sv'
                      ? 'Inga kvitton än.'
                      : 'No receipts yet.'}
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {receipts.map((r, i) => (
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
                        <span className="mono">{fmtEur(r.amountCents, r.currency)}</span>
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
              {locale === 'fi' ? 'Verotodistukset' : locale === 'sv' ? 'Skatteintyg' : 'Tax certificates'}
            </h2>
            <div className="card" style={{ padding: 0 }}>
              {taxCertificates.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  {locale === 'fi'
                    ? 'Vuositodistus annetaan tammikuussa.'
                    : locale === 'sv'
                      ? 'Årsintyget utfärdas i januari.'
                      : 'Annual certificate issued in January.'}
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {taxCertificates.map((c, i) => (
                    <li
                      key={c.id}
                      style={{
                        padding: '14px 18px',
                        borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="mono">{c.taxYear}</span>
                        <span className="mono">{fmtEur(c.totalCents)}</span>
                      </div>
                      <div className="tiny" style={{ marginTop: 4 }}>{c.scheme}</div>
                      {c.pdfUrl && (
                        <a
                          // Route through the auth-gated proxy so the donor's
                          // session is checked and the local:// storage URI is
                          // resolved server-side (a browser can't fetch it).
                          href={`/api/tax-certs/${encodeURIComponent(c.id)}/pdf`}
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
              : locale === 'sv'
                ? 'Ladda ner en kopia av dina uppgifter eller begär pseudonymisering. Vi behåller ekonomiska uppgifter i 6 år enligt finsk bokföringslag.'
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
