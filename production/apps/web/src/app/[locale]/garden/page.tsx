/**
 * My Garden — the donor dashboard.
 *
 *   - Adoptions with status + next renewal
 *   - Receipts list with download
 *   - Annual tax certificate
 *   - Plant timeline (curator notes)
 *   - GDPR self-service (export / erase)
 *   - Memorial dedication management
 */
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

async function fetchGarden(userId: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${apiUrl}/v1/users/${userId}/garden`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

export default async function GardenPage({ params }: { params: { locale: string } }) {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${params.locale}/sign-in`);
  const t = await getTranslations({ locale: params.locale, namespace: 'Garden' });
  const garden = await fetchGarden(session.user.id);

  if (!garden) {
    return <main><h1>{t('title')}</h1><p>No data yet.</p></main>;
  }
  return (
    <article>
      <header><h1>{t('title')}</h1><p>{garden.name ?? garden.email}</p></header>

      <section aria-labelledby="adoptions-h">
        <h2 id="adoptions-h">{t('adoptions')}</h2>
        <ul className="grid">
          {garden.adoptions.map((a: any) => (
            <li key={a.id} className="card">
              <h3>{a.plant.nameEn}</h3>
              <p><strong>{a.tier.name}</strong> · €{(a.amountCents / 100).toFixed(0)}/{a.billingInterval}</p>
              <p>Status: <span data-status={a.status}>{a.status}</span></p>
              {a.plaque?.engravedText && <p>🏷 Plaque: “{a.plaque.engravedText}”</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="receipts-h">
        <h2 id="receipts-h">{t('receipts')}</h2>
        <ul>
          {garden.receipts.map((r: any) => (
            <li key={r.id}>
              <a href={r.pdfUrl} target="_blank" rel="noopener">
                {r.number} · €{(r.amountCents / 100).toFixed(2)} · {new Date(r.issuedAt).toLocaleDateString(params.locale)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tax-h">
        <h2 id="tax-h">{t('taxCertificates')}</h2>
        <ul>
          {garden.taxCertificates.map((c: any) => (
            <li key={c.id}>
              <a href={c.pdfUrl} target="_blank" rel="noopener">
                {c.taxYear} · €{(c.totalCents / 100).toFixed(2)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="gdpr-h">
        <h2 id="gdpr-h">Privacy / GDPR</h2>
        <form action="/api/gdpr/export" method="post">
          <button type="submit">Request a copy of my data</button>
        </form>
        <form action="/api/gdpr/erase" method="post">
          <button type="submit">Erase my data</button>
        </form>
      </section>
    </article>
  );
}
