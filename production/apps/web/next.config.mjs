import createNextIntlPlugin from 'next-intl/plugin';

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
      // Local MinIO object store — serves re-hosted plant images in dev.
      { protocol: 'http', hostname: 'localhost', port: '9000' },
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
};

export default withNextIntl(nextConfig);
