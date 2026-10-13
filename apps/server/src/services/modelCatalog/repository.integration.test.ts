// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { createEmptyModelDescription } from '@lobechat/types';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { ModelCatalogRepository } from './repository';

const url = process.env.CATALOG_BDD_DATABASE_URL;
describe.skipIf(!url)('catalog publication against isolated PostgreSQL', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema }) as LobeChatDatabase;
  const repository = new ModelCatalogRepository(db);
  beforeAll(async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS system_configs (id text primary key, key text not null, scope text not null, value jsonb not null, updated_by text, created_at timestamptz default now(), updated_at timestamptz default now(), UNIQUE(key, scope));
      CREATE TABLE IF NOT EXISTS enterprise_audit_logs (id text primary key, actor_user_id text, action text not null, target_type text not null, target_id text, result text not null, ip text, user_agent text, metadata jsonb not null default '{}', created_at timestamptz default now());`);
    await pool.query(
      await readFile('packages/database/migrations/0124_managed_model_catalog.sql', 'utf8'),
    );
    await pool.query(
      'TRUNCATE managed_model_catalog_revisions, managed_model_catalog, system_configs, enterprise_audit_logs',
    );
  });
  afterAll(() => pool.end());
  it('Given saved drafts, When publish/edit/rollback, Then active content and audited history remain independent of the draft', async () => {
    const first = await repository.save('admin', 'bdd-chat', 0, {
      ...createEmptyModelDescription('bdd-chat'),
      displayName: 'First',
      contextWindowTokens: 128000,
    });
    expect(first.version).toBe(1);
    const published = await repository.publish('admin', 'bdd-chat', 1, 'initial publication');
    const head = await repository.settings();
    expect(published.published?.displayName).toBe('First');
    const draft = await repository.save('admin', 'bdd-chat', published.version, {
      ...first.draft,
      displayName: 'Second',
    });
    expect(draft.published?.displayName).toBe('First');
    await expect(
      repository.save('other-admin', 'bdd-chat', published.version, first.draft),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const second = await repository.publish(
      'admin',
      'bdd-chat',
      draft.version,
      'second publication',
    );
    const restored = await repository.publish(
      'admin',
      'bdd-chat',
      second.version,
      'rollback',
      published.publishedRevision!,
    );
    expect(restored.published?.displayName).toBe('First');
    expect(restored.draft.displayName).toBe('Second');
    expect((await repository.history('bdd-chat')).length).toBe(3);
    expect((await repository.settings()).generation).not.toBe(head.generation);
    const audit = await pool.query(
      "select action from enterprise_audit_logs where action = 'model_catalog.rollback'",
    );
    expect(audit.rowCount).toBe(1);
  });
  it('Given two editors with the same revision, Then exactly one draft save succeeds', async () => {
    const draft = createEmptyModelDescription('bdd-concurrent');
    await repository.save('admin', 'bdd-concurrent', 0, draft);
    const results = await Promise.allSettled([
      repository.save('a', 'bdd-concurrent', 1, { ...draft, displayName: 'A' }),
      repository.save('b', 'bdd-concurrent', 1, { ...draft, displayName: 'B' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
  it('Given a failed rollback, Then neither publication nor generation advances', async () => {
    const before = await repository.settings();
    const row = (await repository.list()).find((r) => r.modelId === 'bdd-chat')!;
    await expect(
      repository.publish(
        'admin',
        'bdd-chat',
        row.version,
        'invalid rollback',
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repository.settings()).toEqual(before);
    expect((await repository.list()).find((r) => r.modelId === 'bdd-chat')?.version).toBe(
      row.version,
    );
  });
});
