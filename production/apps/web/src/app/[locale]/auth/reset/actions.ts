'use server';
/**
 * Server action for the password-reset form. POSTs to
 * /v1/auth/reset-password, then mints a session JWT and writes the
 * bloomoulu.session cookie before redirecting to /garden.
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

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function resetPasswordAction(formData: FormData) {
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const token = ((formData.get('token') as string) ?? '').trim();
  const password = (formData.get('password') as string) ?? '';
  const locale = (formData.get('locale') as string) || 'en';

  if (!email || !token || !password || password.length < 8) {
    redirect(`/${locale}/sign-in?reason=invalid`);
  }

  let nextUrl = `/${locale}/sign-in?reason=expired`;
  let jwtToSet: string | null = null;
  try {
    const res = await fetch(`${apiUrl()}/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, token, password }),
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
        jwtToSet = await new SignJWT({
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
        nextUrl = `/${locale}/garden`;
      }
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
  }

  if (jwtToSet) {
    const jar = await cookies();
    jar.set({
      name: COOKIE_NAME,
      value: jwtToSet,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  redirect(nextUrl as Parameters<typeof redirect>[0]);
}
