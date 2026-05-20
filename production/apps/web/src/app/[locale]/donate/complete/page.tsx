/**
 * /[locale]/donate/complete — Paytrail success-return handler.
 *
 * Flow:
 *   1. The donor finishes the Paytrail hosted checkout (real test merchant
 *      sandbox or production). Paytrail redirects them here with the same
 *      `checkout-*` query parameters and a HMAC `signature`.
 *   2. We forward those params to `GET /webhooks/paytrail` on the api,
 *      which runs the exact signature-verify path used by the server-
 *      to-server callback. A duplicate (server callback already fired)
 *      is silently deduplicated.
 *   3. Render the outcome: success → "Activate complete, here's a link to
 *      My Garden"; pending → "Confirming…"; fail → "Try again".
 *
 * Server component — runs entirely on the server so the signature
 * verification never leaks the merchant secret to the browser.
 */
import { getTranslations } from 'next-intl/server';
import { curatorEmail } from '../../../../lib/contact';

export const dynamic = 'force-dynamic';

function apiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
}

type Outcome =
  | { kind: 'ok'; stamp: string }
  | { kind: 'pending'; stamp: string }
  | { kind: 'fail'; stamp: string; reason: string }
  | { kind: 'invalid'; reason: string };

const COPY = {
  en: {
    okTitle: 'Thank you — your adoption is live!',
    okLead: 'Payment confirmed. Every plant in your cart has been activated; you can revisit them any time from My Garden.',
    okCta: 'Go to My Garden →',
    okSecondary: 'Back to the collection',
    pendingTitle: 'Confirming your payment…',
    pendingLead: 'Paytrail is still confirming your transfer. Refresh this page in a moment — once it’s through we’ll activate your adoptions automatically.',
    failTitle: 'Payment didn’t complete',
    failLead: 'No charge was made. Your cart is still there if you’d like to try a different method.',
    failCta: 'Back to my cart',
    invalidTitle: 'Hmm — that link doesn’t look quite right.',
    invalidLead: 'We couldn’t verify the payment confirmation. If you completed a payment, please email {email} with the time and amount and we’ll sort it.',
    invalidCta: 'Back to home',
  },
  fi: {
    okTitle: 'Kiitos — adoptiosi on aktiivinen!',
    okLead: 'Maksu vahvistettu. Jokainen korissasi ollut kasvi on aktivoitu, ja näet ne aina Omasta puutarhastani.',
    okCta: 'Siirry Omaan puutarhaani →',
    okSecondary: 'Takaisin kokoelmaan',
    pendingTitle: 'Vahvistamme maksuasi…',
    pendingLead: 'Paytrail vahvistaa siirtoasi vielä. Päivitä sivu hetken kuluttua — heti kun se on käsitelty, aktivoimme adoptiosi automaattisesti.',
    failTitle: 'Maksu ei mennyt läpi',
    failLead: 'Veloitusta ei tehty. Korisi on yhä tallessa, voit halutessasi yrittää eri tavalla.',
    failCta: 'Takaisin koriin',
    invalidTitle: 'Hmm — tämä linkki näyttää oudolta.',
    invalidLead: 'Emme voineet vahvistaa maksun kuittausta. Jos teit maksun, lähetä sähköpostia {email} ja kerro aika ja summa, niin selvitämme.',
    invalidCta: 'Takaisin etusivulle',
  },
  sv: {
    okTitle: 'Tack — din adoption är aktiv!',
    okLead: 'Betalningen bekräftad. Varje växt i din korg har aktiverats; du hittar dem alltid i Min trädgård.',
    okCta: 'Gå till Min trädgård →',
    okSecondary: 'Tillbaka till samlingen',
    pendingTitle: 'Vi bekräftar din betalning…',
    pendingLead: 'Paytrail bekräftar fortfarande din överföring. Uppdatera sidan om en stund — så snart den är klar aktiverar vi dina adoptioner automatiskt.',
    failTitle: 'Betalningen genomfördes inte',
    failLead: 'Inget belopp drogs. Din korg finns kvar om du vill prova en annan metod.',
    failCta: 'Tillbaka till min korg',
    invalidTitle: 'Hmm — den länken ser inte rätt ut.',
    invalidLead: 'Vi kunde inte verifiera betalningens bekräftelse. Om du genomförde en betalning, mejla {email} med tid och belopp så hjälper vi dig.',
    invalidCta: 'Tillbaka till startsidan',
  },
} as const;

export default async function DonateCompletePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  await getTranslations({ locale, namespace: 'Adopt' });
  const t = COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : 'en'];

  const status = typeof sp['checkout-status'] === 'string' ? sp['checkout-status'] : null;
  const stamp = typeof sp['checkout-stamp'] === 'string' ? sp['checkout-stamp'] : null;
  const signature = typeof sp['signature'] === 'string' ? sp['signature'] : null;
  const mpStatus = typeof sp['mobilepay-status'] === 'string' ? sp['mobilepay-status'] : null;
  const mpOrder = typeof sp['order'] === 'string' ? sp['order'] : null;

  let outcome: Outcome;
  // MobilePay mock branch — no signature dance (the api already
  // activated the adoption via handleEvent), just render the outcome.
  if (mpStatus && mpOrder) {
    outcome =
      mpStatus === 'ok'
        ? { kind: 'ok', stamp: mpOrder }
        : { kind: 'fail', stamp: mpOrder, reason: 'declined' };
  } else if (!status || !stamp || !signature) {
    outcome = { kind: 'invalid', reason: 'missing_params' };
  } else {
    // Forward every param to the api's GET /webhooks/paytrail. The api
    // verifies the HMAC against the merchant secret and, on success,
    // activates the adoption(s). Already-fired server callbacks dedup.
    const fwd = new URL(`${apiUrl()}/webhooks/paytrail`);
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === 'string') fwd.searchParams.set(k, v);
    }
    try {
      const res = await fetch(fwd, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        if (status === 'ok') outcome = { kind: 'ok', stamp };
        else if (status === 'fail') outcome = { kind: 'fail', stamp, reason: 'declined' };
        else outcome = { kind: 'pending', stamp };
      } else if (res.ok && data?.error === 'signature') {
        outcome = { kind: 'invalid', reason: 'signature' };
      } else {
        outcome = { kind: 'invalid', reason: `http_${res.status}` };
      }
    } catch {
      outcome = { kind: 'pending', stamp };
    }
  }

  const accent =
    outcome.kind === 'ok'
      ? { bg: '#E8EEDE', border: '#A8C060', icon: '🌿' }
      : outcome.kind === 'pending'
        ? { bg: '#FAF7EE', border: '#E5E2D8', icon: '⏳' }
        : outcome.kind === 'fail'
          ? { bg: '#FFF3EE', border: '#B8513A', icon: '✋' }
          : { bg: '#FAF7EE', border: '#E5E2D8', icon: '🤔' };

  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: 'clamp(40px, 8vw, 96px) 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: accent.bg,
          border: `1px solid ${accent.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 38,
          margin: '0 auto 24px',
        }}
        aria-hidden="true"
      >
        {accent.icon}
      </div>
      {outcome.kind === 'ok' && (
        <>
          <h1 style={{ fontSize: 'clamp(36px, 5vw, 48px)', lineHeight: 1.05, marginBottom: 16 }}>
            {t.okTitle}
          </h1>
          <p className="muted" style={{ fontSize: 17, lineHeight: 1.55, maxWidth: 520, marginInline: 'auto' }}>
            {t.okLead}
          </p>
          <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={`/${locale}/garden`} className="btn btn-primary btn-lg">
              {t.okCta}
            </a>
            <a
              href={`/${locale}/plants`}
              className="btn btn-secondary"
              style={{ background: 'transparent' }}
            >
              {t.okSecondary}
            </a>
          </div>
        </>
      )}
      {outcome.kind === 'pending' && (
        <>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 40px)', lineHeight: 1.1, marginBottom: 16 }}>
            {t.pendingTitle}
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.55, maxWidth: 520, marginInline: 'auto' }}>
            {t.pendingLead}
          </p>
          <p style={{ marginTop: 32 }}>
            <a href={`/${locale}/garden`} className="btn btn-secondary">
              {locale === 'fi' ? 'Avaa Oma puutarha' : locale === 'sv' ? 'Öppna Min trädgård' : 'Open My Garden'}
            </a>
          </p>
        </>
      )}
      {outcome.kind === 'fail' && (
        <>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 40px)', lineHeight: 1.1, marginBottom: 16 }}>
            {t.failTitle}
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.55, maxWidth: 520, marginInline: 'auto' }}>
            {t.failLead}
          </p>
          <p style={{ marginTop: 32 }}>
            <a href={`/${locale}/cart`} className="btn btn-primary">
              {t.failCta}
            </a>
          </p>
        </>
      )}
      {outcome.kind === 'invalid' && (
        <>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 40px)', lineHeight: 1.1, marginBottom: 16 }}>
            {t.invalidTitle}
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.55, maxWidth: 520, marginInline: 'auto' }}>
            {t.invalidLead.replace('{email}', curatorEmail())}
          </p>
          <p style={{ marginTop: 32 }}>
            <a href={`/${locale}`} className="btn btn-secondary">
              {t.invalidCta}
            </a>
          </p>
          <p className="tiny muted" style={{ marginTop: 18 }}>
            {outcome.reason}
          </p>
        </>
      )}
    </main>
  );
}
