'use server';
/**
 * Sign-in / sign-up server actions.
 *
 * Flow:
 *   1. lookupEmailAction(email)
 *        → /v1/auth/lookup
 *      Decides whether to show a password field (existing+hasPassword)
 *      or to send a verify-and-setup link (new or magic-link-only user).
 *
 *   2. passwordSignInAction(email, password)
 *        → /v1/auth/sign-in
 *      Sets the bloomoulu.session cookie on success, redirects to /garden.
 *
 *   3. signInAction(formData)
 *        Legacy magic-link sender, kept for the "forgot password" /
 *        passwordless flow. Posts to /v1/auth/magic-link.
 */
import { cookies } from 'next/headers';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { redirect } from 'next/navigation';
import { SignJWT } from 'jose';

/** Next.js `redirect()` throws a special NEXT_REDIRECT error. A bare
 *  `catch {}` would silently swallow it and the user would land on an
 *  error page even on success. This helper lets the catch rethrow only
 *  the redirect, treating real exceptions normally. */
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

async function mintSession(user: {
  id: string;
  email: string;
  name?: string | null;
  role?: string;
  locale?: string;
}, fallbackLocale: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
  return await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role ?? 'donor',
    locale: user.locale ?? fallbackLocale,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

async function setSessionCookie(jwt: string) {
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
}

/** Step 1: visitor typed an email and pressed Continue. Look up
 *  whether they're a returning donor with a password or a new sign-up
 *  who needs a verify-and-setup link. */
export async function lookupEmailAction(formData: FormData) {
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const locale = ((formData.get('locale') as string) ?? 'en');
  if (!email || !email.includes('@')) {
    redirect(`/${locale}/sign-in?reason=invalid_email`);
  }
  interface LookupResult { exists: boolean; hasPassword: boolean; verified: boolean }
  let info: LookupResult | null = null;
  try {
    const res = await fetch(`${apiUrl()}/v1/auth/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
    if (res.ok) info = (await res.json()) as LookupResult;
  } catch {/* ignore — handled below */}

  if (info?.exists && info.hasPassword) {
    // Returning donor with a password → show password field on next step.
    redirect(`/${locale}/sign-in?step=password&email=${encodeURIComponent(email)}`);
  }
  // New user OR existing magic-link-only → send a verify-and-setup link.
  try {
    await fetch(`${apiUrl()}/v1/auth/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, locale, setup: !info?.hasPassword }),
      cache: 'no-store',
    });
  } catch {/* ignore — sent-page just tells user to check email */}
  redirect(`/${locale}/sign-in/sent?email=${encodeURIComponent(email)}`);
}

/** Step 2a (returning donor): email + password → session cookie. */
export async function passwordSignInAction(formData: FormData) {
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const password = (formData.get('password') as string) ?? '';
  const locale = ((formData.get('locale') as string) ?? 'en');
  if (!email || !password) {
    redirect(`/${locale}/sign-in?step=password&email=${encodeURIComponent(email)}&reason=invalid`);
  }
  // Compute the next URL inside try, then redirect exactly once after.
  // Doing it any other way (calling redirect from inside try) makes the
  // bare catch swallow the NEXT_REDIRECT and land the donor on
  // ?reason=wrong_password even when the password was correct.
  let nextUrl = `/${locale}/sign-in?step=password&email=${encodeURIComponent(email)}&reason=wrong_password`;
  let jwtToSet: string | null = null;
  try {
    const res = await fetch(`${apiUrl()}/v1/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        user: { id: string; email: string; name: string | null; role: string; locale: string } | null;
      };
      if (data.ok && data.user) {
        jwtToSet = await mintSession(data.user, locale);
        nextUrl = `/${locale}/garden`;
      }
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
  }
  if (jwtToSet) {
    await setSessionCookie(jwtToSet);
  }
  redirect(nextUrl as Parameters<typeof redirect>[0]);
}

/** Forgot-password: emails a reset link. Returns 200 either way so we
 *  don't leak whether the email is registered. */
export async function forgotPasswordAction(formData: FormData) {
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const locale = ((formData.get('locale') as string) ?? 'en');
  if (!email || !email.includes('@')) {
    redirect(`/${locale}/sign-in?reason=forgot&error=invalid_email`);
  }
  try {
    await fetch(`${apiUrl()}/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, locale }),
      cache: 'no-store',
    });
  } catch {/* anti user-enumeration: never leak failure */}
  redirect(`/${locale}/sign-in/sent?email=${encodeURIComponent(email)}&kind=reset` as Parameters<typeof redirect>[0]);
}

/** Legacy magic-link sender. Used as the "forgot password" fallback. */
export async function signInAction(formData: FormData) {
  const locale = (formData.get('locale') as string) || 'en';
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  if (email) {
    await fetch(`${apiUrl()}/v1/auth/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, locale }),
    });
  }
  redirect(`/${locale}/sign-in/sent`);
}
