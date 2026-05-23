import { getRequestConfig } from 'next-intl/server';
import { getInternalApiUrl } from '@bloomoulu/constants';
import en from '@bloomoulu/i18n/messages/en.json';
import fi from '@bloomoulu/i18n/messages/fi.json';
import sv from '@bloomoulu/i18n/messages/sv.json';

export const LOCALES = ['en', 'fi', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];

const BUNDLED: Record<Locale, unknown> = { en, fi, sv };

type NestedRecord = { [key: string]: string | NestedRecord };

/** Deep-merge override into base. Strings in override win; nested objects
 *  are recursed; types that change are replaced wholesale. */
function deepMerge(
  base: NestedRecord,
  override: NestedRecord | null | undefined,
): NestedRecord {
  if (!override) return base;
  const out: NestedRecord = { ...base };
  for (const [key, val] of Object.entries(override)) {
    const cur = out[key];
    if (
      val != null &&
      typeof val === 'object' &&
      cur != null &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      out[key] = deepMerge(cur as NestedRecord, val as NestedRecord);
    } else {
      out[key] = val as string | NestedRecord;
    }
  }
  return out;
}

/** Fetch the DB-stored Translation rows merged into a next-intl-shaped
 *  nested object. Failures (api unreachable, empty result) fall through
 *  silently — the bundled JSON is always a safe baseline. */
async function fetchOverrides(locale: Locale): Promise<NestedRecord | null> {
  try {
    const res = await fetch(`${getInternalApiUrl()}/v1/translations/${locale}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as NestedRecord;
  } catch {
    return null;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = LOCALES.includes(requested as Locale)
    ? (requested as Locale)
    : 'fi';
  const overrides = await fetchOverrides(locale);
  const messages = deepMerge(BUNDLED[locale] as NestedRecord, overrides);
  return {
    locale,
    messages: messages as Record<string, string>,
    timeZone: 'Europe/Helsinki',
  };
});
