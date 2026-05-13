import { useTranslations } from 'next-intl';

export const revalidate = 60; // ISR — homepage refreshes every minute

async function fetchFeaturedPlants() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${apiUrl}/v1/plants?limit=8`, {
    next: { revalidate: 60, tags: ['plants'] },
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function HomePage() {
  const plants = await fetchFeaturedPlants();
  return <HomeView plants={plants} />;
}

function HomeView({ plants }: { plants: any[] }) {
  const t = useTranslations('Home');
  return (
    <article>
      <header>
        <h1>{t('heroTitle')}</h1>
        <p>{t('heroLead')}</p>
      </header>
      <section aria-labelledby="featured">
        <h2 id="featured">{t('featured')}</h2>
        <ul>
          {plants.map((p) => (
            <li key={p.id}>
              <a href={`./plants/${p.slug}`}>{p.nameFi} — {p.nameEn}</a>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
