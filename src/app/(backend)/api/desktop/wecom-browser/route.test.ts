// @vitest-environment node
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/auth', () => ({ auth: { api: { getSession } } }));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://mlai-test.bielcrystal.com' } }));
vi.mock('@/server/services/enterprise/wecomSsoService', () => ({
  getWecomSsoRuntimeConfig: async () => ({
    corpId: 'corp',
    agentId: 'agent',
    corpSecret: 'private-secret',
  }),
}));
const appOrigin = 'https://mlai-test.bielcrystal.com';
const adminHost = 'admin-mlai-test.bielcrystal.com';
const request = (url: string, origin = appOrigin, forwardedHost?: string) =>
  new Request('https://mlai-test.bielcrystal.com/api/desktop/wecom-browser', {
    method: 'POST',
    headers: {
      'Origin': origin,
      'Content-Type': 'application/json',
      ...(forwardedHost && { 'x-forwarded-host': forwardedHost, 'x-forwarded-proto': 'https' }),
    },
    body: JSON.stringify({ url }),
  });
beforeEach(() => {
  getSession.mockResolvedValue({ user: { id: 'test-user' } });
  vi.stubEnv('APP_URL_DYNAMIC', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const enableDynamicHosts = () => {
  vi.stubEnv('APP_URL_DYNAMIC', '1');
  vi.stubEnv('APP_URL_ALLOWED_HOSTS', `mlai-test.bielcrystal.com,${adminHost}`);
};
describe('WeCom download browser signature', () => {
  it('rejects signing another origin before contacting WeCom', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await POST(request('https://example.com/'))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('signs the page without exposing credentials or tickets', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ access_token: 'private-token' }))
      .mockResolvedValueOnce(Response.json({ ticket: 'corp-ticket' }))
      .mockResolvedValueOnce(Response.json({ ticket: 'agent-ticket' }));
    const response = await POST(request('https://mlai-test.bielcrystal.com/?a=1#section'));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.signature).toBe(
      createHash('sha1')
        .update(
          `jsapi_ticket=corp-ticket&noncestr=${result.nonceStr}&timestamp=${result.timestamp}&url=https://mlai-test.bielcrystal.com/?a=1`,
        )
        .digest('hex'),
    );
    expect(JSON.stringify(result)).not.toMatch(/private-|corp-ticket|agent-ticket/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('signs a page on an explicitly allowed forwarded host', async () => {
    enableDynamicHosts();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ access_token: 'private-token' }))
      .mockResolvedValueOnce(Response.json({ ticket: 'corp-ticket' }))
      .mockResolvedValueOnce(Response.json({ ticket: 'agent-ticket' }));
    const origin = `https://${adminHost}`;
    expect((await POST(request(`${origin}/`, origin, adminHost))).status).toBe(200);
  });
  it('rejects an unlisted forwarded host or a mismatched Origin', async () => {
    enableDynamicHosts();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const denied = 'https://unlisted.example.com';
    expect((await POST(request(`${denied}/`, denied, 'unlisted.example.com'))).status).toBe(400);
    expect((await POST(request(`https://${adminHost}/`, appOrigin, adminHost))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps signing unavailable to anonymous users', async () => {
    getSession.mockResolvedValueOnce(null);
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await POST(request(`${appOrigin}/`))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns a retryable failure when WeCom rejects credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ errcode: 40001 }));
    expect((await POST(request('https://mlai-test.bielcrystal.com/'))).status).toBe(503);
  });
});
