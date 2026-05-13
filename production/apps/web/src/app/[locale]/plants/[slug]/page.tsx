import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${api}/v1/plants?limit=200`);
  if (!res.ok) return [];
  const plants = (await res.json()) as Array<{ slug: string }>;
  return plants.flatMap((p) => [
    { locale: 'fi', slug: p.slug },
    { locale: 'en', slug: p.slug },
    { locale: 'sv', slug: p.slug },
  ]);
}

export default async function PlantPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'Plant' });
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${api}/v1/plants/${slug}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) notFound();
  const plant = await res.json();
  const story = plant.story[locale] ?? plant.story.en;
  const nameField = `name${locale[0]!.toUpperCase()}${locale.slice(1)}`;
  const altField = `alt${locale[0]!.toUpperCase()}${locale.slice(1)}`;
  const name = plant[nameField] ?? plant.nameEn;
  return (
    <article>
      <header>
        <p>{plant.redListStatus} · {plant.bloomSeason}</p>
        <h1>{name}</h1>
        <p><em>{plant.taxon?.latinName}</em></p>
      </header>
      {plant.primaryImage?.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={plant.primaryImage.url} alt={plant.primaryImage[altField]} loading="lazy" />
      )}
      <section>
        <h2>{t('story')}</h2>
        <p>{story}</p>
      </section>
      <section>
        <a href={`./adopt?plant=${plant.slug}`}>{t('adoptCta')}</a>
      </section>
    </article>
  );
}
