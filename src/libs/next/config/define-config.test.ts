// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('defineConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('proxies Vite dev module paths through Next when hot same-origin mode is enabled', async () => {
    vi.stubEnv('NEXT_VITE_DEV_PROXY', '1');
    vi.stubEnv('VITE_DEV_INTERNAL_ORIGIN', 'http://localhost:9876');
    const { defineConfig } = await import('./define-config');

    const config = defineConfig({});
    const rewrites = await config.rewrites?.();

    expect(rewrites).toEqual(
      expect.arrayContaining([
        {
          destination: 'http://localhost:9876/@vite/:path*',
          source: '/@vite/:path*',
        },
        {
          destination: 'http://localhost:9876/src/:path*',
          source: '/src/:path*',
        },
        {
          destination: 'http://localhost:9876/node_modules/:path*',
          source: '/node_modules/:path*',
        },
        {
          destination: 'http://localhost:9876/package.json',
          source: '/package.json',
        },
        {
          destination: 'http://localhost:9876/packages/:path*',
          source: '/packages/:path*',
        },
        {
          destination: 'http://localhost:9876/apps/:path*',
          source: '/apps/:path*',
        },
        {
          destination: 'http://localhost:9876/locales/:path*',
          source: '/locales/:path*',
        },
      ]),
    );
  });

  it('sets baseline security headers and disables the framework signature', async () => {
    const { defineConfig } = await import('./define-config');
    const config = defineConfig({});
    const headerRules = await config.headers?.();
    const globalHeaders = headerRules?.find((rule) => rule.source === '/:path*')?.headers;

    expect(config.poweredByHeader).toBe(false);
    expect(globalHeaders).toEqual(
      expect.arrayContaining([
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ]),
    );
  });

  it('uses deny framing headers when CSP is enabled', async () => {
    vi.stubEnv('ENABLED_CSP', '1');
    const { defineConfig } = await import('./define-config');
    const config = defineConfig({});
    const headerRules = await config.headers?.();
    const globalHeaders = headerRules?.find((rule) => rule.source === '/:path*')?.headers;

    expect(globalHeaders).toEqual(
      expect.arrayContaining([{ key: 'X-Frame-Options', value: 'DENY' }]),
    );
    const csp = globalHeaders?.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it('does not expose production source maps or full fetch URLs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { defineConfig } = await import('./define-config');
    const config = defineConfig({});

    expect(config.productionBrowserSourceMaps).toBe(false);
    if (!config.logging || typeof config.logging === 'boolean') {
      throw new TypeError('Expected production logging configuration');
    }
    expect(config.logging.fetches).toMatchObject({
      fullUrl: false,
      hmrRefreshes: false,
    });

    const headerRules = await config.headers?.();
    const globalHeaders = headerRules?.find((rule) => rule.source === '/:path*')?.headers;
    expect(globalHeaders).toContainEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  });
});
