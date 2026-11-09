import { afterEach, expect, it, vi } from 'vitest';

import { openWecomDownloadPage } from './wecom';

afterEach(() => vi.unstubAllGlobals());
it('opens only the token-free same-origin download page after SDK authorization', async () => {
  let ready = () => {};
  const invoke = vi.fn((_method, _args, callback) =>
    callback({ err_msg: 'openDefaultBrowser:ok' }),
  );
  const agentConfig = vi.fn((options) => options.success());
  vi.stubGlobal('window', {
    location: {
      origin: 'https://mlai-test.bielcrystal.com',
      href: 'https://mlai-test.bielcrystal.com/?private=example#section',
    },
    wx: {
      ready: (callback: () => void) => {
        ready = callback;
      },
      error: vi.fn(),
      config: () => ready(),
      agentConfig,
      invoke,
    },
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          corpId: 'corp',
          agentId: 'agent',
          timestamp: 1,
          nonceStr: 'nonce',
          signature: 'corp-signature',
          agentSignature: 'agent-signature',
        }),
      ),
  );
  await openWecomDownloadPage();
  expect(agentConfig).toHaveBeenCalledWith(
    expect.objectContaining({ signature: 'agent-signature' }),
  );
  expect(invoke).toHaveBeenCalledWith(
    'openDefaultBrowser',
    { url: 'https://mlai-test.bielcrystal.com/download' },
    expect.any(Function),
  );
});
