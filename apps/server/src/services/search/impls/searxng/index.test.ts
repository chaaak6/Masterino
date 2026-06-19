// @vitest-environment node
import { SEARCH_SEARXNG_NOT_CONFIG } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toolsEnv } from '@/envs/tools';

import { SearXNGClient } from './client';
import { hetongxue } from './fixtures/searXNG';
import { SearXNGImpl } from './index';

vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    SEARXNG_URL: 'https://demo.com',
  },
}));

describe('SearXNGImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toolsEnv).SEARXNG_URL = 'https://demo.com';
  });

  it('returns normalized SearXNG search results', async () => {
    vi.spyOn(SearXNGClient.prototype, 'search').mockResolvedValueOnce(hetongxue);

    const searchImpl = new SearXNGImpl();
    const results = await searchImpl.query('何同学');

    expect(results.results.length).toEqual(43);
  });

  it('throws a clear local configuration error when SEARXNG_URL is missing', async () => {
    vi.mocked(toolsEnv).SEARXNG_URL = undefined;

    await expect(new SearXNGImpl().query('test')).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      message: SEARCH_SEARXNG_NOT_CONFIG,
    });
  });
});
