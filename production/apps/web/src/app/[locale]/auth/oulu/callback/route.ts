/**
 * OIDC callback. Exchanges the code for an id_token, verifies the JWT
 * signature against the IdP's JWKS, upserts the corresponding User row
 * via the api, and mints our session cookie.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

const STATE_COOKIE = 'bloomoulu.oidc.state';
const SESSION_COOKIE = 'bloomoulu.session';

async function discover(issuer: string) {
  try {
    const res = await fetch(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration', { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ locale: string }> }) {
  const { locale } = await ctx.params;
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const jar = await cookies();
  const stateCookie = jar.get(STATE_COOKIE)?.value;
  if (!code || !state || !stateCookie || stateCookie !== state) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oidc_state_mismatch`, origin));
  }

  const issuer = process.env.AUTH_OULU_OIDC_ISSUER;
  const clientId = process.env.AUTH_OULU_OIDC_CLIENT_ID;
  const clientSecret = process.env.AUTH_OULU_OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oulu_not_configured`, origin));
  }
  const disc = await discover(issuer);
  if (!disc) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oulu_discovery_failed`, origin));
  }

  // Exchange code → tokens.
  let claims: Record<string, unknown>;
  try {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', `${origin}/${locale}/auth/oulu/callback`);
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    const tokenRes = await fetch(disc.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    });
    if (!tokenRes.ok) throw new Error(`token endpoint ${tokenRes.status}`);
    const tokens = (await tokenRes.json()) as { id_token: string; access_token?: string };
    if (!tokens.id_token) throw new Error('no id_token in response');
    const jwks = createRemoteJWKSet(new URL(disc.jwks_uri));
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: disc.issuer ?? issuer,
      audience: clientId,
    });
    claims = payload as Record<string, unknown>;
  } catch {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oidc_exchange_failed`, origin));
  }

  const email = typeof claims.email === 'string' ? claims.email : null;
  const sub = typeof claims.sub === 'string' ? claims.sub : null;
  const name = typeof claims.name === 'string' ? claims.name : (typeof claims.preferred_username === 'string' ? (claims.preferred_username as string) : null);
  if (!email || !sub) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oidc_missing_claims`, origin));
  }

  // Upsert into the api. Staff vs student/donor role is decided by the
  // api based on the IdP claim (e.g., `groups` includes "garden-staff").
  const apiUrl =
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  let user: { id: string; email: string; name: string | null; role: string; locale: string } | null = null;
  try {
    const apiRes = await fetch(`${apiUrl}/v1/auth/oidc-upsert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Shared secret protects this endpoint — only our web layer
        // (which just verified the OIDC token) is allowed to call it.
        'x-bloomoulu-oidc-secret': process.env.AUTH_SECRET ?? 'dev-secret',
      },
      body: JSON.stringify({
        email,
        ouluUid: sub,
        name,
        claims,
      }),
      cache: 'no-store',
    });
    if (apiRes.ok) user = await apiRes.json();
  } catch {
    /* fall through */
  }
  if (!user) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oidc_upsert_failed`, origin));
  }

  const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
  const jwt = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);

  const res = NextResponse.redirect(new URL(`/${locale}/garden`, origin));
  res.cookies.set({
    name: STATE_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: jwt,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
