/**
 * Centralised URL helpers — every workspace reads localhost fallbacks
 * through these so changing the dev port is a one-place edit. Production
 * deployments always set the env vars, so the literal fallbacks only
 * matter for dev / tests.
 */

const DEFAULT_API_URL = 'http://localhost:4000';
const DEFAULT_WEB_URL = 'http://localhost:3000';
const DEFAULT_ADMIN_URL = 'http://localhost:4100';
const DEFAULT_KIOSK_URL = 'http://localhost:3100';

/**
 * Returns the API base URL for use from a server-side context (Next.js RSC,
 * server actions, NestJS workers). Prefers the in-cluster URL so SSR works
 * under Docker compose.
 */
export function getInternalApiUrl(): string {
  return (
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL
  );
}

/**
 * Returns the API base URL the BROWSER should call. Always reads the public
 * env var so the value is inlined at build time.
 */
export function getBrowserApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

/** Returns the public web base URL — used for absolute URLs in emails, PDFs, payment redirects. */
export function getWebUrl(): string {
  return process.env.NEXT_PUBLIC_WEB_URL ?? DEFAULT_WEB_URL;
}

/** Returns the AdminJS base URL. */
export function getAdminUrl(): string {
  return process.env.NEXT_PUBLIC_ADMIN_URL ?? DEFAULT_ADMIN_URL;
}

/** Returns the kiosk base URL. */
export function getKioskUrl(): string {
  return process.env.NEXT_PUBLIC_KIOSK_URL ?? DEFAULT_KIOSK_URL;
}
