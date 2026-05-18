/**
 * AskTheGarden — RAG chat UI shell.
 *
 * Server-component shell; the chat itself streams via /v1/ask/stream from
 * AskChat (client component).
 */
import { getTranslations } from 'next-intl/server';
import AskChat from './chat.client';
import { getSession, isStaff } from '../../../lib/session';

export const dynamic = 'force-dynamic';

async function loadStarters(locale: string): Promise<string[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/v1/ask/starters`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const all = (await res.json()) as Array<{ text: string; locale: string }>;
    // Prefer the donor's locale; fall back to whatever else came back.
    const sameLocale = all.filter((s) => s.locale === locale).map((s) => s.text);
    if (sameLocale.length >= 3) return sameLocale.slice(0, 5);
    return [...sameLocale, ...all.filter((s) => s.locale !== locale).map((s) => s.text)].slice(0, 5);
  } catch {
    return [];
  }
}

export default async function AskPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Ask' });
  const starters = await loadStarters(locale);
  const session = await getSession();
  const userName = session.user?.name?.split(' ')[0] || session.user?.email?.split('@')[0] || '';
  const staffEligible = isStaff(session.user?.role);
  const signedIn = session.user !== null;
  const greeting = signedIn ? t('greetSignedIn', { name: userName }) : t('greetAnon');
  const intro = signedIn ? t('introSignedIn') : t('introAnon');

  return (
    <article className="container fade-in" style={{ paddingTop: 32 }}>
      <header style={{ marginBottom: 8 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          AskTheGarden
        </div>
        <h1 style={{ fontSize: 'clamp(36px, 5vw, 56px)', marginTop: 12 }}>{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 16, maxWidth: 620 }}>{t('subtitle')}</p>
        <div
          style={{
            marginTop: 16,
            padding: '14px 18px',
            background: signedIn ? 'var(--sage-pale)' : 'rgba(31,58,44,0.04)',
            borderRadius: 14,
            border: '1px solid var(--line)',
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 22 }}>🌿</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="serif" style={{ fontSize: 18, color: 'var(--forest-deep)' }}>{greeting}</div>
            <div className="small" style={{ color: 'var(--ink-soft)', marginTop: 2 }}>{intro}</div>
          </div>
          {!signedIn && (
            <a href={`/${locale}/sign-in`} className="btn btn-secondary small">
              {t('signInToSave')} →
            </a>
          )}
        </div>
      </header>
      <AskChat
        locale={locale as 'en' | 'fi' | 'sv'}
        starters={starters}
        signedIn={signedIn}
        staffEligible={staffEligible}
        userId={session.user?.id ?? null}
      />
    </article>
  );
}
