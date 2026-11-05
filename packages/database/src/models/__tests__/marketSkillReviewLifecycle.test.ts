// @vitest-environment node
import fs from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';
import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';
import { expect, it } from 'vitest';

import { createMarketApp } from '../../../../../apps/market/src/app';
import { loadConfig } from '../../../../../apps/market/src/config';
import { MarketRepository } from '../../../../../apps/market/src/repository';

const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
async function fixture() {
  const db = new PGlite();
  const migrations = new URL('../../../../../apps/market/src/migrations/', import.meta.url);
  for (const file of (await fs.readdir(migrations)).filter((name) => name.endsWith('.sql')).sort())
    await db.exec(await fs.readFile(new URL(file, migrations), 'utf8'));
  await db.exec(
    "INSERT INTO market_accounts(id,external_user_id,role) VALUES(1,'qa-admin','admin')",
  );
  const client = {
    query: async (sql: string, args?: any[]) => {
      const r = await db.query(sql, args);
      return { ...r, rowCount: r.rows.length || r.affectedRows };
    },
    release() {},
  };
  const repo = new MarketRepository({ ...client, connect: async () => client } as any);
  const config = loadConfig({
    ...process.env,
    MARKET_ADMIN_USER_IDS: 'qa-admin',
    MARKET_DATABASE_URL: 'postgres://unused',
    MARKET_CREDENTIAL_ENCRYPTION_KEY: secret,
    MARKET_IMPORT_SIGNING_KEY: secret,
    MARKET_TRUSTED_CLIENT_SECRET: secret,
    MARKET_TRUSTED_CLIENT_IDS: 'masterino',
    MARKET_OBJECT_STORAGE_ACCESS_KEY_ID: 'test',
    MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test',
    MARKET_OBJECT_STORAGE_BUCKET: 'test',
    MARKET_OBJECT_STORAGE_ENDPOINT: 'http://unused',
    MARKET_REDIS_URL: 'redis://unused',
    MARKET_OAUTH_REDIRECT_ORIGINS: 'https://example.com',
    MARKET_PUBLIC_BASE_URL: 'https://example.com',
    MARKET_RUNNER_INTERNAL_TOKEN: secret,
  });
  const app = createMarketApp({
    config,
    repository: repo,
    redis: {} as any,
    storage: {
      signedDownloadUrl: async (key: string) => `https://artifacts.example/${key}`,
    } as any,
  });
  const headers = {
    'x-lobe-trust-token': createTrustedClientToken(
      buildTrustedClientPayload({
        clientId: 'masterino',
        userId: 'qa-admin',
        email: 'qa@example.com',
      }),
      secret,
    ),
    'content-type': 'application/json',
  };
  const account = { id: 1, externalUserId: 'qa-admin', role: 'admin' as const };
  const submit = (
    version: string,
    name: string,
    description: string,
    manifest = { name, description },
  ) =>
    repo.submitResource(
      'skill',
      { identifier: 'qa-lifecycle', version, name, description, manifest, category: 'design' },
      account,
      { key: `${version}.zip`, sha256: 'hash' },
    );
  const publish = async (versionId: number) => {
    for (const action of ['scan-start', 'scan-passed', 'approve', 'publish'])
      await repo.review('skill', 'qa-lifecycle', action, undefined, account, undefined, {
        versionId,
      });
  };
  return { db, repo, app, headers, account, submit, publish };
}
it('rollback to deprecated release restores matching metadata and downloaded package', async () => {
  const f = await fixture();
  try {
    await f.submit('1.0.0', 'First name', 'First description');
    await f.publish(1);
    await f.repo.review('skill', 'qa-lifecycle', 'deprecate', undefined, f.account, undefined, {
      versionId: 1,
    });
    await f.submit('2.0.0', 'Second name', 'Second description');
    await f.publish(2);
    const r = await f.app.request('/api/internal/resources/skill/qa-lifecycle/rollback', {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify({ version: '1.0.0' }),
    });
    expect(r.status).toBe(200);
    expect
      .soft(
        (await f.db.query('SELECT name,description,current_version_id FROM market_resources'))
          .rows[0],
      )
      .toMatchObject({
        name: 'First name',
        description: 'First description',
        current_version_id: 1,
      });
    const download = await f.app.request('/api/v1/skills/qa-lifecycle/download', {
      headers: f.headers,
    });
    expect.soft(download.headers.get('location')).toBe('https://artifacts.example/1.0.0.zip');
    expect
      .soft((await f.db.query('SELECT workflow_state FROM market_versions WHERE id=1')).rows[0])
      .toEqual({ workflow_state: 'published' });
  } finally {
    await f.db.close();
  }
});
it('review compares earlier releases and omits rejected history from actionable queue', async () => {
  const f = await fixture();
  try {
    await f.submit('1.0.0', 'First', 'Live description');
    await f.publish(1);
    await f.submit('2.0.0', 'Second', 'Review description');
    await f.submit('3.0.0', 'Third', 'Rejected newer description');
    await f.db.exec(
      "UPDATE market_versions SET created_at='2026-01-01'::timestamptz + id * interval '1 day'; UPDATE market_versions SET workflow_state='rejected' WHERE id=3",
    );
    const r = await f.app.request('/api/internal/reviews', { headers: f.headers });
    expect(r.status).toBe(200);
    const data = (await r.json()) as any;
    expect
      .soft(data.items.find((x: any) => x.versionId === 2)?.previousConfig.manifest.description)
      .toBe('Live description');
    expect.soft(data.items.map((x: any) => x.versionId)).toEqual([2]);
  } finally {
    await f.db.close();
  }
});

it('publishing a legacy empty manifest description preserves the resource description', async () => {
  const f = await fixture();
  try {
    await f.submit('1.0.0', 'First', 'Original description', { name: 'First', description: '' });
    await f.publish(1);
    expect((await f.db.query('SELECT description FROM market_resources')).rows[0]).toEqual({
      description: 'Original description',
    });
  } finally {
    await f.db.close();
  }
});
