import { z } from 'zod';

/**
 * Supported UI locales — must match the `Locale` Prisma enum and the message
 * catalogs under packages/i18n/messages.
 */
export const LOCALES = ['en', 'fi', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];

export const LocaleEnum = z.enum(LOCALES);

/** Default UI locale on first paint and for un-localised donors. */
export const DEFAULT_LOCALE: Locale = 'fi';

/** Pick the first valid locale from a list, falling back to DEFAULT_LOCALE. */
export function pickLocale(...candidates: Array<string | undefined | null>): Locale {
  for (const c of candidates) {
    if (c && (LOCALES as readonly string[]).includes(c)) return c as Locale;
  }
  return DEFAULT_LOCALE;
}
