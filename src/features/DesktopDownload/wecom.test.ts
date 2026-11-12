import { afterEach, expect, it, vi } from 'vitest';

import { openWecomDownloadPage } from './wecom';

afterEach(() => vi.unstubAllGlobals());
it('opens only the token-free same-origin download page after SDK authorization', async () => {
  let ready = () => {};
  const invoke = vi.fn((_method, _args, callback) => callback({ errMsg: 'openDefaultBrowser:ok' }));
  const agentConfig = vi.fn(() => {
    throw new Error('App identity unavailable');
  });
  const sdk = {
    agentConfig,
    config: vi.fn(() => {
      ready();
      sdk.invoke = invoke;
    }),
    error: vi.fn(),
    invoke: undefined as typeof invoke | undefined,
    ready: (callback: () => void) => {
      ready = callback;
    },
  };
  vi.stubGlobal('window', {
    location: {
      origin: 'https://mlai-test.bielcrystal.com',
      href: 'https://mlai-test.bielcrystal.com/?private=example#section',
    },
    wx: sdk,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        corpId: 'corp',
        timestamp: 1,
        nonceStr: 'nonce',
        signature: 'corp-signature',
      }),
    ),
  );
  await openWecomDownloadPage();
  expect(agentConfig).not.toHaveBeenCalled();
  expect(sdk.config).toHaveBeenCalledWith(expect.objectContaining({ beta: true }));
  expect(invoke).toHaveBeenCalledWith(
    'openDefaultBrowser',
    { url: 'https://mlai-test.bielcrystal.com/download' },
    expect.any(Function),
  );
});

it('rejects an incomplete SDK before waiting for its callback timeout', async () => {
  vi.resetModules();
  let ready = () => {};
  vi.stubGlobal('window', {
    location: { origin: 'https://test.example', href: 'https://test.example/download' },
    wx: {
      config: () => ready(),
      error: vi.fn(),
      ready: (callback: () => void) => {
        ready = callback;
      },
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
  const { openWecomDownloadPage: open } = await import('./wecom');
  await expect(open()).rejects.toThrow('https://test.example/download');
});

it('routes asynchronous SDK callback exceptions to the caller', async () => {
  vi.resetModules();
  let ready = () => {};
  vi.stubGlobal('window', {
    location: { origin: 'https://test.example', href: 'https://test.example/download' },
    wx: {
      ready: (callback: () => void) => {
        ready = callback;
      },
      config: () => {
        queueMicrotask(() => ready());
      },
      error: vi.fn(),
      invoke: () => {
        throw new Error('SDK failure');
      },
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
  const { openWecomDownloadPage: open } = await import('./wecom');
  await expect(open()).rejects.toThrow('https://test.example/download');
});
