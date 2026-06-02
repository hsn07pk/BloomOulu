import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getSession } from '../lib/session';
import CartBadge from './CartBadge.client';
import PrimaryNav from './PrimaryNav.client';
import { LangSwitcher } from './LangSwitcher.client';

/**
 * Shared site chrome — logo · primary nav · locale switcher · sign-in/account.
 *
 * Renders server-side so it's part of the initial HTML payload (good for
 * cold ISR + crawler text). The primary nav itself is split out into the
 * client PrimaryNav so it can highlight the active tab live from the URL.
 */
export async function Topbar({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Nav' });
  const tc = await getTranslations({ locale, namespace: 'Common' });
  const session = await getSession();
  const accountLabel = session.user?.name?.split(' ')[0] || session.user?.email?.split('@')[0];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href={`/${locale}`} className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brand-mark"
            src="/logo-mark.png"
            alt=""
            aria-hidden="true"
            width={34}
            height={34}
          />
          <span>{tc('appName')}</span>
        </Link>
        <PrimaryNav />
        <div className="topbar-right">
          <CartBadge locale={locale} />
          <LangSwitcher locale={locale} />
          {session.user ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <Link
                href={`/${locale}/garden`}
                className="account-pill"
                aria-label={`${t('garden')} · ${session.user.email}`}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  background: 'var(--forest-deep)',
                  color: 'var(--sage-bright)',
                  fontSize: 13,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'var(--sage-bright)',
                    color: 'var(--forest-deep)',
                    fontFamily: 'var(--f-display)',
                    fontWeight: 600,
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {(accountLabel ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="account-name">{accountLabel}</span>
              </Link>
              <a
                href={`/${locale}/auth/sign-out`}
                aria-label={locale === 'fi' ? 'Kirjaudu ulos' : locale === 'sv' ? 'Logga ut' : 'Sign out'}
                title={locale === 'fi' ? 'Kirjaudu ulos' : locale === 'sv' ? 'Logga ut' : 'Sign out'}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  textDecoration: 'none',
                  color: 'var(--ink-mute)',
                  border: '1px solid var(--line)',
                }}
              >
                ↗
              </a>
            </span>
          ) : (
            <Link
              href={`/${locale}/sign-in`}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 13,
                marginLeft: 8,
                textDecoration: 'none',
                color: 'var(--forest-deep)',
                border: '1px solid var(--line)',
              }}
            >
              {t('signIn')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
