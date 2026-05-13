import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * Shared site chrome — logo · primary nav · locale switcher · sign-in.
 *
 * Renders server-side so it's part of the initial HTML payload (good for
 * cold ISR + crawler text). Active-state styling lives in CSS classes
 * driven by `active` prop.
 */
export async function Topbar({
  locale,
  active,
}: {
  locale: string;
  active?: 'home' | 'plants' | 'adopt' | 'ask' | 'garden';
}) {
  const t = await getTranslations({ locale, namespace: 'Nav' });
  const tc = await getTranslations({ locale, namespace: 'Common' });

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href={`/${locale}`} className="brand">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>{tc('appName')}</span>
        </Link>
        <nav className="nav" aria-label="primary">
          <Link href={`/${locale}`} className={active === 'home' ? 'active' : ''}>
            {t('home')}
          </Link>
          <Link href={`/${locale}/adopt`} className={active === 'adopt' ? 'active' : ''}>
            {t('adopt')}
          </Link>
          <Link href={`/${locale}/ask`} className={active === 'ask' ? 'active' : ''}>
            {t('ask')}
          </Link>
          <Link href={`/${locale}/garden`} className={active === 'garden' ? 'active' : ''}>
            {t('garden')}
          </Link>
        </nav>
        <div className="topbar-right">
          <div className="lang-pill" role="group" aria-label="Language">
            <Link href={`/en`} className={locale === 'en' ? 'active' : ''} hrefLang="en" aria-label="English">EN</Link>
            <Link href={`/fi`} className={locale === 'fi' ? 'active' : ''} hrefLang="fi" aria-label="Suomi">FI</Link>
            <Link href={`/sv`} className={locale === 'sv' ? 'active' : ''} hrefLang="sv" aria-label="Svenska">SV</Link>
          </div>
        </div>
      </div>
    </header>
  );
}
