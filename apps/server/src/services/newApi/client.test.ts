// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewApiClient } from './client';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init,
  });

describe('NewApiClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('calls management endpoints with both bearer token and New-Api-User headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 42, quota: 100 }, success: true }));
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal/',
      fetchImpl: fetchMock,
    });

    const result = await client.getSelf({ accessToken: 'user-access-token', newApiUserId: 42 });

    expect(result).toEqual({ id: 42, quota: 100 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihub.internal/api/user/self',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer user-access-token',
          'New-Api-User': '42',
        }),
        method: 'GET',
      }),
    );
  });

  it('normalizes managed token keys for OpenAI-compatible token usage calls', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { total_available: 10, total_granted: 40, total_used: 30 },
        success: true,
      }),
    );
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal',
      fetchImpl: fetchMock,
    });

    await client.getTokenUsage('plain-token-key');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihub.internal/api/usage/token/',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-plain-token-key',
        }),
      }),
    );
  });

  it('throws a useful error when Aihub returns an unsuccessful response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: 'invalid access token', success: false }, { status: 401 }),
    );
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal',
      fetchImpl: fetchMock,
    });

    await expect(
      client.getSelf({ accessToken: 'bad-token', newApiUserId: 42 }),
    ).rejects.toMatchObject({
      message: 'invalid access token',
      status: 401,
    });
  });

  it('searches users with administrator management auth', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          items: [{ email: 'ada@example.com', id: 7, username: 'ada' }],
          total: 1,
        },
        success: true,
      }),
    );
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal',
      fetchImpl: fetchMock,
    });

    const result = await client.searchUsers(
      { accessToken: 'admin-access-token', newApiUserId: 1 },
      { keyword: 'ada@example.com', page: 2, pageSize: 20 },
    );

    expect(result.items).toEqual([{ email: 'ada@example.com', id: 7, username: 'ada' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihub.internal/api/user/search?keyword=ada%40example.com&p=2&size=20',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-access-token',
          'New-Api-User': '1',
        }),
        method: 'GET',
      }),
    );
  });

  it('creates users with administrator management auth', async () => {
    const input = {
      display_name: 'Ada Lovelace',
      email: 'ada@example.com',
      group: 'staff',
      quota: 1000,
      username: 'E-1001',
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { id: 7, ...input },
        success: true,
      }),
    );
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal',
      fetchImpl: fetchMock,
    });

    const result = await client.createUser(
      { accessToken: 'admin-access-token', newApiUserId: 1 },
      input,
    );

    expect(result).toEqual({ id: 7, ...input });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihub.internal/api/user/',
      expect.objectContaining({
        body: JSON.stringify(input),
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-access-token',
          'Content-Type': 'application/json',
          'New-Api-User': '1',
        }),
        method: 'POST',
      }),
    );
  });

  it('lists target-user tokens with management auth and keyword search', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          items: [{ id: 8001, name: 'masterlion-managed', user_id: 9001 }],
          total: 1,
        },
        success: true,
      }),
    );
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal',
      fetchImpl: fetchMock,
    });

    const result = await client.listTokens(
      { accessToken: 'admin-access-token', newApiUserId: 9001 },
      { keyword: 'masterlion-managed', page: 3, pageSize: 50 },
    );

    expect(result.items).toEqual([{ id: 8001, name: 'masterlion-managed', user_id: 9001 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihub.internal/api/token/search?keyword=masterlion-managed&p=3&size=50',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-access-token',
          'New-Api-User': '9001',
        }),
        method: 'GET',
      }),
    );
  });

  it('creates target-user tokens with management auth and quota payload', async () => {
    const input = {
      expired_time: -1,
      name: 'masterlion-managed',
      remain_quota: 500,
      unlimited_quota: false,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { id: 8002, ...input, user_id: 9001 },
        success: true,
      }),
    );
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal',
      fetchImpl: fetchMock,
    });

    const result = await client.createToken(
      { accessToken: 'admin-access-token', newApiUserId: 9001 },
      input,
    );

    expect(result).toEqual({ id: 8002, ...input, user_id: 9001 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihub.internal/api/token/',
      expect.objectContaining({
        body: JSON.stringify(input),
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-access-token',
          'Content-Type': 'application/json',
          'New-Api-User': '9001',
        }),
        method: 'POST',
      }),
    );
  });

  it('reads the public Aihub status needed for quota currency conversion', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          quota_display_type: 'CNY',
          quota_per_unit: 500_000,
          usd_exchange_rate: 7.12,
        },
        success: true,
      }),
    );
    const client = new NewApiClient({
      baseUrl: 'https://aihub.internal',
      fetchImpl: fetchMock,
    });

    const result = await client.getStatus();

    expect(result).toEqual({
      quota_display_type: 'CNY',
      quota_per_unit: 500_000,
      usd_exchange_rate: 7.12,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://aihub.internal/api/status',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
        method: 'GET',
      }),
    );
  });
});
