// @vitest-environment node
import fs from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('restores only broken published Skill pointers and leaves pending versions untouched', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE market_resources (id int PRIMARY KEY, type text, status text, current_version_id int);
      CREATE TABLE market_versions (id int PRIMARY KEY, resource_id int, workflow_state text, created_at timestamptz DEFAULT now());
      INSERT INTO market_resources VALUES
        (1,'skill','published',13), (2,'skill','published',21),
        (3,'skill','unpublished',32), (4,'mcp','published',42),
        (5,'skill','published',51);
      INSERT INTO market_versions (id,resource_id,workflow_state) VALUES
        (11,1,'published'), (12,1,'published'), (13,1,'submitted'),
        (21,2,'published'), (22,2,'published'),
        (31,3,'published'), (32,3,'submitted'),
        (41,4,'published'), (42,4,'submitted'), (51,5,'submitted');
    `);
    const migration = await fs.readFile(
      new URL(
        '../../../../../apps/market/src/migrations/0002_restore_published_skill_pointer.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);
    expect(
      (await db.query('SELECT id,current_version_id FROM market_resources ORDER BY id')).rows,
    ).toEqual([
      { id: 1, current_version_id: 12 },
      { id: 2, current_version_id: 21 },
      { id: 3, current_version_id: 32 },
      { id: 4, current_version_id: 42 },
      { id: 5, current_version_id: 51 },
    ]);
    expect((await db.query('SELECT workflow_state FROM market_versions WHERE id=13')).rows).toEqual(
      [{ workflow_state: 'submitted' }],
    );
  } finally {
    await db.close();
  }
});
