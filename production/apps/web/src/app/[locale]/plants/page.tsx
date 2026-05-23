import { getTranslations } from 'next-intl/server';
import { getInternalApiUrl, getBrowserApiUrl } from '@bloomoulu/constants';
import { PlantIndex, type PlantIndexItem } from '../../../components/PlantIndex.client';

export const revalidate = 60;

async function fetchInitialPlants(): Promise<{ items: PlantIndexItem[]; nextCursor: string | null }> {
  // SSR runs inside the web container — INTERNAL_API_URL points at the
  // in-cluster api:4000; the public NEXT_PUBLIC_API_URL would resolve
  // to the container itself and return an empty list.
  const apiUrl =
    getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/plants?limit=24`, {
      cache: 'no-store',
    });
    if (!res.ok) return { items: [], nextCursor: null };
    const data = await res.json();
    if (Array.isArray(data)) return { items: data, nextCursor: null };
    return { items: data.items ?? [], nextCursor: data.nextCursor ?? null };
  } catch {
    return { items: [], nextCursor: null };
  }
}

export default async function PlantsIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tp = await getTranslations({ locale, namespace: 'Plants' });
  const { items: plants, nextCursor } = await fetchInitialPlants();
  // Browser-side URL (the client picker re-fetches as the user paginates / searches).
  const apiUrl = getBrowserApiUrl();

  return (
    <div className="fade-in">
      <PlantIndex
        locale={locale}
        apiUrl={apiUrl}
        initialItems={plants}
        initialCursor={nextCursor}
      />
      <noscript>
        <p className="container muted small" style={{ marginTop: 8 }}>
          {tp('searchAria')}
        </p>
      </noscript>
    </div>
  );
}
