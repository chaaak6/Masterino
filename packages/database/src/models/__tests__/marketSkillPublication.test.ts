// @vitest-environment node
import fs from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

import { MarketRepository } from '../../../../../apps/market/src/repository';

it('keeps V1 metadata during review and publishes the selected V2 metadata', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await fs.readFile(
        new URL('../../../../../apps/market/src/migrations/0001_market.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.exec("INSERT INTO market_accounts(id,external_user_id,role) VALUES(1,'qa','admin')");
    const client = {
      query: async (sql: string, args?: any[]) => {
        const r = await db.query(sql, args);
        return { ...r, rowCount: r.rows.length || r.affectedRows };
      },
      release() {},
    };
    const repo = new MarketRepository({ ...client, connect: async () => client } as any);
    const account = { id: 1, externalUserId: 'qa', role: 'admin' as const };
    const submit = (version: string, description: string) =>
      repo.submitResource(
        'skill',
        {
          identifier: 'qa-skill',
          name: 'qa-skill',
          description,
          version,
          manifest: { name: 'qa-skill', description },
        },
        account,
      );
    const publish = async (versionId: number) => {
      for (const action of ['scan-start', 'scan-passed', 'approve', 'publish'])
        await repo.review('skill', 'qa-skill', action, undefined, account, undefined, {
          versionId,
        });
    };
    await submit('1.0.0', 'Original description');
    await publish(1);
    await submit('2.0.0', 'Updated description');
    expect((await db.query('SELECT description FROM market_resources')).rows[0]).toEqual({
      description: 'Original description',
    });
    await publish(2);
    expect((await db.query('SELECT description FROM market_resources')).rows[0]).toEqual({
      description: 'Updated description',
    });
  } finally {
    await db.close();
  }
});
