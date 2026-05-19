import { lookupEmailAction, passwordSignInAction, signInAction } from './actions';

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
    altTitle: 'Are you Garden staff or a University of Oulu student?',
    altBody:
      'Sign in with your University of Oulu account. Staff get curator/admin access automatically based on your IdP groups.',
    altCta: 'Sign in with University of Oulu',
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
    altTitle: 'Henkilökunta tai Oulun yliopiston opiskelija?',
    altBody:
      'Kirjaudu Oulun yliopiston tunnuksellasi. Henkilökunta saa puutarhuri-/admin-oikeudet IdP-ryhmiensä perusteella.',
    altCta: 'Kirjaudu Oulun yliopistolla',
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
    altTitle: 'Personal eller student vid Uleåborgs universitet?',
    altBody:
      'Logga in med ditt Uleåborgs universitet-konto. Personal får curator-/admin-rättigheter automatiskt baserat på dina IdP-grupper.',
    altCta: 'Logga in med Uleåborgs universitet',
  },
} as const;

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string; step?: string; email?: string }>;
}) {
  const { locale } = await params;
  const { reason, step, email: prefillEmail } = await searchParams;
  const passwordStep = step === 'password' && prefillEmail;
  const t = COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : 'en'];

  // SSO is enabled only when the University of Oulu IdP credentials are
  // present at deploy time. On localhost (and any deploy without those
  // env vars) we hide the button and explain why, so visitors don't
  // click a button that silently no-ops.
  const ssoEnabled = Boolean(process.env.AUTH_OULU_OIDC_CLIENT_ID);

  // Friendly banner copy when the OIDC handler redirected back with a
  // reason query param (e.g. ?reason=oulu_not_configured).
  const reasonBanner: { kind: 'info' | 'warn'; text: string } | null = (() => {
    if (!reason) return null;
    if (reason === 'oulu_not_configured') {
      return {
        kind: 'warn',
        text:
          locale === 'fi'
            ? 'Oulun yliopiston kirjautuminen ei ole vielä käytössä tässä ympäristössä. Käytä sähköpostilinkkiä.'
            : locale === 'sv'
              ? 'Inloggning med Uleåborgs universitet är inte aktiverat i denna miljö. Använd e-postlänken.'
              : "University of Oulu sign-in isn't configured in this environment yet. Please use the email link below.",
      };
    }
    if (reason === 'oulu_discovery_failed') {
      return {
        kind: 'warn',
        text:
          locale === 'fi'
            ? 'Oulun yliopiston IdP ei vastannut. Yritä uudelleen tai käytä sähköpostilinkkiä.'
            : locale === 'sv'
              ? 'Uleåborgs universitets IdP svarade inte. Försök igen eller använd e-postlänken.'
              : "Couldn't reach the University of Oulu identity provider. Try again or use the email link.",
      };
    }
    if (reason === 'wrong_password') {
      return {
        kind: 'warn',
        text:
          locale === 'fi'
            ? 'Salasana ei täsmää. Yritä uudelleen tai pyydä uusi kirjautumislinkki.'
            : locale === 'sv'
              ? 'Lösenordet matchar inte. Försök igen eller begär en ny inloggningslänk.'
              : "That password didn't match. Try again, or request a fresh sign-in link.",
      };
    }
    if (reason === 'expired' || reason === 'invalid') {
      return {
        kind: 'warn',
        text:
          locale === 'fi'
            ? 'Linkki on vanhentunut. Pyydä uusi.'
            : locale === 'sv'
              ? 'Länken har gått ut. Begär en ny.'
              : 'That link has expired. Request a new one below.',
      };
    }
    return null;
  })();

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

      {reasonBanner && (
        <div
          role="alert"
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 12,
            background: 'rgba(184,81,58,0.08)',
            border: '1px solid rgba(184,81,58,0.18)',
            color: 'var(--rust-on-light)',
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          {reasonBanner.text}
        </div>
      )}

      {passwordStep ? (
        // ── Step 2a: returning donor with a password ──────────────────
        <form
          action={passwordSignInAction}
          className="card card-pad"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            background: 'var(--paper)',
          }}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="email" value={prefillEmail} />
          <div className="small muted" style={{ lineHeight: 1.5 }}>
            {locale === 'fi' ? 'Kirjaudutaan sähköpostilla' : locale === 'sv' ? 'Loggar in som' : 'Signing in as'}{' '}
            <strong style={{ color: 'var(--ink)' }}>{prefillEmail}</strong>{' '}
            <a href={`/${locale}/sign-in`} style={{ marginLeft: 4 }}>
              {locale === 'fi' ? '(vaihda)' : locale === 'sv' ? '(byt)' : '(change)'}
            </a>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label">
              {locale === 'fi' ? 'Salasana' : locale === 'sv' ? 'Lösenord' : 'Password'}
            </span>
            <input
              type="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
              minLength={8}
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
          </label>
          <button type="submit" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 4 }}>
            {locale === 'fi' ? 'Kirjaudu sisään →' : locale === 'sv' ? 'Logga in →' : 'Sign in →'}
          </button>
          <p className="small muted" style={{ textAlign: 'center', lineHeight: 1.55 }}>
            <a href={`/${locale}/sign-in?reason=forgot&email=${encodeURIComponent(prefillEmail)}`}>
              {locale === 'fi' ? 'Unohditko salasanan?' : locale === 'sv' ? 'Glömt lösenord?' : 'Forgot your password?'}
            </a>
          </p>
        </form>
      ) : (
        // ── Step 1: email entry (lookup → password or send link) ──────
        <form
          action={lookupEmailAction}
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
              defaultValue={prefillEmail ?? ''}
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
            <span className="small muted">
              {locale === 'fi'
                ? 'Jos olet jo rekisteröitynyt, pyydämme salasanasi seuraavaksi. Muuten lähetämme sinulle vahvistuslinkin.'
                : locale === 'sv'
                  ? 'Om du redan har ett konto frågar vi efter ditt lösenord. Annars skickar vi en bekräftelselänk.'
                  : "If you already have an account, we'll ask for your password next. Otherwise we'll send you a verify link to set one."}
            </span>
          </label>
          <button type="submit" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 4 }}>
            {locale === 'fi' ? 'Jatka →' : locale === 'sv' ? 'Fortsätt →' : 'Continue →'}
          </button>
          <p className="small muted" style={{ marginTop: 4, lineHeight: 1.55, textAlign: 'center' }}>
            {t.privacyHint}{' '}
            <a href={`/${locale}/terms`}>{t.privacyTerms}</a> {t.and}{' '}
            <a href={`/${locale}/privacy`}>{t.privacyPrivacy}</a>
            {t.period}
          </p>
        </form>
      )}

      {ssoEnabled ? (
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
          <a
            href={`/${locale}/auth/oulu`}
            className="btn btn-secondary"
            style={{ marginTop: 14, display: 'inline-flex', gap: 8, alignItems: 'center' }}
          >
            🎓 {t.altCta}
          </a>
        </section>
      ) : (
        <section
          className="card card-pad"
          style={{
            marginTop: 24,
            background: 'var(--cream)',
            border: '1px dashed var(--line)',
          }}
          aria-labelledby="staff-h"
        >
          <h2 id="staff-h" className="serif" style={{ fontSize: 18, marginBottom: 6 }}>
            {t.altTitle}
          </h2>
          <p className="small" style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
            {locale === 'fi'
              ? 'Oulun yliopiston kirjautuminen on käytössä vain tuotantoympäristössä. Käytä yliopiston sähköpostilinkkiäsi yllä.'
              : locale === 'sv'
                ? 'Inloggning med Uleåborgs universitet är endast aktiverad i produktion. Använd din universitetspost ovan.'
                : 'University of Oulu sign-in is enabled only in the production environment. Use your university email above and the magic link will work the same way.'}
          </p>
        </section>
      )}
    </main>
  );
}
