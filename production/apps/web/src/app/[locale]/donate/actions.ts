'use server';

import { redirect } from 'next/navigation';
import { getInternalApiUrl } from '@bloomoulu/constants';

/**
 * Submit a one-time donation. The web form collects an amount (a suggested
 * chip or a custom value), an optional species to direct it to, an optional
 * public dedication, and the donor's details. The NestJS DonationsService Zod
 * DTO is the authoritative validator; we hand the fields straight through.
 */
export async function donateAction(formData: FormData) {
  const rawAmount = formData.get('amountCents');
  const amountCents =
    typeof rawAmount === 'string' ? parseInt(rawAmount, 10) : NaN;
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('A valid donation amount is required');
  }

  const plantSlug = formData.get('plantSlug');
  const body: Record<string, unknown> = {
    amountCents,
    donor: {
      email: formData.get('email'),
      name: formData.get('name') || undefined,
      locale: formData.get('locale'),
      countryCode: 'FI',
    },
    dedication: formData.get('dedication') || undefined,
    // The donate form's only wall control is the "don't show me" checkbox,
    // which maps to `anonymous`. Keep showOnWall consistent with it rather
    // than reading a field the form never submits.
    showOnWall: formData.get('anonymous') !== 'true',
    anonymous: formData.get('anonymous') === 'true',
    marketingOptIn: formData.get('marketingOptIn') === 'true',
    preferredProvider: formData.get('preferredProvider') || undefined,
  };
  if (typeof plantSlug === 'string' && plantSlug.length > 0) {
    body.plantSlug = plantSlug;
  }

  const res = await fetch(`${getInternalApiUrl()}/v1/donations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Donation failed: ${err}`);
  }
  const { redirectUrl } = await res.json();
  redirect(redirectUrl);
}
