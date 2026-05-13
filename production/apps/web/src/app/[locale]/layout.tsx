import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LOCALES, type Locale } from '../../i18n';
import { A11yPanel } from '../../components/A11yPanel';
import '../globals.css';

export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

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
  return (
    <html lang={locale}>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <main id="main">{children}</main>
          <A11yPanel />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
