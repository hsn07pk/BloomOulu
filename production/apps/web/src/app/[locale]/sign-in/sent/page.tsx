import Link from 'next/link';
import { supportEmail } from '../../../../lib/contact';

const COPY = {
  en: {
    eyebrow: 'Sign in',
    title: 'Check your inbox.',
    lead: "If we have an account for that address you'll receive a sign-in link within a minute. The link expires in 15 minutes — open it on this device to sign in.",
    didnt: "Didn't get an email?",
    didntBody: "Check spam, then try requesting again. If it still doesn't arrive, contact {email}.",
    back: '← Back to sign in',
  },
  fi: {
    eyebrow: 'Kirjautuminen',
    title: 'Tarkista sähköpostisi.',
    lead: 'Jos meillä on tili kyseiselle osoitteelle, saat kirjautumislinkin minuutin sisällä. Linkki vanhenee 15 minuutissa — avaa se tällä laitteella.',
    didnt: 'Etkö saanut sähköpostia?',
    didntBody: 'Tarkista roskaposti ja pyydä tarvittaessa uusi linkki. Jos viesti ei tule, ota yhteys {email}.',
    back: '← Takaisin kirjautumiseen',
  },
  sv: {
    eyebrow: 'Logga in',
    title: 'Kolla din inkorg.',
    lead: 'Om vi har ett konto för den adressen får du en inloggningslänk inom en minut. Länken går ut om 15 minuter — öppna den på den här enheten.',
    didnt: 'Inget mejl?',
    didntBody: 'Kolla skräpposten och be om en ny länk. Hör annars av dig till {email}.',
    back: '← Tillbaka till inloggning',
  },
} as const;

export default async function SentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : 'en'];
  return (
    <main
      style={{ maxWidth: 520, margin: '0 auto', padding: 'clamp(32px, 6vw, 80px) 24px' }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--sage-pale)',
          color: 'var(--forest)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          marginBottom: 24,
        }}
        aria-hidden="true"
      >
        ✉
      </div>
      <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
        {t.eyebrow}
      </div>
      <h1 style={{ fontSize: 'clamp(36px, 5vw, 48px)', marginTop: 12, lineHeight: 1.1 }}>
        {t.title}
      </h1>
      <p className="muted" style={{ marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
        {t.lead}
      </p>

      <div className="card card-pad" style={{ marginTop: 32, background: 'var(--cream-deep)' }} role="note">
        <h2 className="serif" style={{ fontSize: 18, marginBottom: 6 }}>
          {t.didnt}
        </h2>
        <p className="small" style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
          {t.didntBody.replace('{email}', supportEmail())}
        </p>
      </div>

      <p style={{ marginTop: 32 }}>
        <Link href={`/${locale}/sign-in`} className="btn btn-secondary">
          {t.back}
        </Link>
      </p>
    </main>
  );
}
