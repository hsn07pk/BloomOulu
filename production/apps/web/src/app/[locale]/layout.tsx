import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LOCALES, type Locale } from '../../i18n.js';
import { A11yPanel } from '../../components/A11yPanel.js';
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
  params: { locale: string };
}) {
  if (!LOCALES.includes(params.locale as Locale)) notFound();
  const messages = await getMessages();
  return (
    <html lang={params.locale}>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <NextIntlClientProvider locale={params.locale} messages={messages}>
          <main id="main">{children}</main>
          <A11yPanel />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
