import { signInAction } from './actions';

const COPY = {
  en: {
    eyebrow: 'Sign in',
    title: 'Welcome back.',
    lead: "We'll email you a one-tap sign-in link. No password needed.",
    emailLabel: 'Email address',
    emailHint: "We'll only use it to send the sign-in link.",
    submit: 'Send sign-in link →',
    privacyHint: 'By signing in you agree to our',
    privacyTerms: 'terms',
    and: 'and',
    privacyPrivacy: 'privacy policy',
    period: '.',
    altTitle: 'Are you Garden staff?',
    altBody:
      'Curators, finance, and admins sign in through the University of Oulu SSO (coming soon).',
  },
  fi: {
    eyebrow: 'Kirjautuminen',
    title: 'Tervetuloa takaisin.',
    lead: 'Lähetämme sähköpostiisi kertakäyttöisen kirjautumislinkin. Ei salasanaa.',
    emailLabel: 'Sähköpostiosoite',
    emailHint: 'Käytetään vain kirjautumislinkin lähettämiseen.',
    submit: 'Lähetä kirjautumislinkki →',
    privacyHint: 'Kirjautumalla hyväksyt',
    privacyTerms: 'käyttöehdot',
    and: 'ja',
    privacyPrivacy: 'tietosuojaselosteen',
    period: '.',
    altTitle: 'Oletko puutarhan henkilökuntaa?',
    altBody:
      'Puutarhurit, talous ja ylläpitäjät kirjautuvat Oulun yliopiston SSO:n kautta (tulossa).',
  },
  sv: {
    eyebrow: 'Logga in',
    title: 'Välkommen tillbaka.',
    lead: 'Vi mejlar en engångslänk för inloggning. Inget lösenord behövs.',
    emailLabel: 'E-postadress',
    emailHint: 'Används endast för att skicka inloggningslänken.',
    submit: 'Skicka inloggningslänk →',
    privacyHint: 'Genom att logga in godkänner du våra',
    privacyTerms: 'villkor',
    and: 'och',
    privacyPrivacy: 'integritetspolicy',
    period: '.',
    altTitle: 'Är du anställd i trädgården?',
    altBody:
      'Trädgårdsmästare, ekonomi och admins loggar in via Uleåborgs universitets SSO (kommer snart).',
  },
} as const;

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : 'en'];

  return (
    <main
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: 'clamp(32px, 6vw, 80px) 24px',
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          {t.eyebrow}
        </div>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, 56px)', marginTop: 12, lineHeight: 1.05 }}>
          {t.title}
        </h1>
        <p className="muted" style={{ marginTop: 12, fontSize: 16, lineHeight: 1.55 }}>
          {t.lead}
        </p>
      </header>

      <form
        action={signInAction}
        className="card card-pad"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          background: 'var(--paper)',
        }}
      >
        <input type="hidden" name="locale" value={locale} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label">{t.emailLabel}</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="name@example.com"
            style={{
              padding: '14px 16px',
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--cream)',
              fontSize: 16,
              fontFamily: 'var(--f-body)',
              minHeight: 48,
              color: 'var(--ink)',
            }}
          />
          <span className="small muted">{t.emailHint}</span>
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 4 }}>
          {t.submit}
        </button>

        <p className="small muted" style={{ marginTop: 4, lineHeight: 1.55, textAlign: 'center' }}>
          {t.privacyHint}{' '}
          <a href={`/${locale}/terms`}>{t.privacyTerms}</a> {t.and}{' '}
          <a href={`/${locale}/privacy`}>{t.privacyPrivacy}</a>
          {t.period}
        </p>
      </form>

      <section
        className="card card-pad"
        style={{
          marginTop: 24,
          background: 'var(--sage-pale)',
          border: '1px solid var(--line-soft)',
        }}
        aria-labelledby="staff-h"
      >
        <h2 id="staff-h" className="serif" style={{ fontSize: 18, marginBottom: 6 }}>
          {t.altTitle}
        </h2>
        <p className="small" style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
          {t.altBody}
        </p>
      </section>
    </main>
  );
}
