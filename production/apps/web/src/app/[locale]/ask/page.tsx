/**
 * AskTheGarden — RAG chat UI shell.
 *
 * Server-component shell; the chat itself streams via /v1/ask/stream from
 * AskChat (client component).
 */
import { getTranslations } from 'next-intl/server';
import AskChat from './chat.client';

export const dynamic = 'force-dynamic';

async function loadStarters(locale: string): Promise<string[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/v1/ask/starters`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const all = (await res.json()) as Array<{ text: string; locale: string }>;
    // Prefer the donor's locale; fall back to whatever else came back.
    const sameLocale = all.filter((s) => s.locale === locale).map((s) => s.text);
    if (sameLocale.length >= 3) return sameLocale.slice(0, 5);
    return [...sameLocale, ...all.filter((s) => s.locale !== locale).map((s) => s.text)].slice(0, 5);
  } catch {
    return [];
  }
}

export default async function AskPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Ask' });
  const starters = await loadStarters(locale);
  return (
    <article className="container fade-in" style={{ paddingTop: 32 }}>
      <header style={{ marginBottom: 8 }}>
        <div className="eyebrow eyebrow--rust" style={{ color: 'var(--rust-on-light)' }}>
          AskTheGarden
        </div>
        <h1 style={{ fontSize: 'clamp(36px, 5vw, 56px)', marginTop: 12 }}>{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 16 }}>{t('subtitle')}</p>
      </header>
      <AskChat locale={locale as 'en' | 'fi' | 'sv'} starters={starters} />
    </article>
  );
}
