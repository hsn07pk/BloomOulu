'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { NAV_ITEMS, isActiveSeg } from './nav-shared';

/**
 * Desktop primary nav (the `.nav` row inside the Topbar). Split out of the
 * server-rendered Topbar as a client component so it can highlight the active
 * tab live from the URL via usePathname(): the Topbar is rendered once in the
 * layout and never knew the current route, so its old `active` prop was always
 * unset and the `.nav a.active` pill never appeared. Shares NAV_ITEMS +
 * isActiveSeg with the mobile MobileTabBar so both stay in lockstep.
 */
export default function PrimaryNav(): JSX.Element {
  const t = useTranslations('Nav');
  const locale = useLocale();
  const pathname = usePathname() ?? `/${locale}`;

  return (
    <nav className="nav" aria-label="primary">
      {NAV_ITEMS.filter((item) => item.inTopbar).map(({ key, seg, Icon }) => {
        const active = isActiveSeg(pathname, seg);
        return (
          <Link
            key={key}
            href={`/${locale}${seg}`}
            className={active ? 'active' : ''}
            aria-current={active ? 'page' : undefined}
          >
            <Icon />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
