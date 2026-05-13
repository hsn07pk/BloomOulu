import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';
import en from '@bloomoulu/i18n/messages/en.json';
import fi from '@bloomoulu/i18n/messages/fi.json';
import sv from '@bloomoulu/i18n/messages/sv.json';

export const LOCALES = ['en', 'fi', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];

const MESSAGES: Record<Locale, unknown> = { en, fi, sv };

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = LOCALES.includes(requested as Locale)
    ? (requested as Locale)
    : 'fi';
  return {
    locale,
    messages: MESSAGES[locale] as Record<string, string>,
    timeZone: 'Europe/Helsinki',
  };
});
