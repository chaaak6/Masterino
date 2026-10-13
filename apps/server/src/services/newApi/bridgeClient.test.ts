// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NewApiBridgeError } from './bridgeClient';
import { NewApiBridgeClient } from './bridgeClient';

describe('NewApiBridgeClient', () => {
  beforeEach(() => {
    delete process.env.AIHUB_BRIDGE_URL;
    delete process.env.AIHUB_BRIDGE_TOKEN;
    delete process.env.AIHUB_MANAGED_TOKEN_NAME;
  });

  it('is disabled without bridge url or token', () => {
    expect(new NewApiBridgeClient().isEnabled()).toBe(false);
  });

  it('sends the service token when resolving users', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 7, username: 'ada' }, success: true }), {
        status: 200,
      }),
    );
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      fetchImpl: fetchImpl as any,
      token: 'bridge-secret',
    });

    const user = await client.findUserByIdentity({ username: 'ada' });

    expect(user).toEqual({ id: 7, username: 'ada' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://bridge:3218/v1/users/resolve?username=ada',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer bridge-secret' }),
      }),
    );
  });

  it('reads managed token from the bridge', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { id: 12, key: 'sk-managed', name: 'managed' }, success: true }),
          { status: 200 },
        ),
      );
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      fetchImpl: fetchImpl as any,
      token: 'bridge-secret',
    });

    const token = await client.findManagedToken(7, 'managed');

    expect(token?.key).toBe('sk-managed');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://bridge:3218/v1/users/7/managed-token?name=managed',
      expect.any(Object),
    );
  });

  it('reads the bound managed token by id', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { id: 12, key: 'sk-managed', user_id: 7 }, success: true }),
          { status: 200 },
        ),
      );
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      fetchImpl: fetchImpl as any,
      token: 'bridge-secret',
    });

    await expect(client.findManagedTokenById(7, 12)).resolves.toMatchObject({ id: 12, user_id: 7 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://bridge:3218/v1/users/7/managed-tokens/12',
      expect.any(Object),
    );
  });

  it('returns undefined for bridge 404 responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'not_found', message: 'missing' }, success: false }),
          { status: 404 },
        ),
      );
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      fetchImpl: fetchImpl as any,
      token: 'bridge-secret',
    });

    await expect(client.findUserById(7)).resolves.toBeUndefined();
  });

  it('queries models and usage logs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { tokenId: 12, models: ['gpt-4o-mini'] }, success: true }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { items: [{ id: 1 }], total: 1 }, success: true }), {
          status: 200,
        }),
      );
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      fetchImpl: fetchImpl as any,
      token: 'bridge-secret',
    });

    await expect(
      client.listAccessibleModels('vip', { id: 12, name: 'managed', user_id: 7 }),
    ).resolves.toEqual(['gpt-4o-mini']);
    await expect(client.getUsageLogs(7, { page: 2, pageSize: 5 })).resolves.toEqual({
      items: [{ id: 1 }],
      total: 1,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'http://bridge:3218/v1/users/7/models?tokenName=managed&tokenId=12',
      expect.any(Object),
    );
  });

  it('returns structured OAuth binding outcomes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { status: 'repaired' }, success: true }), {
        status: 200,
      }),
    );
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      fetchImpl: fetchImpl as any,
      token: 'bridge-secret',
    });

    await expect(client.linkOAuthBinding(27, '768164', 1)).resolves.toEqual({
      status: 'repaired',
    });
  });

  it('preserves OAuth binding conflict codes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'binding_conflict', message: 'provider_user_id_in_use' },
          success: false,
        }),
        { status: 409 },
      ),
    );
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      fetchImpl: fetchImpl as any,
      token: 'bridge-secret',
    });

    await expect(client.linkOAuthBinding(27, '768164', 1)).rejects.toMatchObject({
      code: 'binding_conflict',
      status: 409,
    } satisfies Partial<NewApiBridgeError>);
  });
});

it('rejects legacy or mismatched model responses that do not confirm the exact token', async () => {
  for (const data of [['other-token-model'], { tokenId: 99, models: ['other-token-model'] }]) {
    const client = new NewApiBridgeClient({
      baseUrl: 'http://bridge:3218',
      token: 'fixture-only',
      fetchImpl: async () => new Response(JSON.stringify({ success: true, data })),
    });
    await expect(
      client.listAccessibleModels(undefined, { id: 12, name: 'managed', user_id: 7 }),
    ).rejects.toThrow('verified bound-token');
  }
});
