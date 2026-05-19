/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
