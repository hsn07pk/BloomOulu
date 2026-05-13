export const LOCALES = ['en', 'fi', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];
