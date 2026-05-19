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
import { redirect } from 'next/navigation';
import { SignJWT } from 'jose';

function apiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
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
        const jwt = await mintSession(data.user, locale);
        await setSessionCookie(jwt);
        redirect(`/${locale}/garden`);
      }
    }
  } catch {/* fall through */}
  redirect(`/${locale}/sign-in?step=password&email=${encodeURIComponent(email)}&reason=wrong_password`);
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
