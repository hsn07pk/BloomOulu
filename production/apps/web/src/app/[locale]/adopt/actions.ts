'use server';

import { redirect } from 'next/navigation';

// The wizard's submit collects 20+ form fields. We pass them straight
// through to the NestJS controller — the Zod DTO over there is the
// authoritative validator. This action is responsible for: building the
// JSON body, propagating the redirect URL, and surfacing a thrown error
// so the client can display it.
export async function adoptAction(formData: FormData) {
  // Server actions run inside the web container; in Docker, the public URL
  // resolves to the container itself. Prefer the internal Docker-network
  // URL when present so the submit POST reaches the api service.
  const apiUrl =
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  const recurring = formData.get('recurring') === 'true';
  const intent = (formData.get('intent') as string) || 'for_self';
  const billingInterval =
    (formData.get('billingInterval') as string) || (recurring ? 'monthly' : 'annual');
  const coAdoptersRaw = formData.get('coAdopters');
  let coAdopters: Array<{ name?: string; email?: string }> | undefined;
  if (typeof coAdoptersRaw === 'string' && coAdoptersRaw.length > 0) {
    try {
      const parsed = JSON.parse(coAdoptersRaw);
      if (Array.isArray(parsed)) {
        coAdopters = parsed
          .filter((c) => c && typeof c === 'object')
          .map((c: any) => ({
            name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : undefined,
            email: typeof c.email === 'string' && c.email.trim() ? c.email.trim() : undefined,
          }))
          .filter((c) => c.name || c.email);
      }
    } catch {
      // ignore malformed JSON — the picker UI controls the format anyway.
    }
  }

  const body: Record<string, unknown> = {
    plantSlug: formData.get('plantSlug'),
    tierId: formData.get('tierId'),
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
  if (coAdopters && coAdopters.length > 0) body.coAdopters = coAdopters;

  const res = await fetch(`${apiUrl}/v1/adoptions`, {
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
