import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { jwtVerify } from 'jose';
import { LOCALES } from './i18n';

const intl = createIntlMiddleware({
  locales: LOCALES,
  defaultLocale: 'fi',
  localePrefix: 'always',
  localeDetection: true,
});

const STAFF_ROLES = new Set(['curator', 'finance', 'admin']);

interface SessionPayload {
  sub?: string;
  role?: string;
}

/** Lightweight session probe — middleware runs on the edge runtime so we
 *  use jose (works there) and avoid pulling in @prisma/client. The DB
 *  role recheck happens at the API layer; here we just decide redirects
 *  based on the cookie's claimed role. */
async function readSession(req: NextRequest): Promise<SessionPayload | null> {
  const raw = req.cookies.get('bloomoulu.session')?.value;
  if (!raw) return null;
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
    const { payload } = await jwtVerify(raw, secret, { algorithms: ['HS256'] });
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
      role: typeof payload.role === 'string' ? payload.role : undefined,
    };
  } catch {
    return null;
  }
}

function locale(pathname: string): string {
  const seg = pathname.split('/')[1] ?? '';
  return LOCALES.includes(seg as (typeof LOCALES)[number]) ? seg : 'fi';
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Anything outside the locale-prefixed app delegates straight to the
  // next-intl middleware (which handles the locale redirect itself).
  if (!/^\/(en|fi|sv)(\/|$)/.test(pathname)) {
    return intl(req);
  }

  const loc = locale(pathname);
  const path = pathname.replace(/^\/(en|fi|sv)/, '');

  // /staff/** → require staff role
  if (path === '/staff' || path.startsWith('/staff/')) {
    const sess = await readSession(req);
    if (!sess?.sub || !sess.role) {
      const url = req.nextUrl.clone();
      url.pathname = `/${loc}/sign-in`;
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
    if (!STAFF_ROLES.has(sess.role)) {
      // Logged in but wrong role — let the page render its own 403 so
      // the donor sees a polite explanation instead of a bare redirect.
      return intl(req);
    }
  }

  // /me/** + /garden → require any session
  if (
    path === '/me' ||
    path.startsWith('/me/') ||
    path === '/garden' ||
    path.startsWith('/garden/')
  ) {
    const sess = await readSession(req);
    if (!sess?.sub) {
      const url = req.nextUrl.clone();
      url.pathname = `/${loc}/sign-in`;
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return intl(req);
}

export const config = {
  // Exclude the same-origin proxy paths (`/v1/*`, `/webhooks/*`, `/admin/*`,
  // and `/kiosk/*` — see next.config.mjs rewrites) so the locale middleware
  // doesn't redirect them through /fi/...: a JSON fetch, the AdminJS panel, or
  // the kiosk (its own basePath app) must be handled by the Next.js rewrite,
  // not localised. Everything else still goes through intl.
  matcher: ['/((?!api|v1|webhooks|admin|kiosk|_next|_vercel|.*\\..*).*)'],
};
