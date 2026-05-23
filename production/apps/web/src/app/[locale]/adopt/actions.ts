'use server';

import { redirect } from 'next/navigation';

// Shared internal helper — both single and bundle actions accept the same
// donor/gift/memorial/co-adopter fields from the wizard FormData. Whatever
// the wizard's submit collects, we hand straight through to the NestJS
// controller; its Zod DTO is the authoritative validator.
function decodeCoAdopters(formData: FormData): Array<{ name?: string; email?: string }> | undefined {
  const raw = formData.get('coAdopters');
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const cleaned = parsed
      .filter((c) => c && typeof c === 'object')
      .map((c: any) => ({
        name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : undefined,
        email: typeof c.email === 'string' && c.email.trim() ? c.email.trim() : undefined,
      }))
      .filter((c) => c.name || c.email);
    return cleaned.length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

function commonBody(formData: FormData) {
  const recurring = formData.get('recurring') === 'true';
  const intent = (formData.get('intent') as string) || 'for_self';
  const billingInterval =
    (formData.get('billingInterval') as string) || (recurring ? 'monthly' : 'annual');
  const body: Record<string, unknown> = {
    intent,
    recurring,
    billingInterval,
    donor: {
      email: formData.get('email'),
      name: formData.get('name') || undefined,
      locale: formData.get('locale'),
      countryCode: 'FI',
      homeRegion: formData.get('homeRegion') || undefined,
    },
    dedication: formData.get('dedication') || undefined,
    showOnDonorWall: true,
    marketingOptIn: formData.get('marketingOptIn') === 'true',
    preferredProvider: formData.get('preferredProvider') || undefined,
  };
  if (intent === 'gift') {
    body.giftRecipientName = formData.get('giftRecipientName') || undefined;
    body.giftRecipientEmail = formData.get('giftRecipientEmail') || undefined;
    const deliverOn = formData.get('giftDeliverOn');
    if (typeof deliverOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deliverOn)) {
      body.giftDeliverOn = deliverOn;
    }
    body.giftAnonymous = formData.get('giftAnonymous') === 'true';
    body.giftWrap = formData.get('giftWrap') === 'true';
  }
  if (intent === 'memorial') {
    body.memorialOf = formData.get('memorialOf') || undefined;
    body.memorialFamilyEmail = formData.get('memorialFamilyEmail') || undefined;
  }
  const coAdopters = decodeCoAdopters(formData);
  if (coAdopters && coAdopters.length > 0) body.coAdopters = coAdopters;
  return { body, intent };
}

function apiBase(): string {
  // Server actions run inside the web container; in Docker, the public URL
  // resolves to the container itself. Prefer the internal Docker-network
  // URL when present so the submit POST reaches the api service.
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
}

export async function adoptAction(formData: FormData) {
  const { body } = commonBody(formData);
  body.plantSlug = formData.get('plantSlug');
  body.tierId = formData.get('tierId');
  const res = await fetch(`${apiBase()}/v1/adoptions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Adoption failed: ${err}`);
  }
  const { redirectUrl } = await res.json();
  redirect(redirectUrl);
}

export async function adoptBundleAction(formData: FormData) {
  const { body } = commonBody(formData);
  const rawItems = formData.get('items');
  if (typeof rawItems !== 'string') throw new Error('Bundle adoption missing items');
  let items: Array<{ plantSlug: string; tierId: string }>;
  try {
    const parsed = JSON.parse(rawItems);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty items');
    items = parsed
      .filter((p) => p && typeof p === 'object')
      .map((p: any) => ({ plantSlug: String(p.plantSlug), tierId: String(p.tierId) }))
      .filter((p) => p.plantSlug && p.tierId);
  } catch {
    throw new Error('Bundle adoption could not parse items');
  }
  if (items.length === 0) throw new Error('Bundle adoption has no valid items');
  body.items = items;
  const res = await fetch(`${apiBase()}/v1/adoptions/bundle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bundle adoption failed: ${err}`);
  }
  const { redirectUrl } = await res.json();
  redirect(redirectUrl);
}
