import { notFound } from 'next/navigation';
import { getInternalApiUrl, getBrowserApiUrl } from '@bloomoulu/constants';
import { PlantPageClient } from './plant.client';
import { getSession } from '../../../../lib/session';

export const dynamicParams = true;
// 60s ISR (was 3600s). The plant detail card surfaces adopterCount /
// fundedCents / scanCount in real time; the previous 1-hour TTL meant
// a new adoption took up to an hour to show up. 60s is the same
// freshness budget the home page uses.
export const revalidate = 60;

interface Plant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  bloomSeason: string;
  bloomWindow?: string | null;
  origin: string;
  habitat: string;
  biome: string;
  gardenZone?: string | null;
  story: Record<string, string>;
  quickFacts?: unknown;
  adopterCount?: number;
  fundedCents?: number;
  targetCents?: number;
  taxonId?: string;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string; attribution?: string } | null;
  images?: Array<{ id: string; url: string; altEn: string; altFi: string; altSv: string; attribution?: string }>;
  taxon?: { latinName: string; family: string } | null;
  citations?: Array<{ citation: { displayTitle: string; authors?: string | null; year?: number | null; url?: string | null } }>;
}

interface SimilarPlant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  adopterCount?: number;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
  taxon?: { latinName: string } | null;
}

export async function generateStaticParams() {
  const api =
    getInternalApiUrl();
  try {
    const res = await fetch(`${api}/v1/plants?limit=200`);
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<{ slug: string }> } | Array<{ slug: string }>;
    const plants = Array.isArray(data) ? data : (data.items ?? []);
    return plants.flatMap((p) => [
      { locale: 'fi', slug: p.slug },
      { locale: 'en', slug: p.slug },
      { locale: 'sv', slug: p.slug },
    ]);
  } catch {
    return [];
  }
}

async function fetchSimilar(plant: Plant, api: string): Promise<SimilarPlant[]> {
  try {
    // First try same-family matches via taxonId. Falls back to same-redList.
    // Cheap: one extra api call, cached the same as the plant.
    const url = `${api}/v1/plants?redList=${plant.redListStatus}&limit=12`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: SimilarPlant[] };
    const items = data.items ?? [];
    return items.filter((p) => p.id !== plant.id).slice(0, 3);
  } catch {
    return [];
  }
}

export default async function PlantPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  // Server-side: prefer the in-cluster URL (api:4000) so SSR works when
  // running under Docker. Client-side: pass the public URL so the
  // browser's fetch calls can hit it.
  const serverApi =
    getInternalApiUrl();
  const browserApi = getBrowserApiUrl();
  // Fetch plant + tiers + settings in parallel. /v1/tiers and
  // /v1/settings/public are the single source of truth for adoption
  // pricing and which billing intervals donors see. Any admin edit
  // flows to plant page, /adopt wizard, /cart, and /cart/checkout
  // uniformly.
  const [plantRes, tiersRes, settingsRes] = await Promise.all([
    fetch(`${serverApi}/v1/plants/${slug}`, { cache: 'no-store' }),
    fetch(`${serverApi}/v1/tiers`, { cache: 'no-store' }),
    fetch(`${serverApi}/v1/settings/public`, { cache: 'no-store' }),
  ]);
  if (!plantRes.ok) notFound();
  const plant = (await plantRes.json()) as Plant;
  const tiers: Tier[] = tiersRes.ok ? await tiersRes.json() : [];
  const settings = settingsRes.ok ? await settingsRes.json() : null;
  const intervalsEnabled: Array<'monthly' | 'annual' | 'one_time'> =
    settings?.adoption?.intervalsEnabled ?? ['monthly', 'one_time'];
  const similar = await fetchSimilar(plant, serverApi);

  const session = await getSession();

  return (
    <PlantPageClient
      plant={plant}
      similarPlants={similar}
      tiers={tiers}
      intervalsEnabled={intervalsEnabled}
      locale={locale as 'en' | 'fi' | 'sv'}
      apiUrl={browserApi}
      signedIn={session.user !== null}
    />
  );
}

export interface Tier {
  id: 'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate';
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
  monthlyPriceCents?: number | null;
  blurbEn?: string;
  blurbFi?: string;
  blurbSv?: string;
  sortOrder?: number;
}
