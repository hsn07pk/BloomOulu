/**
 * Unified session reader. Tries the BloomOulu HS256 JWT (set by the
 * magic-link verify route) first, then falls back to next-auth's `auth()`
 * helper so the OAuth/OIDC paths (Oulu SSO) still work once configured.
 *
 * Server-side only — reads the request's cookies via Next's cookies()
 * helper. Returns `{ user: null }` for anonymous visitors.
 */
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

export type UserRole = 'donor' | 'curator' | 'finance' | 'admin';

export interface AppSession {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
    locale: string;
  } | null;
}

export function isStaff(role: UserRole | undefined): boolean {
  return role === 'curator' || role === 'admin';
}

const COOKIE_NAME = 'bloomoulu.session';

export async function getSession(): Promise<AppSession> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (raw) {
    try {
      const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret');
      const { payload } = await jwtVerify(raw, secret, { algorithms: ['HS256'] });
      if (payload.sub && typeof payload.email === 'string') {
        return {
          user: {
            id: String(payload.sub),
            email: payload.email,
            name: typeof payload.name === 'string' ? payload.name : null,
            role: (payload.role as UserRole | undefined) ?? 'donor',
            locale: typeof payload.locale === 'string' ? payload.locale : 'en',
          },
        };
      }
    } catch {
      /* invalid/expired — fall through */
    }
  }
  // (Next-auth fallback is wired through but currently triggers
  // UnsupportedStrategy in dev when only the Credentials provider is
  // configured with database sessions. We re-enable it once OIDC is set
  // up; for now the HS256 cookie above carries every signed-in flow.)
  return { user: null };
}

/**
 * Clear the BloomOulu session cookie. Use from a Server Action or Route
 * Handler.
 */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
