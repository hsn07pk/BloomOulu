import { getTranslations } from 'next-intl/server';
import { getInternalApiUrl, getBrowserApiUrl } from '@bloomoulu/constants';
import { PlantIndex, type PlantIndexItem } from '../../../components/PlantIndex.client';

export const revalidate = 60;

interface InitialPage {
  items: PlantIndexItem[];
  total: number;
  totalPages: number;
}

async function fetchInitialPlants(): Promise<InitialPage> {
  // SSR runs inside the web container — INTERNAL_API_URL points at the
  // in-cluster api:4000; the public NEXT_PUBLIC_API_URL would resolve to
  // the container itself and return an empty list.
  //
  // Note: we ask for page=1 so the response includes total + totalPages,
  // matching the new offset-based pagination the client uses. The client
  // re-fetches in offset mode for every filter / page change, so the SSR
  // shape mirrors the runtime shape exactly.
  const apiUrl = getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/plants?limit=24&page=1`, { cache: 'no-store' });
    if (!res.ok) return { items: [], total: 0, totalPages: 1 };
    const data = await res.json();
    if (Array.isArray(data)) return { items: data, total: data.length, totalPages: 1 };
    return {
      items: data.items ?? [],
      total: data.total ?? data.items?.length ?? 0,
      totalPages: data.totalPages ?? 1,
    };
  } catch {
    return { items: [], total: 0, totalPages: 1 };
  }
}

export default async function PlantsIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tp = await getTranslations({ locale, namespace: 'Plants' });
  const { items: plants, total, totalPages } = await fetchInitialPlants();
  // Browser-side URL (the client picker re-fetches as the user paginates / searches).
  const apiUrl = getBrowserApiUrl();

  return (
    <div className="fade-in">
      <PlantIndex
        locale={locale}
        apiUrl={apiUrl}
        initialItems={plants}
        initialTotal={total}
        initialTotalPages={totalPages}
      />
      <noscript>
        <p className="container muted small" style={{ marginTop: 8 }}>
          {tp('searchAria')}
        </p>
      </noscript>
    </div>
  );
}
