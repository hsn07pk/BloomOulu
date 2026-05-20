/**
 * /api/receipts/[number]/pdf — donor-facing receipt PDF download.
 *
 * Why this exists: the api stores `Receipt.pdfUrl` as `s3://bucket/key`
 * so the browser can't fetch it directly. This route:
 *   1. Reads the bloomoulu.session cookie + verifies the JWT.
 *   2. Calls api `GET /v1/receipts/{number}/pdf` with a Bearer token.
 *   3. The api enforces ownership (donor of the Receipt or staff) and
 *      302s to a short-lived pre-signed S3/MinIO URL.
 *   4. We forward that redirect to the browser.
 *
 * MinIO note: pre-signed URLs reference the internal `http://minio:9000`
 * hostname. From the browser the host is unreachable; we rewrite the
 * hostname to the public S3_PUBLIC_ENDPOINT (e.g. http://localhost:9000)
 * before redirecting.
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

function publicS3(): string {
  return process.env.NEXT_PUBLIC_S3_ENDPOINT ?? 'http://localhost:9000';
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
        // Rewrite internal MinIO host → public-reachable host so the
        // browser can actually load the bytes.
        try {
          const u = new URL(target);
          if (u.hostname === 'minio') {
            const pub = new URL(publicS3());
            u.hostname = pub.hostname;
            u.port = pub.port;
            u.protocol = pub.protocol;
            return NextResponse.redirect(u.toString(), { status: 302 });
          }
        } catch {/* fall through, return as-is */}
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
