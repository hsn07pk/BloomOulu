/**
 * University of Oulu OIDC entry point.
 *
 * Flow:
 *   1. GET /[locale]/auth/oulu                  → kicks off OIDC authorize
 *   2. IdP redirects to /[locale]/auth/oulu/callback?code=...&state=...
 *   3. We exchange the code for an id_token, verify, mint our HS256
 *      session cookie, redirect to /[locale]/garden.
 *
 * Requires three env vars (set in .env from the University's IdP admin):
 *   AUTH_OULU_OIDC_ISSUER       e.g. https://login.oulu.fi
 *   AUTH_OULU_OIDC_CLIENT_ID
 *   AUTH_OULU_OIDC_CLIENT_SECRET
 *
 * No external library — uses fetch + jose. Works for both staff and
 * students since both authenticate through the same Oulu SSO.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

const STATE_COOKIE = 'bloomoulu.oidc.state';
const SESSION_COOKIE = 'bloomoulu.session';

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
  userinfo_endpoint?: string;
}

async function discover(issuer: string): Promise<OidcDiscovery | null> {
  try {
    const url = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as OidcDiscovery) : null;
  } catch {
    return null;
  }
}

function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ locale: string }> }) {
  const { locale } = await ctx.params;
  const origin = new URL(req.url).origin;
  const issuer = process.env.AUTH_OULU_OIDC_ISSUER;
  const clientId = process.env.AUTH_OULU_OIDC_CLIENT_ID;
  if (!issuer || !clientId) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oulu_not_configured`, origin));
  }
  const disc = await discover(issuer);
  if (!disc) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in?reason=oulu_discovery_failed`, origin));
  }
  const state = randomState();
  const redirectUri = `${origin}/${locale}/auth/oulu/callback`;
  const authUrl = new URL(disc.authorization_endpoint);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  const res = NextResponse.redirect(authUrl);
  res.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}

// Re-export GET-only callback handler from a separate route file would be
// cleaner, but Next.js sees /auth/oulu and /auth/oulu/callback as different
// route segments — the callback lives next to this file with its own route.ts.
export { GET as default };
