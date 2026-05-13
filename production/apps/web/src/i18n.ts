import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

export const LOCALES = ['en', 'fi', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];

export default getRequestConfig(async ({ locale }) => {
  if (!LOCALES.includes(locale as Locale)) notFound();
  return {
    messages: (await import(`@bloomoulu/i18n/messages/${locale}.json`)).default,
    timeZone: 'Europe/Helsinki',
  };
});
