/**
 * /api/receipts/[number]/pdf — donor-facing receipt PDF download.
 *
 * Flow:
 *   1. Reads the bloomoulu.session cookie + verifies the JWT.
 *   2. Calls api `GET /v1/receipts/{number}/pdf` with a Bearer token.
 *   3. The api enforces ownership (donor of the Receipt or staff) and
 *      302s to a `/v1/files/<key>` URL served from local storage.
 *   4. We forward that redirect to the browser.
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ number: string }> },
) {
  const session = await readSession();
  if (!session) {
    return NextResponse.redirect(new URL('/en/sign-in?reason=expired', req.url));
  }
  const { number } = await ctx.params;
  try {
    const res = await fetch(`${apiBase()}/v1/receipts/${encodeURIComponent(number)}/pdf`, {
      method: 'GET',
      headers: { authorization: `Bearer ${session.token}` },
      redirect: 'manual',
      cache: 'no-store',
    });
    if (res.status === 302 || res.status === 303 || res.status === 307) {
      const target = res.headers.get('location');
      if (target) {
        return NextResponse.redirect(target, { status: 302 });
      }
    }
    if (res.status === 403) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (res.status === 404) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: `api ${res.status}` }, { status: 502 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
