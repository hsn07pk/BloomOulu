import createMiddleware from 'next-intl/middleware';
import { LOCALES } from './i18n';

export default createMiddleware({
  locales: LOCALES,
  defaultLocale: 'fi',
  localePrefix: 'always',
  localeDetection: true,
});

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
