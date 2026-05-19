'use server';
/**
 * Server action for the /auth/verify setup form (new sign-ups).
 * Posts to /v1/auth/verify-and-setup, mints a session JWT, sets the
 * bloomoulu.session cookie, and lands the new donor in /garden.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT } from 'jose';

function apiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
}

const COOKIE_NAME = 'bloomoulu.session';

export async function verifyAndSetupAction(formData: FormData) {
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const token = ((formData.get('token') as string) ?? '').trim();
  const password = (formData.get('password') as string) ?? '';
  const name = ((formData.get('name') as string) ?? '').trim();
  const locale = (formData.get('locale') as string) || 'en';

  if (!email || !token || !password || password.length < 8) {
    redirect(`/${locale}/sign-in?reason=invalid`);
  }

  try {
    const res = await fetch(`${apiUrl()}/v1/auth/verify-and-setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, token, password, name: name || undefined }),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        user?: { id: string; email: string; name: string | null; role: string; locale: string };
        reason?: string;
      };
      if (data.ok && data.user) {
        const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
        const jwt = await new SignJWT({
          sub: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          locale: data.user.locale,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('30d')
          .sign(secret);
        const jar = await cookies();
        jar.set({
          name: COOKIE_NAME,
          value: jwt,
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 60 * 60 * 24 * 30,
        });
        redirect(`/${locale}/garden`);
      }
      if (data.reason === 'invalid_or_expired') {
        redirect(`/${locale}/sign-in?reason=expired`);
      }
    }
  } catch {/* fall through */}
  redirect(`/${locale}/sign-in?reason=expired`);
}
