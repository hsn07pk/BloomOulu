/**
 * Paytrail mock checkout (localhost/dev only).
 *
 * This page replaces Paytrail's hosted checkout when `PAYTRAIL_MOCK=true`
 * on the api. The donor lands here from PaytrailGateway.createCheckout
 * with the order summary in the URL; picking a test bank or pressing
 * "Pay" calls the api's mock-finalize endpoint, which signs a return
 * URL with the REAL merchant secret and 302s the donor back to
 * /donate/complete — where the SAME signature verification +
 * activation path runs as in production. The only mocked thing is the
 * "pick your bank" UI on this page; everything downstream is real.
 *
 * In real production, `PAYTRAIL_MOCK=false`, the gateway POSTs to
 * services.paytrail.com/payments, and the donor never sees this page.
 */
import { redirect } from 'next/navigation';
import { payWithMockAction, cancelMockAction } from './actions';

export const dynamic = 'force-dynamic';

const COPY = {
  en: {
    bannerEyebrow: 'Paytrail · test mode',
    bannerNote: 'No money will be moved. This page reproduces the production checkout flow against Paytrail’s public test merchant.',
    summaryTitle: 'Pay BloomOulu',
    method: 'Choose a payment method',
    cardLabel: 'Card · Visa / Mastercard',
    cardSub: 'Use any test PAN, expiry 12/30, CVC 123',
    bankLabel: 'Online bank',
    bankSub: 'Nordea · OP · Aktia · Danske · Säästöpankki · Ålandsbanken',
    payBtn: 'Pay €',
    cancelBtn: 'Cancel and return to BloomOulu',
    failBtn: 'Simulate failure',
    order: 'Order',
    item: 'Item',
    amount: 'Amount',
  },
  fi: {
    bannerEyebrow: 'Paytrail · testitila',
    bannerNote: 'Mitään rahaa ei siirry. Tämä sivu toistaa tuotannon maksuvirran Paytrailin julkista testikauppiasta vasten.',
    summaryTitle: 'Maksa BloomOululle',
    method: 'Valitse maksutapa',
    cardLabel: 'Kortti · Visa / Mastercard',
    cardSub: 'Käytä mitä tahansa testikorttinumeroa, voim. 12/30, CVC 123',
    bankLabel: 'Verkkopankki',
    bankSub: 'Nordea · OP · Aktia · Danske · Säästöpankki · Ålandsbanken',
    payBtn: 'Maksa €',
    cancelBtn: 'Peruuta ja palaa BloomOuluun',
    failBtn: 'Simuloi epäonnistuminen',
    order: 'Tilaus',
    item: 'Tuote',
    amount: 'Summa',
  },
  sv: {
    bannerEyebrow: 'Paytrail · testläge',
    bannerNote: 'Inga pengar flyttas. Den här sidan återskapar produktionens betalflöde mot Paytrails publika testhandlare.',
    summaryTitle: 'Betala BloomOulu',
    method: 'Välj betalningsmetod',
    cardLabel: 'Kort · Visa / Mastercard',
    cardSub: 'Använd valfritt testkortsnummer, utg. 12/30, CVC 123',
    bankLabel: 'Internetbank',
    bankSub: 'Nordea · OP · Aktia · Danske · Sparbanken · Ålandsbanken',
    payBtn: 'Betala €',
    cancelBtn: 'Avbryt och återgå till BloomOulu',
    failBtn: 'Simulera fel',
    order: 'Order',
    item: 'Produkt',
    amount: 'Belopp',
  },
} as const;

export default async function PaytrailMockPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    orderId?: string;
    amount?: string;
    description?: string;
    success?: string;
    cancel?: string;
  }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : 'en'];

  if (!sp.orderId || !sp.amount) {
    redirect(`/${locale}/donate`);
  }
  const amountCents = parseInt(sp.amount, 10) || 0;
  const description = sp.description ?? '';

  return (
    <main
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: 'clamp(32px, 6vw, 64px) 24px',
      }}
    >
      {/* Paytrail-style banner */}
      <div
        style={{
          background: '#FFF8E5',
          border: '1px solid #E8C66A',
          color: '#7A5C00',
          borderRadius: 12,
          padding: '12px 16px',
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 24,
        }}
      >
        <div style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11, marginBottom: 2 }}>
          {t.bannerEyebrow}
        </div>
        {t.bannerNote}
      </div>

      {/* Paytrail-style header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: '#0A2D5D',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: '-0.02em',
          }}
        >
          P
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Paytrail</div>
          <div className="tiny muted">checkout.paytrail.com</div>
        </div>
      </header>

      {/* Order summary card */}
      <section
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: 24,
          marginBottom: 18,
        }}
      >
        <h1 style={{ fontFamily: 'var(--f-display)', fontWeight: 400, fontSize: 22, margin: '0 0 16px', color: 'var(--forest-deep)' }}>
          {t.summaryTitle}
        </h1>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 8, fontSize: 14 }}>
          <dt className="muted">{t.order}</dt>
          <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{sp.orderId.slice(0, 18)}…</dd>
          {description && (
            <>
              <dt className="muted">{t.item}</dt>
              <dd style={{ margin: 0 }}>{description}</dd>
            </>
          )}
          <dt className="muted">{t.amount}</dt>
          <dd style={{ margin: 0, fontSize: 24, fontFamily: 'var(--f-display)', color: 'var(--forest-deep)', lineHeight: 1 }}>
            €{(amountCents / 100).toFixed(2)}
          </dd>
        </dl>
      </section>

      {/* Method picker (visual only — the mock signs whatever is clicked) */}
      <section
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: 24,
          marginBottom: 18,
        }}
      >
        <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
          {t.method}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { id: 'card', title: t.cardLabel, sub: t.cardSub, glyph: '💳' },
            { id: 'bank', title: t.bankLabel, sub: t.bankSub, glyph: '🏦' },
          ].map((m, idx) => (
            <div
              key={m.id}
              style={{
                padding: '14px 16px',
                borderRadius: 12,
                border: idx === 0 ? '2px solid var(--forest)' : '1px solid var(--line)',
                background: idx === 0 ? 'var(--sage-pale)' : 'var(--cream)',
                display: 'grid',
                gridTemplateColumns: '32px 1fr',
                gap: 14,
                alignItems: 'center',
              }}
            >
              <div aria-hidden="true" style={{ fontSize: 22 }}>{m.glyph}</div>
              <div>
                <div style={{ fontWeight: idx === 0 ? 600 : 500, color: 'var(--forest-deep)', fontSize: 15 }}>
                  {m.title}
                </div>
                <div className="small muted" style={{ marginTop: 2, lineHeight: 1.4 }}>
                  {m.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form action={payWithMockAction} style={{ marginBottom: 12 }}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={sp.orderId} />
        <input type="hidden" name="cancel" value={sp.cancel ?? ''} />
        <button
          type="submit"
          className="btn btn-primary btn-lg btn-block"
          style={{ background: '#0A2D5D', borderColor: '#0A2D5D' }}
        >
          {t.payBtn}{(amountCents / 100).toFixed(2)} →
        </button>
      </form>

      <form action={payWithMockAction} style={{ marginBottom: 12 }}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={sp.orderId} />
        <input type="hidden" name="cancel" value={sp.cancel ?? ''} />
        <input type="hidden" name="status" value="fail" />
        <button
          type="submit"
          className="btn btn-secondary btn-block"
          style={{ background: 'transparent', color: 'var(--rust-on-light)', borderColor: 'var(--line)' }}
        >
          {t.failBtn}
        </button>
      </form>

      <form action={cancelMockAction}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="cancel" value={sp.cancel ?? ''} />
        <button
          type="submit"
          style={{
            width: '100%',
            background: 'transparent',
            border: 0,
            color: 'var(--ink-mute)',
            fontSize: 13,
            padding: '14px 0',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 4,
          }}
        >
          {t.cancelBtn}
        </button>
      </form>
    </main>
  );
}
