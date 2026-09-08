// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import manifest from './manifest.fixture.json';
import { GET } from './route';

afterEach(() => vi.restoreAllMocks());
describe('desktop download manifest', () => {
  it('verifies the published signature and returns all three installer URLs', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(manifest));
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.version).toBe('1.2.7');
    expect(
      data.artifacts
        .map((a: { platform: string; arch: string }) => `${a.platform}/${a.arch}`)
        .sort(),
    ).toEqual(['darwin/arm64', 'darwin/x64', 'win32/x64']);
    expect(
      data.artifacts.every((a: { url: string }) =>
        a.url.startsWith(
          'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/1.2.7/',
        ),
      ),
    ).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain('/canary/canary.json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects a tampered manifest', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ...manifest, signature: 'AAAA' }),
    );
    expect((await GET()).status).toBe(503);
  });
  it('reports OSS failure without leaking upstream details', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('upstream private details'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'DOWNLOAD_UNAVAILABLE' });
  });
});
