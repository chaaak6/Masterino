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
});
