'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Bottom tab bar — the mobile counterpart to the desktop Topbar nav, which is
 * hidden below 768px (globals.css `.nav { display:none }`). Before this, phones
 * had NO way to reach Adopt / Ask / My Garden from the chrome. CSS-hidden on
 * desktop (`.mobile-tabs` in globals.css); the mobile `body` already reserves
 * 64px bottom padding for it.
 *
 * a11y (repo gates on jsx-a11y + axe + WCAG 2.2 AA): real <Link>s with a
 * visible text label + `aria-current="page"` on the active tab; ≥44px targets.
 */
const TABS = [
  { key: 'home', icon: '🏡', seg: '' },
  { key: 'plants', icon: '🌿', seg: '/plants' },
  { key: 'adopt', icon: '🌸', seg: '/adopt' },
  { key: 'ask', icon: '💬', seg: '/ask' },
  { key: 'garden', icon: '🪴', seg: '/garden' },
] as const;

export function MobileTabBar(): JSX.Element {
  const t = useTranslations('Nav');
  const locale = useLocale();
  const pathname = usePathname() ?? `/${locale}`;
  // Strip the locale prefix so matching is locale-agnostic.
  const rest = pathname.replace(/^\/(en|fi|sv)(?=\/|$)/, '') || '/';

  const isActive = (seg: string): boolean => {
    if (seg === '') return rest === '/';
    if (rest === seg || rest.startsWith(seg + '/')) return true;
    // My Garden also owns the /me/* account routes.
    if (seg === '/garden' && (rest === '/me' || rest.startsWith('/me/'))) return true;
    return false;
  };

  return (
    <nav className="mobile-tabs" aria-label="primary">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/${locale}${tab.seg}`}
          aria-current={isActive(tab.seg) ? 'page' : undefined}
        >
          <span className="mobile-tab-ico" aria-hidden="true">
            {tab.icon}
          </span>
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
