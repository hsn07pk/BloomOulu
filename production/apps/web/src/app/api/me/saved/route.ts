/**
 * GET  /api/me/saved          → list of saved plants for the donor
 * POST /api/me/saved/sync     → bulk merge anonymous shadow list on first sign-in
 */
import { cookies } from 'next/headers';
import { getInternalApiUrl } from '@bloomoulu/constants';
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'bloomoulu.session';

async function getBearer(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
}

export async function GET() {
  const bearer = await getBearer();
  if (!bearer) return NextResponse.json({ items: [] });
  const apiUrl =
    getInternalApiUrl();
  const res = await fetch(`${apiUrl}/v1/me/saved`, {
    headers: { Authorization: `Bearer ${bearer}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ items: [] }));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request) {
  const bearer = await getBearer();
  if (!bearer) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const apiUrl =
    getInternalApiUrl();
  const res = await fetch(`${apiUrl}/v1/me/saved/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
