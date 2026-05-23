/**
 * /[locale]/auth/verify — landing page for the email verify link.
 *
 * The api's magic-link endpoint emails a URL pointing here. We:
 *   1. Check whether the email already has a password set (via
 *      /v1/auth/lookup).
 *   2. If yes → finalise via the legacy route.ts handler (magic-link
 *      sign-in) by redirecting to the same URL with ?finalize=1.
 *   3. If no → show a "Welcome! Set your password and name" form,
 *      which posts to verifyAndSetupAction, mints the session, and
 *      lands the user in their Garden page.
 *
 * Server component — the form action runs server-side and writes the
 * session cookie before redirecting.
 */
import { redirect } from 'next/navigation';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { verifyAndSetupAction } from './setup-actions';

function apiUrl(): string {
  return getInternalApiUrl();
}

const COPY = {
  en: {
    title: 'Welcome to BloomOulu',
    lead: "Last step: set a password so you can sign in next time without waiting for an email.",
    nameLabel: 'Your name',
    namePlaceholder: 'Anna Aalto',
    nameHint: 'How we should greet you on the site. You can change it later.',
    pwLabel: 'Password',
    pwHint: 'At least 8 characters. A passphrase is easier to remember than random characters.',
    cta: 'Create my account →',
    backToSignIn: 'Sign in with a different email',
  },
  fi: {
    title: 'Tervetuloa BloomOuluun',
    lead: 'Viimeinen vaihe: aseta salasana, jotta voit kirjautua sisään ilman sähköpostia ensi kerralla.',
    nameLabel: 'Nimesi',
    namePlaceholder: 'Anna Aalto',
    nameHint: 'Miten tervehdimme sinua. Voit muuttaa tämän myöhemmin.',
    pwLabel: 'Salasana',
    pwHint: 'Vähintään 8 merkkiä. Pitkä lause on helpompi muistaa kuin satunnaiset merkit.',
    cta: 'Luo tili →',
    backToSignIn: 'Kirjaudu eri sähköpostilla',
  },
  sv: {
    title: 'Välkommen till BloomOulu',
    lead: 'Sista steget: sätt ett lösenord så att du kan logga in nästa gång utan att vänta på ett mejl.',
    nameLabel: 'Ditt namn',
    namePlaceholder: 'Anna Aalto',
    nameHint: 'Hur vi tilltalar dig på sidan. Du kan ändra detta senare.',
    pwLabel: 'Lösenord',
    pwHint: 'Minst 8 tecken. En lösenfras är lättare att komma ihåg än slumpmässiga tecken.',
    cta: 'Skapa konto →',
    backToSignIn: 'Logga in med ett annat mejl',
  },
} as const;

export const dynamic = 'force-dynamic';

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { locale } = await params;
  const { email, token } = await searchParams;
  const t = COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : 'en'];

  if (!email || !token) {
    redirect(`/${locale}/sign-in?reason=invalid`);
  }

  // Returning donor with a password? Skip the setup form and consume
  // the token directly — magic-link sign-in lands them in /garden.
  let hasPassword = false;
  try {
    const res = await fetch(`${apiUrl()}/v1/auth/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
    if (res.ok) {
      const j = (await res.json()) as { hasPassword: boolean };
      hasPassword = j.hasPassword;
    }
  } catch {/* fall through to form */}

  if (hasPassword) {
    redirect(`/${locale}/auth/verify/finalize?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
  }

  return (
    <main
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: 'clamp(32px, 6vw, 80px) 24px',
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          {locale === 'fi' ? 'Rekisteröityminen' : locale === 'sv' ? 'Registrering' : 'Sign up'}
        </div>
        <h1 style={{ fontSize: 'clamp(36px, 5vw, 48px)', marginTop: 12, lineHeight: 1.1 }}>
          {t.title}
        </h1>
        <p className="muted" style={{ marginTop: 12, fontSize: 16, lineHeight: 1.55 }}>
          {t.lead}
        </p>
      </header>

      <form
        action={verifyAndSetupAction}
        className="card card-pad"
        style={{ display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--paper)' }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />
        <div className="small muted">
          {locale === 'fi' ? 'Sähköposti vahvistettu' : locale === 'sv' ? 'E-post bekräftad' : 'Verifying'}{' '}
          <strong style={{ color: 'var(--ink)' }}>{email}</strong> ✓
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label">{t.nameLabel}</span>
          <input
            type="text"
            name="name"
            required
            minLength={1}
            maxLength={120}
            autoComplete="name"
            placeholder={t.namePlaceholder}
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
          <span className="small muted">{t.nameHint}</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label">{t.pwLabel}</span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="new-password"
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
          <span className="small muted">{t.pwHint}</span>
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 4 }}>
          {t.cta}
        </button>
        <p className="small muted" style={{ marginTop: 4, lineHeight: 1.55, textAlign: 'center' }}>
          <a href={`/${locale}/sign-in`}>{t.backToSignIn}</a>
        </p>
      </form>
    </main>
  );
}
