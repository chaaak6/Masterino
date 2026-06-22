import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { mockGetWecomSsoRuntimeConfig } = vi.hoisted(() => ({
  mockGetWecomSsoRuntimeConfig: vi.fn(),
}));

vi.mock('@/server/services/enterprise/wecomSsoService', () => ({
  getWecomSsoRuntimeConfig: mockGetWecomSsoRuntimeConfig,
}));

const makeReq = (query: string, headers: Record<string, string> = {}) =>
  ({
    headers: new Headers(headers),
    nextUrl: new URL(`https://app.example.com/oauth/wecom/authorize?${query}`),
  }) as any;

describe('WeCom OAuth authorize proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWecomSsoRuntimeConfig.mockResolvedValue({
      agentId: '1000002',
      corpId: 'ww-corp',
      corpSecret: 'secret',
      enabled: true,
      enabledModes: ['web_qr'],
      redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
    });
  });

  it('redirects to WeCom qrConnect with runtime DB config and OAuth state', async () => {
    const response = await GET(makeReq('state=state-1&redirect_uri=https%3A%2F%2Fignored.example.com'));
    const location = response.headers.get('location');

    expect(response.status).toBe(302);
    expect(location).toBeTruthy();

    const redirect = new URL(location!);
    expect(redirect.origin + redirect.pathname).toBe(
      'https://open.work.weixin.qq.com/wwopen/sso/qrConnect',
    );
    expect(redirect.searchParams.get('appid')).toBe('ww-corp');
    expect(redirect.searchParams.get('agentid')).toBe('1000002');
    expect(redirect.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/auth/oauth2/callback/wecom',
    );
    expect(redirect.searchParams.get('response_type')).toBe('code');
    expect(redirect.searchParams.get('scope')).toBe('snsapi_login');
    expect(redirect.searchParams.get('state')).toBe('state-1');
  });

  it('redirects workbench mode to WeCom OAuth with private profile scope', async () => {
    mockGetWecomSsoRuntimeConfig.mockResolvedValue({
      agentId: '1000002',
      corpId: 'ww-corp',
      corpSecret: 'secret',
      enabled: true,
      enabledModes: ['web_qr', 'workbench'],
      redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
    });

    const response = await GET(makeReq('mode=workbench&state=state-2'));
    const location = response.headers.get('location');

    expect(response.status).toBe(302);
    expect(location).toBeTruthy();

    const redirect = new URL(location!);
    expect(redirect.origin + redirect.pathname).toBe(
      'https://open.weixin.qq.com/connect/oauth2/authorize',
    );
    expect(redirect.hash).toBe('#wechat_redirect');
    expect(redirect.searchParams.get('appid')).toBe('ww-corp');
    expect(redirect.searchParams.get('agentid')).toBe('1000002');
    expect(redirect.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/auth/oauth2/callback/wecom',
    );
    expect(redirect.searchParams.get('response_type')).toBe('code');
    expect(redirect.searchParams.get('scope')).toBe('snsapi_privateinfo');
    expect(redirect.searchParams.get('state')).toBe('state-2');
  });

  it('auto-selects workbench mode inside Enterprise WeChat when enabled', async () => {
    mockGetWecomSsoRuntimeConfig.mockResolvedValue({
      agentId: '1000002',
      corpId: 'ww-corp',
      corpSecret: 'secret',
      enabled: true,
      enabledModes: ['web_qr', 'workbench'],
      redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
    });

    const response = await GET(
      makeReq('state=state-3', {
        'user-agent':
          'Mozilla/5.0 MicroMessenger/8.0.0 wxwork/4.1.0 Language/zh_CN WindowsWechat',
      }),
    );
    const location = response.headers.get('location');

    expect(response.status).toBe(302);
    expect(location).toContain('https://open.weixin.qq.com/connect/oauth2/authorize');
    expect(new URL(location!).searchParams.get('scope')).toBe('snsapi_privateinfo');
  });

  it('returns a safe error when runtime config is disabled or incomplete', async () => {
    mockGetWecomSsoRuntimeConfig.mockRejectedValue(new Error('WeCom SSO is disabled'));

    const response = await GET(makeReq('state=state-1'));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('WeCom SSO is disabled');
  });

  it('rejects authorize requests when web QR login is not enabled', async () => {
    mockGetWecomSsoRuntimeConfig.mockResolvedValue({
      agentId: '1000002',
      corpId: 'ww-corp',
      corpSecret: 'secret',
      enabled: true,
      enabledModes: ['workbench'],
      redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
    });

    const response = await GET(makeReq('state=state-1'));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('WeCom web QR login is not enabled');
  });

  it('rejects explicit workbench authorize requests when workbench login is not enabled', async () => {
    const response = await GET(makeReq('mode=workbench&state=state-1'));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('WeCom workbench login is not enabled');
  });

  it('does not leak unknown internal errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetWecomSsoRuntimeConfig.mockRejectedValue(new Error('database password leaked'));

    const response = await GET(makeReq('state=state-1'));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('WeCom SSO authorization failed');
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
