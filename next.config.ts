import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;
const buildCpus = Number(process.env.MASTERINO_BUILD_CPUS);

const vercelConfig = {
  // Vercel serverless optimization: exclude musl binaries from all routes
  // Vercel uses Amazon Linux (glibc), not Alpine Linux (musl)
  // This saves ~45MB (29MB canvas-musl + 16MB sharp-musl) per serverless function
  outputFileTracingExcludes: {
    '*': [
      'node_modules/.pnpm/@napi-rs+canvas-*-musl*',
      'node_modules/.pnpm/@img+sharp-libvips-*musl*',
      // Exclude SPA/desktop/mobile build artifacts from serverless functions
      'public/_spa/**',
      'dist/desktop/**',
      'dist/mobile/**',
      'apps/desktop/**',
      'packages/database/migrations/**',
    ],
  },
};
const nextConfig = defineConfig({
  ...(isVercel ? vercelConfig : {}),
  ...(Number.isInteger(buildCpus) && buildCpus > 0 ? { experimental: { cpus: buildCpus } } : {}),
});

if (process.env.NODE_ENV === 'development' && process.env.MASTERINO_DEV_ENV === 'local') {
  nextConfig.distDir = '.local-dev/cache/next';
  nextConfig.experimental = {
    ...nextConfig.experimental,
    turbopackMemoryLimit: 2 * 1024 * 1024 * 1024,
  };
}

export default nextConfig;
