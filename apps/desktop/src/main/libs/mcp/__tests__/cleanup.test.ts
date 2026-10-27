import { describe, expect, it, vi } from 'vitest';

import { MCPClient } from '../client';

describe('MCP cleanup', () => {
  it('retries a failed disconnect', async () => {
    const client = new MCPClient({ name: 'test', type: 'http', url: 'https://example.com/mcp' });
    const close = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    (client as any).transport.close = close;
    await expect(client.disconnect()).rejects.toThrow('temporary failure');
    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });
});
