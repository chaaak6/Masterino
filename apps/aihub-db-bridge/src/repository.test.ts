import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AihubBridgeRepository, type QueryClient } from './repository.js';

const createClient = (rows: unknown[] = []) => ({
  query: vi.fn().mockResolvedValue({ rows }),
});

describe('AihubBridgeRepository', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('resolves a user by email or username', async () => {
    const client = createClient([
      { email: 'ada@example.com', group: 'vip', id: 7, username: 'ada' },
    ]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const user = await repo.findUserByIdentity({ email: 'ada@example.com', username: 'ada' });

    expect(user).toEqual({ email: 'ada@example.com', group: 'vip', id: 7, username: 'ada' });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from users'), [
      'ada@example.com',
      'ada@example.com',
      'ada',
      'ada',
      'ada',
      'ada',
    ]);
  });

  it('returns a user by id', async () => {
    const client = createClient([{ id: 7, username: 'ada' }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.findUserById(7)).resolves.toEqual({ id: 7, username: 'ada' });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('id = ?'), [7]);
  });

  it('prefers the latest named managed token', async () => {
    const client = createClient([
      {
        id: 12,
        key: 'sk-managed',
        model_limits_enabled: 0,
        name: 'masterlion-managed',
        unlimited_quota: 1,
      },
    ]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const token = await repo.findManagedToken(7, 'masterlion-managed');

    expect(token).toEqual({
      id: 12,
      key: 'sk-managed',
      model_limits_enabled: false,
      name: 'masterlion-managed',
      unlimited_quota: true,
    });
  });

  it('does not fall back to an unrelated token name', async () => {
    const client = createClient([]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const token = await repo.findManagedToken(7, 'missing');

    expect(token).toBeUndefined();
    expect(client.query).toHaveBeenCalledOnce();
  });

  it('finds a usable managed token by bound id and owner', async () => {
    const client = createClient([{ id: 31, key: 'sk-bound', name: 'manual', user_id: 7 }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.findManagedTokenById(7, 31)).resolves.toMatchObject({
      id: 31,
      key: 'sk-bound',
      user_id: 7,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('and user_id = ?'), [
      31,
      7,
      expect.any(Number),
    ]);
  });

  it('inspects a disabled bound token without selecting or returning its key', async () => {
    const client = createClient([
      {
        allow_ips: '',
        deleted_at: null,
        id: 31,
        key: 'unexpected-test-key',
        name: 'Masterino_7',
        status: 2,
        user_id: 7,
      },
    ]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.inspectBoundToken(7, 31)).resolves.toMatchObject({
      availability: 'disabled',
      token: { id: 31, name: 'Masterino_7', user_id: 7 },
    });
    const result = await repo.inspectBoundToken(7, 31);
    expect(result.token).not.toHaveProperty('key');
    expect(client.query).toHaveBeenCalledWith(expect.not.stringContaining('`key`'), [31]);
  });

  it('uses the same expiration requirement as runtime token lookup', async () => {
    const client = createClient([{ id: 31, status: 1, unlimited_quota: 1, user_id: 7 }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.inspectBoundToken(7, 31)).resolves.toMatchObject({
      availability: 'expired',
    });
  });

  it('never updates a token that belongs to another user', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ deleted_at: null, user_id: 8 }] });
    const client = {
      query,
      transaction: async <T>(callback: (client: QueryClient) => Promise<T>) =>
        callback({ query } as QueryClient),
    };
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.updateBoundToken(7, 31, { status: 1 })).resolves.toEqual({
      availability: 'owner_mismatch',
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('update tokens'),
      expect.anything(),
    );
  });

  it('updates only approved columns and re-inspects after the transaction', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('for update')) return { rows: [{ deleted_at: null, user_id: 7 }] };
      if (sql.includes('update tokens')) return { rows: [] };
      return {
        rows: [
          {
            deleted_at: null,
            expired_time: -1,
            id: 31,
            name: 'Masterino_7',
            status: 1,
            user_id: 7,
            unlimited_quota: 1,
          },
        ],
      };
    });
    const client = {
      query,
      transaction: async <T>(callback: (client: QueryClient) => Promise<T>) =>
        callback({ query } as QueryClient),
    };
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(
      repo.updateBoundToken(7, 31, { status: 1, unlimited_quota: true }),
    ).resolves.toMatchObject({ availability: 'active', token: { id: 31, status: 1 } });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('set status = ?, unlimited_quota = ?'),
      [1, true, 31, 7],
    );
  });

  it('lists managed token metadata without selecting token keys', async () => {
    const client = createClient([
      { id: 12, model_limits_enabled: 0, name: 'masterlion-managed', unlimited_quota: 1 },
      { id: 11, model_limits_enabled: 1, name: 'masterlion-managed', unlimited_quota: 0 },
    ]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const tokens = await repo.listManagedTokens(7, 'masterlion-managed');

    expect(tokens).toEqual([
      {
        id: 12,
        model_limits_enabled: false,
        name: 'masterlion-managed',
        unlimited_quota: true,
      },
      {
        id: 11,
        model_limits_enabled: true,
        name: 'masterlion-managed',
        unlimited_quota: false,
      },
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.not.stringContaining('`key`'), [
      7,
      'masterlion-managed',
    ]);
  });

  it('intersects token model limits with enabled abilities for the user group', async () => {
    const client = createClient([
      { model: 'gpt-4o-mini' },
      { model: 'deepseek-chat' },
      { model: 'glm5.1' },
    ]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const models = await repo.listAccessibleModels('vip', {
      id: 12,
      model_limits: 'glm5.1, vip-only, gpt-4o-mini, glm5.1',
      model_limits_enabled: true,
      name: 'managed',
    });

    expect(models).toEqual(['gpt-4o-mini', 'glm5.1']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from abilities'), ['vip']);
  });

  it('queries enabled abilities for the user group', async () => {
    const client = createClient([{ model: 'deepseek-chat' }, { model: 'gpt-4o-mini' }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const models = await repo.listAccessibleModels('vip');

    expect(models).toEqual(['deepseek-chat', 'gpt-4o-mini']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from abilities'), ['vip']);
  });

  it('queries enabled abilities through the current token user group when token has user id', async () => {
    const client = createClient([{ model: 'deepseek-chat' }, { model: 'glm5.1' }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const models = await repo.listAccessibleModels('vip', {
      id: 12,
      model_limits: 'glm5.1,vip-only,deepseek-chat',
      model_limits_enabled: true,
      name: 'managed',
      user_id: 7,
    });

    expect(models).toEqual(['deepseek-chat', 'glm5.1']);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('join users u on u.`group` = a.`group`'),
      [7],
    );
  });

  it('inlines MySQL usage log pagination after validating numeric bounds', async () => {
    const client = createClient([{ created_at: 1710000000, id: 1, model_name: 'gpt-4o-mini' }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const page = await repo.getUsageLogs(7, {
      endTimestamp: 1710003600,
      page: 2,
      pageSize: 10,
      startTimestamp: 1709990000,
    });

    expect(page).toEqual({
      items: [{ created_at: 1710000000, id: 1, model_name: 'gpt-4o-mini' }],
      total: 1,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('limit 10 offset 10'),
      [7, 1709990000, 1710003600],
    );
  });

  it('keeps Postgres usage log pagination parameterized', async () => {
    const client = createClient([]);
    const repo = new AihubBridgeRepository({ client, dialect: 'postgres' });

    await repo.getUsageLogs(7, {
      endTimestamp: 1710003600,
      page: 2,
      pageSize: 10,
      startTimestamp: 1709990000,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('limit ? offset ?'),
      [7, 1709990000, 1710003600, 10, 10],
    );
  });

  it('returns existing for an identical OAuth binding', async () => {
    const client = createClient([{ id: 1, provider_user_id: '768164', user_id: 27 }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.linkOAuthBinding(27, 1, '768164')).resolves.toEqual({
      status: 'existing',
    });
  });

  it('repairs an empty OAuth binding without overwriting non-empty values', async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 1, provider_user_id: '', user_id: 27 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.linkOAuthBinding(27, 1, '768164')).resolves.toEqual({
      status: 'repaired',
    });
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("trim(coalesce(provider_user_id, '')) = ''"),
      ['768164', 1],
    );
  });

  it('rejects an employee number already owned by another Aihub user', async () => {
    const client = createClient([{ id: 2, provider_user_id: '768164', user_id: 99 }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.linkOAuthBinding(27, 1, '768164')).resolves.toEqual({
      reason: 'provider_user_id_in_use',
      status: 'conflict',
    });
  });

  it('rejects replacing a different non-empty binding for the same user', async () => {
    const client = createClient([{ id: 1, provider_user_id: 'OTHER', user_id: 27 }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    await expect(repo.linkOAuthBinding(27, 1, '768164')).resolves.toEqual({
      reason: 'user_already_bound',
      status: 'conflict',
    });
  });
});
