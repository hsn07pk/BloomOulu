/**
 * Staff dashboard. Visible only to curator/finance/admin. Each tile
 * deep-links into the AdminJS section the caller's role can act on
 * (ADR-0007 matrix).
 */
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = new Set(['curator', 'finance', 'admin']);

interface Tile {
  key: string;
  href: string;
  rolesAllowed: Array<'curator' | 'finance' | 'admin'>;
}

const TILES: Tile[] = [
  { key: 'Catalogue', href: '/admin/resources/Plant', rolesAllowed: ['curator', 'admin'] },
  { key: 'Rag', href: '/admin/resources/RagDocument', rolesAllowed: ['curator', 'admin'] },
  { key: 'Finance', href: '/admin/resources/Payment', rolesAllowed: ['finance', 'admin'] },
  { key: 'Adoptions', href: '/admin/resources/Adoption', rolesAllowed: ['finance', 'admin'] },
  { key: 'Users', href: '/admin/resources/User', rolesAllowed: ['admin'] },
  { key: 'Settings', href: '/admin/resources/SystemSetting', rolesAllowed: ['admin'] },
  { key: 'Audit', href: '/admin/resources/AuditLog', rolesAllowed: ['finance', 'admin'] },
];

export default async function StaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session.user) redirect(`/${locale}/sign-in?next=/${locale}/staff`);
  if (!STAFF_ROLES.has(session.user.role)) {
    return (
      <main className="container" style={{ paddingTop: 64, paddingBottom: 64, maxWidth: 640 }}>
        <h1 className="serif" style={{ fontSize: '2rem' }}>403</h1>
        <p className="muted" style={{ marginTop: 12 }}>
          {locale === 'fi'
            ? 'Tämä sivu on puutarhan henkilökunnalle.'
            : locale === 'sv'
              ? 'Denna sida är för trädgårdspersonal.'
              : 'This page is for Garden staff.'}
        </p>
      </main>
    );
  }

  const t = await getTranslations({ locale, namespace: 'Staff' });
  const role = session.user.role as 'curator' | 'finance' | 'admin';
  const visibleTiles = TILES.filter((tile) => tile.rolesAllowed.includes(role));

  const roleLabel =
    role === 'curator'
      ? locale === 'fi' ? 'Kuraattori' : locale === 'sv' ? 'Kurator' : 'Curator'
      : role === 'finance'
        ? locale === 'fi' ? 'Talous' : locale === 'sv' ? 'Ekonomi' : 'Finance'
        : locale === 'fi' ? 'Ylläpitäjä' : locale === 'sv' ? 'Administratör' : 'Admin';

  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:4100';

  return (
    <article className="container fade-in" style={{ paddingTop: 48, paddingBottom: 80 }}>
      <header style={{ marginBottom: 32 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          {t('eyebrow')} · {roleLabel}
        </div>
        <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 3.733rem)', marginTop: 12 }}>{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8 }}>{t('lead')}</p>
        <div
          style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'var(--sage-pale)',
            borderRadius: 10,
            display: 'inline-block',
            fontSize: '0.867rem',
          }}
        >
          {t('yourRole')}: <strong>{session.user.email}</strong> ({roleLabel})
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {visibleTiles.map((tile) => (
          <a
            key={tile.key}
            href={`${adminUrl}${tile.href}`}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-pad"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              border: '1px solid var(--line)',
              minHeight: 160,
            }}
          >
            <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
              {t(`card${tile.key}Title` as 'cardCatalogueTitle')}
            </div>
            <h2
              className="serif"
              style={{ fontSize: '1.467rem', marginTop: 0, color: 'var(--forest-deep)' }}
            >
              {t(`card${tile.key}Title` as 'cardCatalogueTitle')}
            </h2>
            <p className="small muted" style={{ flex: 1 }}>
              {t(`card${tile.key}Desc` as 'cardCatalogueDesc')}
            </p>
            <span
              className="small"
              style={{ color: 'var(--forest)', marginTop: 'auto', fontWeight: 500 }}
            >
              {t(`card${tile.key}Cta` as 'cardCatalogueCta')} →
            </span>
          </a>
        ))}
      </div>
    </article>
  );
}
