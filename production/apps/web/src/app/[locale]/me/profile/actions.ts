'use server';

import { revalidatePath } from 'next/cache';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { cookies } from 'next/headers';

function apiUrl(): string {
  return getInternalApiUrl();
}

async function bearer(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get('bloomoulu.session')?.value;
  return token ?? null;
}

/** Save profile changes. The action returns an error string if the API
 *  rejects (validation, auth) so the client can surface it; on success it
 *  returns `null` and re-renders the page. */
export async function saveProfile(formData: FormData): Promise<string | null> {
  const token = await bearer();
  if (!token) return 'unauthenticated';

  const body: Record<string, unknown> = {
    name: (formData.get('name') as string) || null,
    locale: formData.get('locale'),
    homeRegion: (formData.get('homeRegion') as string) || null,
    marketingOptIn: formData.get('marketingOptIn') === 'on',
  };

  const res = await fetch(`${apiUrl()}/v1/me/profile`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return text || `error_${res.status}`;
  }
  // Bump the SSR cache so the form reflects the saved values.
  const locale = (formData.get('uiLocale') as string) || 'en';
  revalidatePath(`/${locale}/me/profile`);
  return null;
}

/** GDPR Art. 15 — donor requests an export. Returns null on success. */
export async function requestExport(formData: FormData): Promise<string | null> {
  const token = await bearer();
  if (!token) return 'unauthenticated';
  const userId = formData.get('userId') as string;
  const res = await fetch(`${apiUrl()}/v1/gdpr/export`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
    cache: 'no-store',
  });
  if (!res.ok) return `error_${res.status}`;
  return null;
}

/** GDPR Art. 17 — donor requests erasure. Admin reviews per the
 *  workflow in /admin/resources/DataErasureRequest. */
export async function requestErasure(formData: FormData): Promise<string | null> {
  const token = await bearer();
  if (!token) return 'unauthenticated';
  const userId = formData.get('userId') as string;
  const reason = (formData.get('reason') as string) || undefined;
  const res = await fetch(`${apiUrl()}/v1/gdpr/erase`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, reason }),
    cache: 'no-store',
  });
  if (!res.ok) return `error_${res.status}`;
  return null;
}
