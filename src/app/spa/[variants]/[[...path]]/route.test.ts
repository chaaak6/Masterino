// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'Masterino',
}));

vi.mock('@lobechat/const', () => ({
  OG_URL: 'https://example.com/og.png',
}));

const mocks = vi.hoisted(() => ({
  findWorkspaceBySlug: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({
  serverDB: {},
}));

vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: class {
    findBySlug = mocks.findWorkspaceBySlug;
  },
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

  it('returns a real 404 for a non-existent workspace-like root without rendering the SPA', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost:3210/spa/zh-CN__0/wp-admin'), {
      params: Promise.resolve({ path: ['wp-admin'], variants: 'zh-CN__0' }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.findWorkspaceBySlug).toHaveBeenCalledWith('wp-admin');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a workspace-shaped route when the workspace does not exist', async () => {
    mocks.findWorkspaceBySlug.mockResolvedValueOnce(undefined);
    vi.resetModules();

    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost:3210/spa/zh-CN__0/missing/settings'), {
      params: Promise.resolve({
        path: ['missing', 'settings'],
        variants: 'zh-CN__0',
      }),
    });

    expect(response.status).toBe(404);
    expect(mocks.findWorkspaceBySlug).toHaveBeenCalledWith('missing');
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

    await GET(new Request('http://localhost:3210/spa/zh-CN__1/agent'), {
      params: Promise.resolve({ path: ['agent'], variants: 'zh-CN__1' }),
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9876/index.mobile.html');
  });

  it('renders an existing workspace home route', async () => {
    mocks.findWorkspaceBySlug.mockResolvedValueOnce({ id: 'workspace-1' });
    vi.stubEnv('NODE_ENV', 'development');

    const fetchMock = vi.fn(async () => {
      return new Response(
        '<html><head><script>window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */</script></head><body><!--SEO_META--><!--ANALYTICS_SCRIPTS--></body></html>',
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost:3210/spa/zh-CN__0/acme'), {
      params: Promise.resolve({ path: ['acme'], variants: 'zh-CN__0' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.findWorkspaceBySlug).toHaveBeenCalledWith('acme');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9876/');
  });
});
