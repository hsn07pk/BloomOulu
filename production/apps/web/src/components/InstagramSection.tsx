import { getTranslations } from 'next-intl/server';
import { internalApiUrl } from '../lib/api';
import { PlantImage } from './PlantImage.client';
import { relativeTime } from '../lib/relative-time';

interface IgPost {
  shortcode: string | null;
  caption: string | null;
  takenAt: string | null;
  permalink: string;
  imageUrl: string;
  mediaType: string;
}
interface IgFeed {
  handle: string;
  enabled: boolean;
  source: 'live' | 'fallback' | 'disabled';
  posts: IgPost[];
}

async function fetchFeed(): Promise<IgFeed | null> {
  try {
    const res = await fetch(`${internalApiUrl()}/v1/instagram`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as IgFeed;
  } catch {
    return null;
  }
}

export async function InstagramSection({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Instagram' });
  const feed = await fetchFeed();
  if (feed && feed.enabled === false) return null; // admin-disabled
  const profileUrl = `https://www.instagram.com/${feed?.handle ?? 'oulubotgarden'}/`;
  const posts = feed?.posts ?? [];

  return (
    <section style={{ background: 'var(--sage-pale)', padding: '72px 0' }}>
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div>
            <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>{t('eyebrow')}</div>
            <h2 className="serif" style={{ fontSize: 'clamp(28px, 4vw, 44px)', marginTop: 8, color: 'var(--ink)' }}>{t('title')}</h2>
            <p className="muted" style={{ marginTop: 10, maxWidth: 520 }}>{t('subtitle')}</p>
          </div>
          <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
             style={{ whiteSpace: 'nowrap' }}>
            {t('follow')} ↗
          </a>
        </div>

        {posts.length > 0 && (
          <div data-grid-mobile="2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {posts.map((p) => (
              <a key={p.shortcode ?? p.imageUrl} href={p.permalink} target="_blank" rel="noopener noreferrer"
                 aria-label={t('viewOnInstagram')}
                 className="card"
                 style={{ display: 'block', padding: 0, overflow: 'hidden', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ aspectRatio: '1 / 1', position: 'relative', overflow: 'hidden', background: 'var(--sage-pale)' }}>
                  <PlantImage src={p.imageUrl} alt={p.caption ?? t('handle')} variant="card" />
                </div>
                <div style={{ padding: '14px 16px 16px' }}>
                  {p.caption && (
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: 'var(--ink-soft)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.caption}
                    </p>
                  )}
                  <div className="tiny" style={{ marginTop: 10 }}>
                    {relativeTime(p.takenAt, locale)}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
