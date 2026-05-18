/**
 * Sign-out route handler. Clears the `bloomoulu.session` cookie and
 * redirects to the locale's home page. Accepts both GET (for plain
 * <a href> links in the Topbar) and POST (for forms / form-actions).
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_NAME = 'bloomoulu.session';

async function clearAndRedirect(locale: string, origin: string) {
  const res = NextResponse.redirect(new URL(`/${locale}`, origin));
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ locale: string }> }) {
  const { locale } = await ctx.params;
  return clearAndRedirect(locale, new URL(req.url).origin);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ locale: string }> }) {
  const { locale } = await ctx.params;
  return clearAndRedirect(locale, new URL(req.url).origin);
}
