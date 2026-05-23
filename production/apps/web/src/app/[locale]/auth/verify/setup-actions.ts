'use server';
/**
 * Server action for the /auth/verify setup form (new sign-ups).
 * Posts to /v1/auth/verify-and-setup, mints a session JWT, sets the
 * bloomoulu.session cookie, and lands the new donor in /garden.
 */
import { cookies } from 'next/headers';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { redirect } from 'next/navigation';
import { SignJWT } from 'jose';

// Next.js's `redirect()` and `notFound()` work by throwing a special
// error whose `digest` starts with `NEXT_REDIRECT`. A bare `catch {}`
// would silently swallow them, so we duck-type here instead of
// importing the (version-unstable) `isRedirectError` helper.
function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function apiUrl(): string {
  return getInternalApiUrl();
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

  // Decide the next URL inside try/catch but DO NOT call redirect() from
  // inside try — redirect() works by throwing NEXT_REDIRECT, which a
  // bare `catch {}` would swallow and silently land the user in
  // `?reason=expired` even on success. We branch first, then redirect
  // exactly once at the very end.
  let nextUrl = `/${locale}/sign-in?reason=expired`;
  let jwtToSet: string | null = null;
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
      // Any non-ok data.reason already maps to the default expired URL.
    }
  } catch (err) {
    // Defensive: in case future edits re-introduce a redirect() inside the
    // try, never swallow it. Plain fetch failures fall through silently.
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
  // typedRoutes types `redirect` against the literal Route union — bypass
  // it because nextUrl is computed at runtime from form input.
  redirect(nextUrl as Parameters<typeof redirect>[0]);
}
