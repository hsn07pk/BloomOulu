import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

// ── Load the monorepo-root .env into process.env ─────────────────────
// Next.js auto-loads .env from the app directory (apps/web/) only — it
// doesn't walk up the tree. Without this our root `.env` (which holds
// AUTH_SECRET, DATABASE_URL, etc.) never reaches the dev server, so
// every `process.env.AUTH_SECRET ?? 'dev-secret'` in src/ silently uses
// 'dev-secret'. Web mints + verifies cookies with that fallback, but
// the API verifies with the *real* secret loaded by Nest's ConfigModule
// — mismatch → every /v1/users/.../garden call from SSR returns 401 →
// the page silently renders "No data yet." (exactly the symptom that
// triggered this fix).
//
// Node 20.12+ ships process.loadEnvFile(); it's the cleanest path here
// (no new dep, no symlink). Existing process.env wins, so Docker / CI
// / prod env injection still takes precedence.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(resolve(__dirname, '../../.env'));
} catch {
  // .env missing — expected in prod/CI where env comes from elsewhere.
}

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Skip ESLint in Docker builds — the kiosk hit a missing-plugin error
  // in the runner image. Typecheck still runs separately as the quality
  // gate.
  eslint: { ignoreDuringBuilds: true },
  // Compile workspace TS packages through Next's own pipeline so the
  // `.js`-extension imports they use (for Node ESM compatibility with the
  // API + worker) resolve here too. Without this, webpack treats them as
  // pre-built .js files and 404s on the `.js → .ts` lookup.
  transpilePackages: [
    '@bloomoulu/db',
    '@bloomoulu/payments',
    '@bloomoulu/emails',
    '@bloomoulu/rag',
    '@bloomoulu/i18n',
    '@bloomoulu/ui',
  ],
  webpack: (config) => {
    // Allow `import './foo.js'` to resolve to `./foo.ts` inside transpiled
    // workspace packages.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
      { protocol: 'https', hostname: 'files.bloomoulu.fi' },
      // Local API serves rehosted plant images at /v1/files/* (the new
      // local-disk storage backend — see apps/api/src/infra/storage.ts).
      { protocol: 'http', hostname: 'localhost', port: '4000' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  // Same-origin proxy for /v1/* and /webhooks/* so client-side fetches
  // and Paytrail callbacks both land on the same hostname as the web
  // app — no CORS, no DNS lag for a second tunnel subdomain. When
  // running behind Cloudflare Tunnel / Caddy / Vercel the public host
  // proxies these straight to the api container; in local dev Next.js
  // rewrites them to localhost:4000.
  async rewrites() {
    const target = process.env.API_REWRITE_TARGET ?? 'http://localhost:4000';
    return [
      { source: '/v1/:path*',       destination: `${target}/v1/:path*` },
      { source: '/webhooks/:path*', destination: `${target}/webhooks/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
