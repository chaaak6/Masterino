import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetWecomSsoRuntimeConfig } = vi.hoisted(() => ({
  mockGetWecomSsoRuntimeConfig: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://app.example.com',
  },
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_WECOM_AGENT_ID: '1000002',
    AUTH_WECOM_CORP_ID: 'ww-corp',
    AUTH_WECOM_CORP_SECRET: 'corp-secret',
  },
}));

vi.mock('@/server/services/enterprise/wecomSsoService', () => ({
  getWecomSsoRuntimeConfig: mockGetWecomSsoRuntimeConfig,
}));

const jsonResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });

describe('WeCom SSO provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWecomSsoRuntimeConfig.mockResolvedValue({
      agentId: '1000002',
      corpId: 'ww-corp',
      corpSecret: 'corp-secret',
      enabled: true,
      enabledModes: ['web_qr', 'workbench'],
      redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
    });
  });

  it('fetches private profile fields with user_ticket before falling back to address book lookup', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          UserId: 'E001',
          errcode: 0,
          user_ticket: 'ticket-001',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          avatar: 'https://cdn.example.com/avatar.png',
          email: 'employee@example.com',
          errcode: 0,
          name: 'Employee One',
          userid: 'E001',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { default: provider } = await import('./wecom');
    const env = provider.checkEnvs();
    if (!env) throw new Error('Expected WeCom env vars to be available in test');

    const builtProvider = provider.build(env);
    const tokens = await builtProvider.getToken!({ code: 'login-code' } as never);
    const profile = await builtProvider.getUserInfo!(tokens as never);

    expect(profile).toEqual(
      expect.objectContaining({
        email: 'employee@example.com',
        emailVerified: true,
        id: 'E001',
        image: 'https://cdn.example.com/avatar.png',
        name: 'Employee One',
        username: 'E001',
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://qyapi.weixin.qq.com/cgi-bin/auth/getuserdetail?access_token=access-token',
      expect.objectContaining({
        body: JSON.stringify({ user_ticket: 'ticket-001' }),
        cache: 'no-store',
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
