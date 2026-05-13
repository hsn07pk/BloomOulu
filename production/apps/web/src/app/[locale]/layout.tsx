import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LOCALES, type Locale } from '../../i18n';
import { A11yPanel } from '../../components/A11yPanel';
import { CookieBanner } from '../../components/CookieBanner';
import '../globals.css';

export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const COOKIE_TEXT = {
  en: {
    message:
      'BloomOulu uses essential cookies only (your sign-in session). No tracking, no analytics, no third parties.',
    acknowledge: 'Got it',
    moreInfo: 'Read the privacy policy',
  },
  fi: {
    message:
      'BloomOulu käyttää vain välttämättömiä evästeitä (kirjautumisistunto). Ei seurantaa, ei analytiikkaa, ei kolmansia osapuolia.',
    acknowledge: 'Selvä',
    moreInfo: 'Lue tietosuojaseloste',
  },
  sv: {
    message:
      'BloomOulu använder endast nödvändiga cookies (din inloggning). Ingen spårning, ingen analys, inga tredje parter.',
    acknowledge: 'Okej',
    moreInfo: 'Läs integritetspolicyn',
  },
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
  const t = await getTranslations({ locale, namespace: 'Footer' });
  const cookie = COOKIE_TEXT[locale as Locale];
  return (
    <html lang={locale}>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <main id="main">{children}</main>
          <footer
            style={{
              borderTop: '1px solid #DDE6CB',
              padding: '24px 16px',
              marginTop: 32,
              fontSize: 13,
              color: '#555',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              justifyContent: 'center',
            }}
          >
            <a href={`/${locale}/privacy`}>{t('privacy')}</a>
            <a href={`/${locale}/terms`}>{t('terms')}</a>
            <a href={`/${locale}/accessibility-statement`}>{t('accessibility')}</a>
            <span style={{ color: '#999' }}>© Oulun yliopiston kasvitieteellinen puutarha</span>
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
