import { describe, expect, it, vi } from 'vitest';

import { createBridgeHandler } from './http.js';

const makeRequest = (path: string, token = 'secret') =>
  new Request(`http://bridge.local${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const readResponse = async (response: Response) => ({
  body: await response.json(),
  status: response.status,
});

const createRepo = () => ({
  findManagedToken: vi.fn().mockResolvedValue({ id: 12, key: 'sk-managed', name: 'managed' }),
  findUserById: vi.fn().mockResolvedValue({ group: 'vip', id: 7, username: 'ada' }),
  findUserByIdentity: vi.fn().mockResolvedValue({ id: 7, username: 'ada' }),
  getUsageLogs: vi.fn().mockResolvedValue({ items: [{ id: 1 }], total: 1 }),
  listAccessibleModels: vi.fn().mockResolvedValue(['gpt-4o-mini']),
  listManagedTokens: vi.fn().mockResolvedValue([
    { id: 12, name: 'managed' },
    { id: 11, name: 'managed' },
  ]),
  reassignToken: vi.fn().mockResolvedValue(true),
  updateTokenName: vi.fn().mockResolvedValue(true),
});

describe('createBridgeHandler', () => {
  it('rejects requests without the bridge token', async () => {
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: createRepo() as any,
    });

    const response = await readResponse(await handler(makeRequest('/v1/users/7', '')));

    expect(response).toEqual({
      body: { error: { code: 'unauthorized', message: 'Unauthorized' }, success: false },
      status: 401,
    });
  });

  it('returns shallow health without database access', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const response = await readResponse(await handler(makeRequest('/health')));

    expect(response).toEqual({ body: { data: { ok: true }, success: true }, status: 200 });
    expect(repo.findUserById).not.toHaveBeenCalled();
  });

  it('resolves users by identity', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const response = await readResponse(await handler(makeRequest('/v1/users/resolve?username=ada')));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 7, username: 'ada' });
    expect(repo.findUserByIdentity).toHaveBeenCalledWith({ email: undefined, username: 'ada' });
  });

  it('returns a user by id', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const response = await readResponse(await handler(makeRequest('/v1/users/7')));

    expect(response.body.data).toEqual({ group: 'vip', id: 7, username: 'ada' });
    expect(repo.findUserById).toHaveBeenCalledWith(7);
  });

  it('returns the selected managed token', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const response = await readResponse(await handler(makeRequest('/v1/users/7/managed-token')));

    expect(response.body.data.key).toBe('sk-managed');
    expect(repo.findManagedToken).toHaveBeenCalledWith(7, 'managed');
  });

  it('returns managed token options', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const response = await readResponse(await handler(makeRequest('/v1/users/7/managed-tokens')));

    expect(response.body.data).toEqual([
      { id: 12, name: 'managed' },
      { id: 11, name: 'managed' },
    ]);
    expect(repo.listManagedTokens).toHaveBeenCalledWith(7, 'managed');
  });

  it('returns models using token and account context', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const response = await readResponse(await handler(makeRequest('/v1/users/7/models')));

    expect(response.body.data).toEqual(['gpt-4o-mini']);
    expect(repo.listAccessibleModels).toHaveBeenCalledWith('vip', {
      id: 12,
      key: 'sk-managed',
      name: 'managed',
    });
  });

  it('returns usage logs with pagination parameters', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const response = await readResponse(
      await handler(
        makeRequest('/v1/users/7/usage-logs?startTimestamp=10&endTimestamp=20&page=2&pageSize=5'),
      ),
    );

    expect(response.body.data).toEqual({ items: [{ id: 1 }], total: 1 });
    expect(repo.getUsageLogs).toHaveBeenCalledWith(7, {
      endTimestamp: 20,
      page: 2,
      pageSize: 5,
      startTimestamp: 10,
    });
  });

  it('reassigns a token to a different user via POST /v1/tokens/:id/reassign', async () => {
    const repo = createRepo();
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const request = new Request('http://bridge.local/v1/tokens/167/reassign', {
      body: JSON.stringify({ userId: 165, name: 'MasterLion_biel' }),
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await readResponse(await handler(request));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { ok: true }, success: true });
    expect(repo.reassignToken).toHaveBeenCalledWith(167, 165);
    expect(repo.updateTokenName).toHaveBeenCalledWith(167, 'MasterLion_biel');
  });

  it('returns 400 when reassign body lacks a valid userId', async () => {
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: createRepo() as any,
    });

    const request = new Request('http://bridge.local/v1/tokens/167/reassign', {
      body: JSON.stringify({}),
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await readResponse(await handler(request));

    expect(response.status).toBe(400);
  });

  it('returns 404 when reassign fails (token not found)', async () => {
    const repo = createRepo();
    repo.reassignToken.mockResolvedValue(false);
    const handler = createBridgeHandler({
      bridgeToken: 'secret',
      managedTokenName: 'managed',
      repository: repo as any,
    });

    const request = new Request('http://bridge.local/v1/tokens/999/reassign', {
      body: JSON.stringify({ userId: 165 }),
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await readResponse(await handler(request));

    expect(response.status).toBe(404);
  });
});
