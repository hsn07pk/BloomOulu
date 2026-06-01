import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the monorepo-root .env into process.env. Next.js only auto-loads
// .env from the app directory (apps/kiosk/) — without this the dev
// process silently falls back to 'dev-secret' / undefined for shared
// env vars. See apps/web/next.config.mjs for the full rationale.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(resolve(__dirname, '../../.env'));
} catch {
  // .env missing — expected in prod/CI.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Served under /kiosk on the single public host (ngrok), proxied by the web
  // app's rewrite (see apps/web/next.config.mjs). basePath prefixes every route
  // AND asset (/kiosk/_next/*) so it never collides with the web app at root.
  // Safe because every outbound link uses an absolute WEB_URL/API_URL.
  basePath: '/kiosk',
  reactStrictMode: true,
  // The kiosk's ESLint config references react-hooks/exhaustive-deps,
  // a rule that the Docker build's pnpm resolution can't always load
  // from the workspace eslint config. Type-checking runs as a separate
  // gate; skip ESLint at build time so this won't block the production
  // image.
  eslint: { ignoreDuringBuilds: true },
  // See apps/web/next.config.mjs for the rationale on transpilePackages +
  // extensionAlias — workspace packages use `.js` imports for Node ESM,
  // we map them back to `.ts` for the Next webpack build.
  transpilePackages: [
    '@bloomoulu/db',
    '@bloomoulu/payments',
    '@bloomoulu/emails',
    '@bloomoulu/rag',
    '@bloomoulu/i18n',
    '@bloomoulu/ui',
  ],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};
export default nextConfig;
