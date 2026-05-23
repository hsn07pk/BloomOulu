import type { Metadata, Viewport } from 'next';
import { getBrowserApiUrl } from '@bloomoulu/constants';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LOCALES, type Locale } from '../../i18n';
import { A11yPanel } from '../../components/A11yPanel';
import { CookieBanner } from '../../components/CookieBanner';
import { Topbar } from '../../components/Topbar';
import LiveSync from '../../components/LiveSync.client';
import '../globals.css';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  themeColor: '#1F3C2D',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const tc = await getTranslations({ locale, namespace: 'Common' });
  const th = await getTranslations({ locale, namespace: 'Home' });
  const appName = tc('appName');
  const siteName = tc('siteName');
  return {
    title: {
      default: `${appName} · ${siteName}`,
      template: `%s · ${appName}`,
    },
    description: th('heroLead'),
    applicationName: appName,
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
        { url: '/favicon-16.png', type: 'image/png', sizes: '16x16' },
      ],
      apple: [{ url: '/apple-icon.png', sizes: '180x180' }],
    },
  };
}

export async function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const COOKIE_TEXT = {
  en: { message: 'BloomOulu uses essential cookies only (your sign-in session). No tracking, no analytics, no third parties.', acknowledge: 'Got it', moreInfo: 'Read the privacy policy' },
  fi: { message: 'BloomOulu käyttää vain välttämättömiä evästeitä (kirjautumisistunto). Ei seurantaa, ei analytiikkaa, ei kolmansia osapuolia.', acknowledge: 'Selvä', moreInfo: 'Lue tietosuojaseloste' },
  sv: { message: 'BloomOulu använder endast nödvändiga cookies (din inloggning). Ingen spårning, ingen analys, inga tredje parter.', acknowledge: 'Okej', moreInfo: 'Läs integritetspolicyn' },
} as const;

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  const messages = await getMessages();
  const tFooter = await getTranslations({ locale, namespace: 'Footer' });
  const cookie = COOKIE_TEXT[locale as Locale];
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..800,0..100;1,9..144,300..800,0..100&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        <meta name="theme-color" content="#1F3C2D" />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Browser-side real-time invalidation. Opens one SSE
              connection to /v1/events and triggers router.refresh()
              on any admin-side write so every open tab stays current
              without a hard reload. */}
          <LiveSync apiUrl={getBrowserApiUrl()} />
          <Topbar locale={locale} />
          <main id="main">{children}</main>
          <footer
            style={{
              borderTop: '1px solid var(--line)',
              marginTop: 64,
              padding: '32px 16px',
              fontSize: 13,
              color: 'var(--ink-mute)',
              background: 'var(--paper)',
            }}
          >
            <div
              style={{
                maxWidth: 1320,
                margin: '0 auto',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 24,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>© {new Date().getFullYear()} Oulun yliopiston kasvitieteellinen puutarha</span>
              <nav aria-label="legal" style={{ display: 'flex', gap: 16 }}>
                <a href={`/${locale}/privacy`}>{tFooter('privacy')}</a>
                <a href={`/${locale}/terms`}>{tFooter('terms')}</a>
                <a href={`/${locale}/accessibility-statement`}>{tFooter('accessibility')}</a>
              </nav>
            </div>
          </footer>
          <A11yPanel />
          <CookieBanner
            message={cookie.message}
            acknowledge={cookie.acknowledge}
            moreInfo={cookie.moreInfo}
            moreInfoHref={`/${locale}/privacy`}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
