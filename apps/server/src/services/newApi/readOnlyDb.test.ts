// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewApiReadOnlyDb } from './readOnlyDb';

const createQueryClient = (rows: unknown[] = []) => ({
  query: vi.fn().mockResolvedValue({ rows }),
});

describe('NewApiReadOnlyDb', () => {
  beforeEach(() => {
    delete process.env.AIHUB_READONLY_DATABASE_URL;
  });

  it('is disabled without a connection string or injected client', () => {
    const db = new NewApiReadOnlyDb();

    expect(db.isEnabled()).toBe(false);
  });

  it('uses the Aihub read-only database url as the primary configuration', () => {
    process.env.AIHUB_READONLY_DATABASE_URL =
      'mysql://newapi_read:secret@47.106.93.9:13306/newapi';

    const db = new NewApiReadOnlyDb();

    expect(db.isEnabled()).toBe(true);
    expect(db.getDialect()).toBe('mysql');
  });

  it('finds a user by email and maps account summary fields', async () => {
    const client = createQueryClient([
      {
        email: 'ada@example.com',
        group: 'default',
        id: 7,
        quota: 1000,
        request_count: 3,
        used_quota: 250,
        username: 'ada',
      },
    ]);
    const db = new NewApiReadOnlyDb({ client });

    const user = await db.findUserByIdentity({ email: 'ada@example.com' });

    expect(user).toEqual({
      email: 'ada@example.com',
      group: 'default',
      id: 7,
      quota: 1000,
      request_count: 3,
      used_quota: 250,
      username: 'ada',
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from users'), [
      'ada@example.com',
      'ada@example.com',
      '',
      '',
      'ada@example.com',
      'ada@example.com',
    ]);
  });

  it('finds the latest managed token key for a user by preferred token name first', async () => {
    const client = createQueryClient([
      {
        id: 12,
        key: 'sk-managed',
        name: 'masterlion-managed',
        remain_quota: 0,
        unlimited_quota: true,
        used_quota: 10,
      },
    ]);
    const db = new NewApiReadOnlyDb({ client });

    const token = await db.findManagedToken(7, 'masterlion-managed');

    expect(token).toEqual({
      id: 12,
      key: 'sk-managed',
      model_limits_enabled: false,
      name: 'masterlion-managed',
      remain_quota: 0,
      unlimited_quota: true,
      used_quota: 10,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from tokens'), [
      7,
      'masterlion-managed',
    ]);
  });

  it('falls back to the latest active usable token when the managed token name is absent', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 25,
              key: 'sk-existing',
              name: 'manual-token',
              remain_quota: 100,
              status: 1,
              unlimited_quota: false,
              used_quota: 2,
            },
          ],
        }),
    };
    const db = new NewApiReadOnlyDb({ client });

    const token = await db.findManagedToken(7, 'masterlion-managed');

    expect(token?.key).toBe('sk-existing');
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('from tokens'), [
      7,
      expect.any(Number),
    ]);
  });

  it('intersects token model limits with group-level enabled abilities', async () => {
    const client = createQueryClient([{ model: 'gpt-4o-mini' }, { model: 'deepseek-chat' }]);
    const db = new NewApiReadOnlyDb({ client });

    const models = await db.listAccessibleModels('default', {
      id: 12,
      key: 'sk-managed',
      model_limits: 'vip-only,gpt-4o-mini,deepseek-chat,gpt-4o-mini',
      model_limits_enabled: true,
      name: 'masterlion-managed',
    });

    expect(models).toEqual(['gpt-4o-mini', 'deepseek-chat']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from abilities'), ['default']);
  });

  it('returns group-level enabled model names from Aihub abilities', async () => {
    const client = createQueryClient([{ model: 'gpt-4o-mini' }, { model: 'deepseek-chat' }]);
    const db = new NewApiReadOnlyDb({ client });

    const models = await db.listAccessibleModels('default');

    expect(models).toEqual(['gpt-4o-mini', 'deepseek-chat']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('from abilities'), ['default']);
  });

  it('inlines MySQL usage log pagination after validating numeric bounds', async () => {
    const client = createQueryClient([
      {
        completion_tokens: 7,
        created_at: 1710000000,
        id: 1,
        model_name: 'gpt-4o-mini',
        prompt_tokens: 13,
        quota: 20,
        request_id: 'req_1',
        token_name: 'masterlion-managed',
      },
    ]);
    const db = new NewApiReadOnlyDb({ client, dialect: 'mysql' });

    const logs = await db.getUsageLogs(7, {
      endTimestamp: 1710003600,
      page: 2,
      pageSize: 10,
      startTimestamp: 1709990000,
    });

    expect(logs).toEqual({
      items: [
        {
          completion_tokens: 7,
          created_at: 1710000000,
          id: 1,
          model_name: 'gpt-4o-mini',
          prompt_tokens: 13,
          quota: 20,
          request_id: 'req_1',
          token_name: 'masterlion-managed',
        },
      ],
      total: 1,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('limit 10 offset 10'),
      [7, 1709990000, 1710003600],
    );
  });

  it('keeps Postgres usage log pagination parameterized', async () => {
    const client = createQueryClient([]);
    const db = new NewApiReadOnlyDb({ client, dialect: 'postgres' });

    await db.getUsageLogs(7, {
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
