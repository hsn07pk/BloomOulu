/**
 * Donor profile + GDPR controls. Reads /v1/me/profile, posts back through
 * server actions that bear the donor's session JWT.
 */
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '../../../../lib/session';
import { ProfileForm } from './form.client';

export const dynamic = 'force-dynamic';

interface Profile {
  id: string;
  email: string;
  name: string | null;
  locale: 'en' | 'fi' | 'sv';
  role: 'donor' | 'curator' | 'finance' | 'admin';
  homeRegion: string | null;
  preferences: { marketingOptIn?: boolean } | null;
  emailVerified: string | null;
  createdAt: string;
}

async function fetchProfile(token: string): Promise<Profile | null> {
  const apiUrl =
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/v1/me/profile`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export default async function MeProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session.user?.id) redirect(`/${locale}/sign-in?next=/${locale}/me/profile`);
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  const token = jar.get('bloomoulu.session')?.value ?? '';
  const profile = await fetchProfile(token);
  const t = await getTranslations({ locale, namespace: 'MeProfile' });
  if (!profile) {
    return (
      <main className="container" style={{ padding: '48px 32px' }}>
        <h1>{t('title')}</h1>
        <p className="muted">{t('saveError')}</p>
      </main>
    );
  }
  return (
    <article className="container fade-in" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 720 }}>
      <header style={{ marginBottom: 32 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          {t('eyebrow')}
        </div>
        <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 3.733rem)', marginTop: 12 }}>{t('title')}</h1>
        <p className="muted" style={{ marginTop: 12 }}>{t('lead')}</p>
      </header>
      <ProfileForm
        locale={locale as 'en' | 'fi' | 'sv'}
        profile={profile}
      />
    </article>
  );
}
