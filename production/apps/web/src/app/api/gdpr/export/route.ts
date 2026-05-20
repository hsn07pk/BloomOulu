/**
 * GDPR Article 15 — donor self-service export request.
 *
 * The /garden page POSTs to this route. We:
 *   1. Read the bloomoulu.session cookie (HttpOnly).
 *   2. Verify the JWT to extract `sub` (user id) and role.
 *   3. POST to api `/v1/gdpr/export` with `userId=sub` + Bearer token.
 *   4. Redirect to /garden with a success banner.
 *
 * The api creates a DataExportRequest row and enqueues the worker job
 * that gathers PII rows into JSON, uploads to MinIO, and emails the
 * donor a 24-hour pre-signed URL.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE = 'bloomoulu.session';

function apiBase(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  );
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
    const res = await fetch(`${apiBase()}/v1/gdpr/export`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ userId: session.sub }),
      cache: 'no-store',
    });
    if (res.ok) {
      back.searchParams.set('gdpr', 'export_queued');
    } else {
      back.searchParams.set('gdpr', 'export_failed');
    }
  } catch {
    back.searchParams.set('gdpr', 'export_failed');
  }
  return NextResponse.redirect(back, { status: 303 });
}

export async function GET(req: NextRequest) {
  // Make accidental GETs land somewhere sane.
  const session = await readSession();
  const locale = session?.locale ?? 'en';
  return NextResponse.redirect(new URL(`/${locale}/garden`, req.url));
}
