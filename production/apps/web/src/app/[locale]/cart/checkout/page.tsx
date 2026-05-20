/**
 * /[locale]/cart/checkout — donor details + redirect to the bundled
 * Paytrail/MobilePay session. Server-component shell fetches tiers
 * (same source as /cart and /adopt); the form itself is a client
 * component because it reads the cart out of localStorage.
 */
import { getTranslations } from 'next-intl/server';
import CheckoutForm from './CheckoutForm.client';

export const dynamic = 'force-dynamic';

interface Tier {
  id: 'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate';
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
  monthlyPriceCents?: number | null;
}

function apiBase(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
}

async function fetchTiers(): Promise<Tier[]> {
  try {
    const res = await fetch(`${apiBase()}/v1/tiers`, { cache: 'no-store' });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

async function fetchIntervalsEnabled(): Promise<Array<'monthly' | 'annual' | 'one_time'>> {
  try {
    const res = await fetch(`${apiBase()}/v1/settings/public`, { cache: 'no-store' });
    if (!res.ok) return ['monthly', 'one_time'];
    const data = (await res.json()) as { adoption?: { intervalsEnabled?: string[] } };
    return (data.adoption?.intervalsEnabled ?? ['monthly', 'one_time']) as Array<'monthly' | 'annual' | 'one_time'>;
  } catch {
    return ['monthly', 'one_time'];
  }
}

export default async function CartCheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await getTranslations({ locale, namespace: 'Adopt' });
  const [tiers, intervalsEnabled] = await Promise.all([fetchTiers(), fetchIntervalsEnabled()]);

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
          {locale === 'fi'
            ? 'Kassalle'
            : locale === 'sv'
              ? 'Till kassan'
              : 'Checkout'}
        </div>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, 56px)', marginTop: 12, lineHeight: 1.05 }}>
          {locale === 'fi'
            ? 'Yksi maksu, koko korisi'
            : locale === 'sv'
              ? 'En betalning för hela din korg'
              : 'One payment for your whole cart'}
        </h1>
        <p className="muted" style={{ marginTop: 12, fontSize: 16, lineHeight: 1.55 }}>
          {locale === 'fi'
            ? 'Anna yhteystietosi alla. Sinut ohjataan turvalliseen maksupalveluun, ja kaikki valitsemasi kasvit aktivoituvat heti maksun jälkeen.'
            : locale === 'sv'
              ? 'Ange dina kontaktuppgifter nedan. Du skickas vidare till en säker betaltjänst, och alla dina valda växter aktiveras direkt efter betalning.'
              : 'Enter your contact details below. You’ll be sent to a secure payment provider, and every plant in your cart activates the moment payment clears.'}
        </p>
      </header>
      <CheckoutForm
        locale={locale}
        tiers={tiers}
        intervalsEnabled={intervalsEnabled}
        apiUrl={process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}
      />
    </main>
  );
}
