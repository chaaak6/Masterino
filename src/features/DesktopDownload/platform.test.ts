import { describe, expect, it } from 'vitest';

import { detectDownloadTarget } from './platform';

describe('desktop installer platform detection', () => {
  it('selects the Windows installer', async () => {
    expect(await detectDownloadTarget({ userAgent: 'Windows NT 10.0' })).toBe('win32/x64');
  });
  it.each([
    ['arm', '64', 'darwin/arm64'],
    ['x86', '64', 'darwin/x64'],
  ])('uses Client Hints %s', async (architecture, bitness, expected) => {
    expect(
      await detectDownloadTarget({
        userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
        userAgentData: { getHighEntropyValues: async () => ({ architecture, bitness }) },
      }),
    ).toBe(expected);
  });
  it('does not mistake MacIntel UA for an Intel CPU', async () => {
    expect(await detectDownloadTarget({ userAgent: 'Macintosh; Intel Mac OS X 10_15_7' })).toBe(
      'mac',
    );
  });
  it('offers a choice when hints are denied', async () => {
    expect(
      await detectDownloadTarget({
        userAgent: 'Macintosh',
        userAgentData: {
          getHighEntropyValues: async () => {
            throw new Error('Denied');
          },
        },
      }),
    ).toBe('mac');
  });
  it.each(['Linux x86_64', 'iPhone', 'Android'])('does not download on %s', async (userAgent) => {
    expect(await detectDownloadTarget({ userAgent })).toBe('unsupported');
  });
  it('recognizes iPad desktop mode', async () => {
    expect(await detectDownloadTarget({ userAgent: 'Macintosh', maxTouchPoints: 5 })).toBe(
      'unsupported',
    );
  });
});
