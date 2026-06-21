// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'MasterLion',
}));

vi.mock('@lobechat/const', () => ({
  OG_URL: 'https://example.com/og.png',
}));

vi.mock('@/config/featureFlags', () => ({
  getServerFeatureFlagsValue: vi.fn(() => ({})),
}));

vi.mock('@/const/url', () => ({
  OFFICIAL_URL: 'https://example.com',
}));

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('@/envs/app', () => ({
  appEnv: {},
}));

vi.mock('@/envs/file', () => ({
  fileEnv: {},
}));

vi.mock('@/envs/python', () => ({
  pythonEnv: {},
}));

vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: vi.fn(async () => ({})),
}));

vi.mock('@/server/translation', () => ({
  translation: vi.fn(async () => ({
    t: (key: string, values?: Record<string, string>) => `${key}:${values?.appName || ''}`,
  })),
}));

describe('SPA route template selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('fetches the mobile Vite HTML entry for mobile variants in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const fetchMock = vi.fn(async () => {
      return new Response(
        '<html><head><script>window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */</script></head><body><!--SEO_META--><!--ANALYTICS_SCRIPTS--></body></html>',
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { GET } = await import('./route');

    await GET(new Request('http://localhost:3210/spa/zh-CN__1/chat'), {
      params: Promise.resolve({ path: ['chat'], variants: 'zh-CN__1' }),
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9876/index.mobile.html');
  });
});
