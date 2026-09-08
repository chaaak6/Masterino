import { describe, expect, it, vi } from 'vitest';

import { withRequestBodyBudget } from './requestBodyBudget';

describe('serialized request budget', () => {
  it('rejects SDK serialized base64 before the real fetch on every attempt', async () => {
    const network = vi.fn();
    const guarded = withRequestBodyBudget(network, 100);
    for (let retry = 0; retry < 2; retry++)
      await expect(
        guarded('https://model.test', {
          method: 'POST',
          body: JSON.stringify({ image_url: 'data:image/png;base64,' + 'a'.repeat(200) }),
        }),
      ).rejects.toThrow('exceeds');
    expect(network).not.toHaveBeenCalled();
  });
  it('counts UTF-8 bytes and supports Request bodies', async () => {
    const network = vi.fn().mockResolvedValue(new Response('ok'));
    await expect(
      withRequestBodyBudget(
        network,
        5,
      )(new Request('https://model.test', { method: 'POST', body: '你好' })),
    ).rejects.toThrow('exceeds');
    await withRequestBodyBudget(network, 10)('https://model.test', { method: 'POST', body: 'ok' });
    expect(network).toHaveBeenCalledTimes(1);
  });
});
