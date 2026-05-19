/**
 * AskTheGarden — RAG chat UI shell.
 *
 * Server-component shell; the chat itself streams via /v1/ask/stream from
 * AskChat (client component).
 */
import { getTranslations } from 'next-intl/server';
import AskChat, { type AskSettings, type CorpusStats, type AuditMetric } from './chat.client';
import { getSession, isStaff } from '../../../lib/session';

export const dynamic = 'force-dynamic';

function internalApiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:4000'
  );
}

async function loadStarters(locale: string): Promise<string[]> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/ask/starters`, { cache: 'no-store' });
    if (!res.ok) return [];
    const all = (await res.json()) as Array<{ text: string; locale: string }>;
    const sameLocale = all.filter((s) => s.locale === locale).map((s) => s.text);
    if (sameLocale.length >= 3) return sameLocale.slice(0, 5);
    return [...sameLocale, ...all.filter((s) => s.locale !== locale).map((s) => s.text)].slice(0, 5);
  } catch {
    return [];
  }
}

async function loadStaffStarters(locale: string): Promise<string[]> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/ask/staff-starters?locale=${locale}`, {
      cache: 'no-store',
    });
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

async function loadCorpusStats(): Promise<CorpusStats | null> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/ask/corpus-stats`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

async function loadAuditMetric(): Promise<AuditMetric | null> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/ask/audit-metric?window=200`, {
      cache: 'no-store',
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

async function loadPublicSettings(): Promise<{ ask?: AskSettings } | null> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/settings/public`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

const DEFAULT_ASK_SETTINGS: AskSettings = {
  curatorEmail: 'curator@bloomoulu.fi',
  curatorName: 'Anna Liisa Ruotsalainen',
  curatorReplySlaDays: 2,
  confidenceThresholdBp: 7200,
  auditErrorTarget: 0.05,
  outOfDomain: {
    bgci: 'https://tools.bgci.org/plant_search.php',
    gbif: 'https://www.gbif.org/species/search',
    plantnet: 'https://identify.plantnet.org/',
  },
};

export default async function AskPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Ask' });
  const session = await getSession();
  const userName = session.user?.name?.split(' ')[0] || session.user?.email?.split('@')[0] || '';
  const staffEligible = isStaff(session.user?.role);
  const signedIn = session.user !== null;
  const greeting = signedIn ? t('greetSignedIn', { name: userName }) : t('greetAnon');
  const intro = signedIn ? t('introSignedIn') : t('introAnon');

  const [starters, staffStarters, corpusStats, auditMetric, publicSettings] = await Promise.all([
    loadStarters(locale),
    staffEligible ? loadStaffStarters(locale) : Promise.resolve([] as string[]),
    loadCorpusStats(),
    loadAuditMetric(),
    loadPublicSettings(),
  ]);

  const ask = { ...DEFAULT_ASK_SETTINGS, ...(publicSettings?.ask ?? {}) };

  return (
    <article className="container fade-in" style={{ paddingTop: 32 }}>
      <header style={{ marginBottom: 8 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          AskTheGarden
        </div>
        <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 3.733rem)', marginTop: 12 }}>{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: '1.067rem', maxWidth: 620 }}>{t('subtitle')}</p>
        <div
          style={{
            marginTop: 16,
            padding: '14px 18px',
            background: signedIn ? 'var(--sage-pale)' : 'rgba(31,58,44,0.04)',
            borderRadius: 14,
            border: '1px solid var(--line)',
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '1.467rem' }}>🌿</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="serif" style={{ fontSize: '1.2rem', color: 'var(--forest-deep)' }}>{greeting}</div>
            <div className="small" style={{ color: 'var(--ink-soft)', marginTop: 2 }}>{intro}</div>
          </div>
          {!signedIn && (
            <a href={`/${locale}/sign-in`} className="btn btn-secondary small">
              {t('signInToSave')} →
            </a>
          )}
        </div>
      </header>
      <AskChat
        locale={locale as 'en' | 'fi' | 'sv'}
        starters={starters}
        staffStarters={staffStarters}
        signedIn={signedIn}
        staffEligible={staffEligible}
        userId={session.user?.id ?? null}
        corpusStats={corpusStats}
        auditMetric={auditMetric}
        ask={ask}
        contactEmailDefault={session.user?.email ?? null}
        apiUrl={process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}
      />
    </article>
  );
}
