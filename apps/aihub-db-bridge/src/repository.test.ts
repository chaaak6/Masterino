import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AihubBridgeRepository } from './repository.js';

const createClient = (rows: unknown[] = []) => ({
  query: vi.fn().mockResolvedValue({ rows }),
});

describe('AihubBridgeRepository', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('resolves a user by email or username', async () => {
    const client = createClient([{ email: 'ada@example.com', group: 'vip', id: 7, username: 'ada' }]);
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const user = await repo.findUserByIdentity({ email: 'ada@example.com', username: 'ada' });

    expect(user).toEqual({ email: 'ada@example.com', group: 'vip', id: 7, username: 'ada' });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from users'), [
      'ada@example.com',
      'ada@example.com',
      'ada',
      'ada',
      'ada@example.com',
      'ada@example.com',
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

  it('falls back to the latest usable token', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 31, key: 'sk-fallback', name: 'manual' }] }),
    };
    const repo = new AihubBridgeRepository({ client, dialect: 'mysql' });

    const token = await repo.findManagedToken(7, 'missing');

    expect(token?.key).toBe('sk-fallback');
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('accessed_time'), [
      7,
      expect.any(Number),
    ]);
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

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('limit ? offset ?'), [
      7,
      1709990000,
      1710003600,
      10,
      10,
    ]);
  });
});
