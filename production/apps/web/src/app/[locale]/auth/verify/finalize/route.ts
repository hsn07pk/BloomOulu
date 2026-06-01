/**
 * Magic-link verify Route Handler.
 *
 * Email link points here: `/[locale]/auth/verify?email=...&token=...`.
 * The handler:
 *
 *   1. POSTs to api `/v1/auth/verify` to consume the single-use token
 *      (api creates/updates the User row and marks emailVerified).
 *   2. On success, signs a JWT session token (jose, HS256, 30-day TTL),
 *      writes it to the `bloomoulu.session` HttpOnly+Lax cookie, and
 *      redirects to `/[locale]/garden`.
 *   3. On failure, redirects to `/[locale]/sign-in?reason=expired` so
 *      the user gets a clear "request a new link" UI.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { publicOrigin } from '@/lib/public-url';
import { SignJWT } from 'jose';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ locale: string }> }) {
  const { locale } = await ctx.params;
  const url = new URL(req.url);
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token');
  const origin = publicOrigin(req);

  if (!email || !token) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=invalid`, origin));
  }

  const apiUrl =
    getInternalApiUrl();
  interface VerifiedUser {
    id: string;
    email: string;
    name: string | null;
    role?: string;
    locale?: string;
  }
  let user: VerifiedUser | null = null;
  let nextReason: 'expired' | 'rate_limited' | 'service_unavailable' = 'expired';
  try {
    const res = await fetch(`${apiUrl}/v1/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, token }),
      cache: 'no-store',
    });
    if (res.status === 429) {
      nextReason = 'rate_limited';
    } else if (res.ok) {
      const data = (await res.json()) as { ok: boolean; user: VerifiedUser | null };
      if (data.ok && data.user) user = data.user;
    }
  } catch {
    // The API didn't respond at all — distinguish from "token bad" so
    // the user-facing copy makes sense.
    nextReason = 'service_unavailable';
  }

  if (!user) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=${nextReason}`, origin));
  }

  const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
  const jwt = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role ?? 'donor',
    locale: user.locale ?? locale,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);

  const res = NextResponse.redirect(new URL(`/${locale}/garden`, origin));
  res.cookies.set({
    name: 'bloomoulu.session',
    value: jwt,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
