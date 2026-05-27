/**
 * /api/adoptions/[id]/certificate.pdf — donor-facing digital certificate.
 *
 *   1. Reads bloomoulu.session cookie + verifies JWT.
 *   2. Calls api `GET /v1/adoptions/:id/certificate.pdf` with a Bearer.
 *   3. Streams the PDF straight back to the browser (api renders on the
 *      fly so there's no persisted file to redirect to).
 */
import { cookies } from 'next/headers';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE = 'bloomoulu.session';

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
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await readSession();
  if (!session) {
    return NextResponse.redirect(new URL(`/en/sign-in?reason=expired`, req.url));
  }
  const { id } = await ctx.params;
  try {
    const res = await fetch(
      `${getInternalApiUrl()}/v1/adoptions/${encodeURIComponent(id)}/certificate.pdf`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${session.token}` },
        cache: 'no-store',
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `api ${res.status}` }, { status: res.status });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="adoption-certificate-${id}.pdf"`,
        'cache-control': 'private, no-cache',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
