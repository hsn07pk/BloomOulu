// Server-safe relative time for the Instagram band. Inline locale strings
// (no next-intl hook) so it works in a server component.
type Locale = 'en' | 'fi' | 'sv';

const STR: Record<Locale, { now: string; d: (n: number) => string; w: (n: number) => string; mo: (n: number) => string; y: (n: number) => string; hr: (n: number) => string }> = {
  en: { now: 'just now', hr: (n) => `${n}h ago`, d: (n) => `${n}d ago`, w: (n) => `${n}w ago`, mo: (n) => `${n}mo ago`, y: (n) => `${n}y ago` },
  fi: { now: 'juuri nyt', hr: (n) => `${n} t sitten`, d: (n) => `${n} pv sitten`, w: (n) => `${n} vk sitten`, mo: (n) => `${n} kk sitten`, y: (n) => `${n} v sitten` },
  sv: { now: 'nyss', hr: (n) => `${n} h sedan`, d: (n) => `${n} d sedan`, w: (n) => `${n} v sedan`, mo: (n) => `${n} mån sedan`, y: (n) => `${n} år sedan` },
};

export function relativeTime(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const s = STR[(['en', 'fi', 'sv'].includes(locale) ? locale : 'en') as Locale];
  const hr = ms / 3.6e6, day = hr / 24, wk = day / 7, mo = day / 30.44, yr = day / 365.25;
  if (hr < 1) return s.now;
  if (hr < 24) return s.hr(Math.round(hr));
  if (day < 7) return s.d(Math.round(day));
  if (wk < 5) return s.w(Math.round(wk));
  if (mo < 12) return s.mo(Math.round(mo));
  return s.y(Math.round(yr));
}
