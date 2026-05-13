'use server';

import { redirect } from 'next/navigation';

export async function adoptAction(formData: FormData) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const body = {
    plantSlug: formData.get('plantSlug'),
    tierId: formData.get('tierId'),
    billingInterval: formData.get('billingInterval'),
    intent: 'for_self',
    recurring: formData.get('billingInterval') !== 'one_time',
    donor: {
      email: formData.get('email'),
      name: formData.get('name') || undefined,
      locale: formData.get('locale'),
      countryCode: 'FI',
    },
    preferredProvider: formData.get('preferredProvider'),
  };
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
