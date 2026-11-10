// @vitest-environment node
import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('@/auth', () => ({
  auth: { api: { getSession: async () => ({ user: { id: 'test-user' } }) } },
}));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://mlai-test.bielcrystal.com' } }));
vi.mock('@/server/services/enterprise/wecomSsoService', () => ({
  getWecomSsoRuntimeConfig: async () => ({
    corpId: 'corp',
    agentId: 'agent',
    corpSecret: 'private-secret',
  }),
}));
const request = (url: string) =>
  new Request('https://mlai-test.bielcrystal.com/api/desktop/wecom-browser', {
    method: 'POST',
    headers: { 'Origin': 'https://mlai-test.bielcrystal.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
afterEach(() => vi.restoreAllMocks());
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
  it('returns a retryable failure when WeCom rejects credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ errcode: 40001 }));
    expect((await POST(request('https://mlai-test.bielcrystal.com/'))).status).toBe(503);
  });
});
