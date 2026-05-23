/**
 * Pick the right BloomOulu API URL for the current execution context.
 *
 * Inside the Docker network the public hostname (NEXT_PUBLIC_API_URL =
 * http://localhost:4000) doesn't resolve from the web container — that
 * URL points at the web container itself. INTERNAL_API_URL is set by
 * docker-compose to http://api:4000 so SSR / Route Handlers / Server
 * Actions can reach the api over the bridge network.
 *
 * Always use this helper for *server*-side fetches.
 *
 * For browser-side fetches (client components, useEffect, fetch from a
 * 'use client' module), use `getBrowserApiUrl` from @bloomoulu/constants
 * — the browser can only reach the host-published port.
 */
export { getInternalApiUrl as internalApiUrl } from '@bloomoulu/constants';
