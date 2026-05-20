/**
 * /[locale]/auth/reset — landing page for the password-reset link.
 *
 * The donor arrives here from the "Reset your password" email. We:
 *   1. Validate the email/token query params are present.
 *   2. Render a form that takes the new password.
 *   3. Submit posts to /v1/auth/reset-password, mints a session JWT,
 *      writes the bloomoulu.session cookie, and redirects to /garden.
 *
 * Server component — the action runs server-side; the merchant secret
 * stays out of the browser.
 */
import { redirect } from 'next/navigation';
import { resetPasswordAction } from './actions';

export const dynamic = 'force-dynamic';

const COPY = {
  en: {
    eyebrow: 'Reset password',
    title: 'Set a new password',
    lead: 'Pick something memorable but not reused on other sites. We require at least 8 characters.',
    label: 'New password',
    hint: 'Minimum 8 characters. A passphrase like "blue garden hare" is easier to remember than random characters.',
    cta: 'Save & sign in →',
    backToSignIn: 'Sign in with a different email',
  },
  fi: {
    eyebrow: 'Salasanan vaihto',
    title: 'Aseta uusi salasana',
    lead: 'Valitse jotain helposti muistettavaa, mutta älä käytä samaa muilla sivustoilla. Vähintään 8 merkkiä.',
    label: 'Uusi salasana',
    hint: 'Vähintään 8 merkkiä. Lause kuten "sininen puutarha jänis" on helpompi muistaa kuin satunnaiset merkit.',
    cta: 'Tallenna ja kirjaudu sisään →',
    backToSignIn: 'Kirjaudu eri sähköpostilla',
  },
  sv: {
    eyebrow: 'Återställ lösenord',
    title: 'Sätt ett nytt lösenord',
    lead: 'Välj något du minns men inte återanvänder på andra sidor. Minst 8 tecken krävs.',
    label: 'Nytt lösenord',
    hint: 'Minst 8 tecken. En lösenfras som "blå trädgård hare" är lättare att minnas än slumpmässiga tecken.',
    cta: 'Spara och logga in →',
    backToSignIn: 'Logga in med ett annat mejl',
  },
} as const;

export default async function ResetPage({
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
          {t.eyebrow}
        </div>
        <h1 style={{ fontSize: 'clamp(36px, 5vw, 48px)', marginTop: 12, lineHeight: 1.1 }}>
          {t.title}
        </h1>
        <p className="muted" style={{ marginTop: 12, fontSize: 16, lineHeight: 1.55 }}>
          {t.lead}
        </p>
      </header>

      <form
        action={resetPasswordAction}
        className="card card-pad"
        style={{ display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--paper)' }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />
        <div className="small muted">
          {locale === 'fi' ? 'Vaihdetaan salasana tilille' : locale === 'sv' ? 'Återställer lösenord för konto' : 'Resetting password for'}{' '}
          <strong style={{ color: 'var(--ink)' }}>{email}</strong>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label">{t.label}</span>
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
          <span className="small muted">{t.hint}</span>
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
