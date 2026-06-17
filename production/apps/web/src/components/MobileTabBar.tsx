'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { NAV_ITEMS, isActiveSeg } from './nav-shared';

/**
 * Bottom tab bar — the mobile counterpart to the desktop Topbar nav, which is
 * hidden below 768px (globals.css `.nav { display:none }`). Before this, phones
 * had NO way to reach Adopt / Ask / My Garden from the chrome. CSS-hidden on
 * desktop (`.mobile-tabs` in globals.css); the mobile `body` already reserves
 * 64px bottom padding for it. Shares NAV_ITEMS + isActiveSeg with the desktop
 * PrimaryNav so each destination uses the same minimal line icon.
 *
 * a11y (repo gates on jsx-a11y + axe + WCAG 2.2 AA): real <Link>s with a
 * visible text label + `aria-current="page"` on the active tab; ≥44px targets.
 */
export function MobileTabBar(): JSX.Element {
  const t = useTranslations('Nav');
  const locale = useLocale();
  const pathname = usePathname() ?? `/${locale}`;

  return (
    <nav className="mobile-tabs" aria-label="primary">
      {NAV_ITEMS.filter((item) => item.inMobile !== false).map(({ key, seg, Icon, shortKey }) => (
        <Link
          key={key}
          href={`/${locale}${seg}`}
          aria-current={isActiveSeg(pathname, seg) ? 'page' : undefined}
          aria-label={shortKey ? t(key) : undefined}
        >
          <span className="mobile-tab-ico" aria-hidden="true">
            <Icon />
          </span>
          {t(shortKey ?? key)}
        </Link>
      ))}
    </nav>
  );
}
