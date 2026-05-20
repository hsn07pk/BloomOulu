'use server';
/**
 * Server actions for the Paytrail mock checkout page. The "Pay" button
 * POSTs to api `/v1/payments/paytrail-mock/finalize`, which mints a
 * signed return URL. We then redirect the donor's browser to that
 * URL, which lands on /donate/complete with the real `signature` query
 * param — same as a real Paytrail return.
 */
import { redirect } from 'next/navigation';

function apiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
}

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function payWithMockAction(formData: FormData) {
  const locale = (formData.get('locale') as string) || 'en';
  const orderId = ((formData.get('orderId') as string) ?? '').trim();
  const status = ((formData.get('status') as string) ?? 'ok') as 'ok' | 'fail';
  const cancel = (formData.get('cancel') as string) || '';

  let nextUrl = cancel || `/${locale}/cart`;
  try {
    const res = await fetch(`${apiUrl()}/v1/payments/paytrail-mock/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, status }),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as { returnUrl?: string };
      if (data.returnUrl) nextUrl = data.returnUrl;
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
  }
  redirect(nextUrl as Parameters<typeof redirect>[0]);
}

export async function cancelMockAction(formData: FormData) {
  const locale = (formData.get('locale') as string) || 'en';
  const cancel = (formData.get('cancel') as string) || `/${locale}/cart?cancelled=1`;
  redirect(cancel as Parameters<typeof redirect>[0]);
}
