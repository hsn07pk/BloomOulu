/**
 * Saved-plants proxy.
 *
 *   PUT    /api/me/saved/[slug]   → save a bookmark
 *   DELETE /api/me/saved/[slug]   → remove a bookmark
 *
 * The handler:
 *   1. Reads the BloomOulu session cookie (HS256 JWT).
 *   2. Forwards to the upstream api as `Authorization: Bearer <jwt>`.
 *   3. Returns the api's JSON unchanged.
 *
 * The verified JWT is what the api trusts — the browser cannot spoof
 * userId because the cookie is HttpOnly + the api re-verifies the
 * signature with the shared AUTH_SECRET.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'bloomoulu.session';

async function getBearer(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  return raw ?? null;
}

export async function PUT(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const bearer = await getBearer();
  if (!bearer) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const apiUrl =
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${apiUrl}/v1/me/saved/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${bearer}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const bearer = await getBearer();
  if (!bearer) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const apiUrl =
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${apiUrl}/v1/me/saved/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearer}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
