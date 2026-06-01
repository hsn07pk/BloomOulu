import type { NextRequest } from 'next/server';
import { getWebUrl } from '@bloomoulu/constants';

/**
 * Public origin of the current request, safe to put in a `Location` header.
 *
 * Why this exists: behind a reverse proxy (ngrok / Caddy / Cloudflare) the
 * Next.js standalone server sees its own bind address as the host, so
 * `new URL(path, req.url).origin` resolves to `http://0.0.0.0:3000` (or
 * `web:3000`). Redirecting there sends the browser to a dead host —
 * `https://0.0.0.0:3000/... → ERR_SSL_PROTOCOL_ERROR`.
 *
 * Resolution order:
 *   1. `X-Forwarded-Host` / `X-Forwarded-Proto` — set by the proxy to the real
 *      public host (e.g. the ngrok domain). Authoritative when present.
 *   2. `getWebUrl()` — the env-configured `NEXT_PUBLIC_WEB_URL` (single source
 *      of truth in prod; localhost in dev).
 *
 * Use this anywhere a route handler builds an absolute redirect back to the
 * site instead of `req.url`.
 */
export function publicOrigin(req: NextRequest): string {
  const xfHost = req.headers.get('x-forwarded-host');
  if (xfHost) {
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    // X-Forwarded-Host may be a comma-separated chain; the first is the client-facing host.
    const host = xfHost.split(',')[0]!.trim();
    if (host && !host.startsWith('0.0.0.0') && !host.startsWith('127.0.0.1')) {
      return `${proto}://${host}`;
    }
  }
  return getWebUrl().replace(/\/$/, '');
}
