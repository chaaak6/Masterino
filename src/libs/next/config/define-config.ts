import { codeInspectorPlugin } from 'code-inspector-plugin';
import { type NextConfig } from 'next';
import { type Header, type Redirect, type Rewrite } from 'next/dist/lib/load-custom-routes';

const LANDING_SITEMAP_URL = 'https://aihub.bielcrystal.com/sitemap.xml';

interface CustomNextConfig {
  experimental?: NextConfig['experimental'];
  headers?: Header[];
  outputFileTracingExcludes?: NextConfig['outputFileTracingExcludes'];
  outputFileTracingIncludes?: NextConfig['outputFileTracingIncludes'];
  redirects?: Redirect[];
  rewrites?: NextConfig['rewrites'];
  serverExternalPackages?: NextConfig['serverExternalPackages'];
  turbopack?: NextConfig['turbopack'];
  webpack?: NextConfig['webpack'];
}

const createViteDevProxyRewrites = (): Rewrite[] => {
  if (process.env.NEXT_VITE_DEV_PROXY !== '1') return [];

  const viteOrigin = process.env.VITE_DEV_INTERNAL_ORIGIN || 'http://localhost:9876';

  return [
    {
      destination: `${viteOrigin}/@vite/:path*`,
      source: '/@vite/:path*',
    },
    {
      destination: `${viteOrigin}/@react-refresh`,
      source: '/@react-refresh',
    },
    {
      destination: `${viteOrigin}/@id/:path*`,
      source: '/@id/:path*',
    },
    {
      destination: `${viteOrigin}/@fs/:path*`,
      source: '/@fs/:path*',
    },
    {
      destination: `${viteOrigin}/node_modules/:path*`,
      source: '/node_modules/:path*',
    },
    {
      destination: `${viteOrigin}/package.json`,
      source: '/package.json',
    },
    {
      destination: `${viteOrigin}/packages/:path*`,
      source: '/packages/:path*',
    },
    {
      destination: `${viteOrigin}/apps/:path*`,
      source: '/apps/:path*',
    },
    {
      destination: `${viteOrigin}/locales/:path*`,
      source: '/locales/:path*',
    },
    {
      destination: `${viteOrigin}/src/:path*`,
      source: '/src/:path*',
    },
  ];
};

export function defineConfig(config: CustomNextConfig) {
  const isProd = process.env.NODE_ENV === 'production';
  const buildWithDocker = process.env.DOCKER === 'true';

  const shouldUseCSP = process.env.ENABLED_CSP === '1';

  const isTest =
    process.env.NODE_ENV === 'test' || process.env.TEST === '1' || process.env.E2E === '1';

  const isStandaloneMode = buildWithDocker || process.env.NEXT_BUILD_STANDALONE === '1';

  const standaloneConfig: NextConfig = {
    output: 'standalone',

    outputFileTracingIncludes: {
      '*': [
        'public/**/*',
        '.next/static/**/*',

        // Only needed for Docker standalone builds.
        // On Vercel (serverless), including native bindings can easily exceed function size limits.
        ...(buildWithDocker
          ? [
              // Exclude SPA/desktop/mobile build artifacts from serverless functions
              'public/_spa/**',
              'dist/desktop/**',
              'dist/mobile/**',

              'packages/database/migrations/**',

              // Ensure native bindings are included in standalone output.
              // `@napi-rs/canvas` is loaded via dynamic `require()` (see packages/file-loaders),
              // which may not be picked up by Next.js output tracing.
              'node_modules/@napi-rs/canvas/**/*',
              'node_modules/@napi-rs/canvas-*/**/*',
              // pnpm real package locations (including platform-specific bindings with `.node`)
              'node_modules/.pnpm/@napi-rs+canvas*/**/*',
              'node_modules/.pnpm/@napi-rs+canvas-*/**/*',
            ]
          : []),
      ],
    },
  };

  const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;

  const nextConfig: NextConfig = {
    ...(isStandaloneMode ? standaloneConfig : {}),
    assetPrefix,

    compiler: {
      emotion: true,
    },
    compress: isProd,
    experimental: {
      optimizePackageImports: [
        'emoji-mart',
        '@emoji-mart/react',
        '@emoji-mart/data',
        '@icons-pack/react-simple-icons',
        '@lobehub/ui',
        '@lobehub/icons',
      ],
      // oidc provider depend on constructor.name
      // but swc minification will remove the name
      // so we need to disable it
      // refs: https://github.com/lobehub/lobe-chat/pull/7430
      serverMinification: false,
      webVitalsAttribution: ['CLS', 'LCP'],
      ...config.experimental,
    },
    async headers() {
      const securityHeaders = [
        {
          key: 'x-robots-tag',
          value: 'all',
        },
      ];

      if (shouldUseCSP) {
        securityHeaders.push(
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none';",
          },
        );
      }

      return [
        {
          headers: securityHeaders,
          source: '/:path*',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/icons/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/images/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/videos/(.*).(mp4|webm|ogg|avi|mov|wmv|flv|mkv)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/screenshots/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/og/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/favicon.ico',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/favicon-32x32.ico',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/apple-touch-icon.png',
        },
        // Passkey configuration files for iOS and Android
        {
          headers: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Cache-Control',
              value: 'public, max-age=3600',
            },
          ],
          source: '/.well-known/apple-app-site-association',
        },
        {
          headers: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Cache-Control',
              value: 'public, max-age=3600',
            },
          ],
          source: '/.well-known/assetlinks.json',
        },
        ...(config.headers ?? []),
      ];
    },
    logging: {
      fetches: {
        fullUrl: true,
        hmrRefreshes: true,
      },
    },
    ...(config.outputFileTracingExcludes && {
      outputFileTracingExcludes: config.outputFileTracingExcludes,
    }),
    ...(config.outputFileTracingIncludes && {
      outputFileTracingIncludes: config.outputFileTracingIncludes,
    }),
    reactStrictMode: true,
    redirects: async () => [
      // Sitemap generation lives on the landing site; keep legacy app sitemap URLs crawlable.
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap.xml',
      },
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap-0.xml',
      },
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap-index.xml',
      },
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap/:path*',
      },
      {
        destination: '/manifest.webmanifest',
        permanent: true,
        source: '/manifest.json',
      },
      {
        destination: '/community/agent',
        permanent: true,
        source: '/community/assistants',
      },
      {
        destination: '/community/plugin',
        permanent: true,
        source: '/community/plugins',
      },
      {
        destination: '/community/model',
        permanent: true,
        source: '/community/models',
      },
      {
        destination: '/community/provider',
        permanent: true,
        source: '/community/providers',
      },
      // Legacy redirects from /discover to /community
      {
        destination: '/community',
        permanent: true,
        source: '/discover',
      },
      {
        destination: '/community/:path*',
        permanent: true,
        source: '/discover/:path*',
      },
      // {
      //   destination: '/settings/common',
      //   permanent: true,
      //   source: '/settings',
      // },
      // we need back /repos url in the further
      {
        destination: '/files',
        permanent: false,
        source: '/repos',
      },
      {
        destination: '/',
        permanent: true,
        source: '/chat',
      },
      // Redirect old Clerk login route to Better Auth signin
      {
        destination: '/signin',
        permanent: true,
        source: '/login',
      },
      ...(config.redirects ?? []),
    ],
    rewrites: async () => {
      const viteProxyRewrites = createViteDevProxyRewrites();
      const configuredRewrites =
        typeof config.rewrites === 'function' ? await config.rewrites() : undefined;

      if (!configuredRewrites) return viteProxyRewrites;
      if (Array.isArray(configuredRewrites)) return [...viteProxyRewrites, ...configuredRewrites];

      return {
        ...configuredRewrites,
        beforeFiles: [...viteProxyRewrites, ...(configuredRewrites.beforeFiles ?? [])],
      };
    },
    // when external packages in dev mode with turbopack, this config will lead to bundle error
    // @napi-rs/canvas is a native module that can't be bundled by Turbopack
    // pdfjs-dist uses @napi-rs/canvas for DOMMatrix polyfill in Node.js environment
    serverExternalPackages: config.serverExternalPackages ?? [
      'pdfkit',
      '@napi-rs/canvas',
      '@lobehub/editor',
      '@chat-adapter/discord',
      '@discordjs/ws',
      '@lobechat/observability-otel',
      'discord.js',
      'ffmpeg-static',
      'pdfjs-dist',
      'zlib-sync',
      'ajv',
      'oidc-provider',
      '@grpc/grpc-js',
      '@grpc/proto-loader',
      '@opentelemetry/auto-instrumentations-node',
      '@opentelemetry/exporter-jaeger',
      '@opentelemetry/exporter-logs-otlp-grpc',
      '@opentelemetry/exporter-metrics-otlp-grpc',
      '@opentelemetry/exporter-trace-otlp-grpc',
      '@opentelemetry/sdk-node',
      '@opentelemetry/winston-transport',
    ],

    transpilePackages: ['mermaid'],
    webpack: (webpackConfig, options) => {
      webpackConfig.module.rules.push({
        test: /\.md$/i,
        type: 'asset/source',
      });

      return config.webpack ? config.webpack(webpackConfig, options) : webpackConfig;
    },
    turbopack: {
      rules: {
        ...(isTest
          ? void 0
          : codeInspectorPlugin({
              bundler: 'turbopack',
              hotKeys: ['altKey', 'ctrlKey'],
            })),
        '*.md': {
          as: '*.js',
          loaders: ['raw-loader'],
        },
      },
      ...config.turbopack,
    },

    typescript: {
      ignoreBuildErrors: true,
    },
  };

  return nextConfig;
}
