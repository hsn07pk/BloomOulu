/**
 * /[locale]/cart — review your adoption selection.
 *
 * Shell is a server component; the cart itself is in localStorage so
 * the actual list lives in a client component. Tier prices come from
 * /v1/tiers (same source the adopt wizard uses).
 */
import { getTranslations } from 'next-intl/server';
import CartView from './CartView.client';

export const dynamic = 'force-dynamic';

function internalApiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
}

interface Tier {
  id: 'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate';
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
}

async function fetchTiers(): Promise<Tier[]> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/tiers`, { cache: 'no-store' });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await getTranslations({ locale, namespace: 'Adopt' });
  const tiers = await fetchTiers();
  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: 'clamp(32px, 6vw, 64px) 24px',
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          {locale === 'fi' ? 'Kori' : locale === 'sv' ? 'Korg' : 'Cart'}
        </div>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, 56px)', marginTop: 12, lineHeight: 1.05 }}>
          {locale === 'fi'
            ? 'Adoptiokorisi'
            : locale === 'sv'
              ? 'Din adoptionskorg'
              : 'Your adoption cart'}
        </h1>
        <p className="muted" style={{ marginTop: 12, fontSize: 16, lineHeight: 1.55 }}>
          {locale === 'fi'
            ? 'Adoptoi yksi tai useita kasveja samalla maksulla. Voit muuttaa tason kohta kohdalta.'
            : locale === 'sv'
              ? 'Adoptera en eller flera växter i en och samma betalning. Du kan ändra nivå för varje växt.'
              : 'Adopt one plant or several in a single checkout. You can change the tier on each item.'}
        </p>
      </header>

      <CartView locale={locale} tiers={tiers} apiUrl={process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'} />
    </main>
  );
}
