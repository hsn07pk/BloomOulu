/**
 * GDPR Article 17 — donor erasure request.
 *
 * The /garden page POSTs to this route. We:
 *   1. Read the bloomoulu.session cookie (HttpOnly).
 *   2. Verify the JWT to extract `sub` (user id) and role.
 *   3. POST to api `/v1/gdpr/erase` with `userId=sub` + Bearer token.
 *   4. Redirect to /garden with an "awaiting admin review" banner.
 *
 * The api creates a DataErasureRequest in status='pending'. An admin
 * approves in /admin → DataErasureRequest. After approval, the worker
 * pseudonymises PII and preserves Payment/Receipt/TaxCert for the
 * 6-year Finnish accounting law retention window.
 */
import { cookies } from 'next/headers';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE = 'bloomoulu.session';

function apiBase(): string {
  return getInternalApiUrl();
}

async function readSession(): Promise<{ sub: string; locale: string; token: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      locale: typeof payload.locale === 'string' ? payload.locale : 'en',
      token,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await readSession();
  if (!session) {
    return NextResponse.redirect(new URL('/en/sign-in?reason=expired', req.url));
  }
  const back = new URL(`/${session.locale}/garden`, req.url);
  try {
    const res = await fetch(`${apiBase()}/v1/gdpr/erase`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ userId: session.sub }),
      cache: 'no-store',
    });
    if (res.ok) {
      back.searchParams.set('gdpr', 'erase_pending');
    } else {
      back.searchParams.set('gdpr', 'erase_failed');
    }
  } catch {
    back.searchParams.set('gdpr', 'erase_failed');
  }
  return NextResponse.redirect(back, { status: 303 });
}

export async function GET(req: NextRequest) {
  const session = await readSession();
  const locale = session?.locale ?? 'en';
  return NextResponse.redirect(new URL(`/${locale}/garden`, req.url));
}
