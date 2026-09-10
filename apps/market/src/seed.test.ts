import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { MarketConfig } from './config.js';
import { CURATED_SEED_BATCH, curatedResources } from './curatedCatalog.js';
import { ONBOARDING_AGENT_CATALOG } from './onboardingCatalog.js';
import { runCuratedSeed } from './seed.js';
import { createStoredZip } from './zip.js';

const config = {} as MarketConfig;
const account = {
  externalUserId: 'masterino-curated-seed',
  id: 1,
  name: 'Masterino 官方精选',
  role: 'admin' as const,
};

const artifactHash = (index: number) => {
  const entry = curatedResources[index];
  if (!entry) throw new Error('missing catalog entry');
  return entry.artifact
    ? createHash('sha256').update(createStoredZip(entry.artifact.files)).digest('hex')
    : createHash('sha256').update(JSON.stringify(entry.resource)).digest('hex');
};

const createRepository = () => ({
  createResource: vi.fn(async () => ({ id: 1 })),
  createVersion: vi.fn(async () => ({ id: 10, version: '1.0.0' })),
  ping: vi.fn(async () => undefined),
  review: vi.fn(async () => ({ success: true })),
  syncAccount: vi.fn(async () => account),
});

const countResult = {
  rowCount: 3,
  rows: [
    { count: 50, type: 'agent' },
    { count: 5, type: 'mcp' },
    { count: 5, type: 'skill' },
  ],
};

describe('runCuratedSeed', () => {
  it('publishes exactly 50 assistants, 5 skills and 5 MCPs on first run', async () => {
    const pool = {
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('GROUP BY type')) return countResult;
        if (sql.includes('SELECT r.id')) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      }),
    };
    const repository = createRepository();
    const storage = { ping: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };

    const result = await runCuratedSeed(config, {
      pool: pool as never,
      repository: repository as never,
      storage: storage as never,
    });

    expect(result).toEqual({ agent: 50, mcp: 5, skill: 5 });
    expect(repository.createResource).toHaveBeenCalledTimes(60);
    expect(repository.createVersion).toHaveBeenCalledTimes(60);
    expect(repository.review).toHaveBeenCalledTimes(300);
    expect(storage.put).toHaveBeenCalledTimes(5);
  });

  it('skips every resource when the same version and hash are already published', async () => {
    let index = 0;
    const pool = {
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('GROUP BY type')) return countResult;
        if (sql.includes('SELECT r.id')) {
          const entry = curatedResources[index];
          const result = {
            rowCount: 1,
            rows: [
              {
                artifact_sha256: entry?.artifact ? artifactHash(index) : null,
                avatar: entry?.resource.avatar,
                category: entry?.resource.category,
                id: index + 1,
                metadata: entry?.artifact ? {} : { artifactSha256: artifactHash(index) },
                owner_account_id: account.id,
                status: 'published',
                version: entry?.resource.version,
                version_id: index + 100,
                workflow_state: 'published',
              },
            ],
          };
          index += 1;
          return result;
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const repository = createRepository();
    const storage = { ping: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };

    await runCuratedSeed(config, {
      pool: pool as never,
      repository: repository as never,
      storage: storage as never,
    });

    expect(repository.createResource).not.toHaveBeenCalled();
    expect(repository.createVersion).not.toHaveBeenCalled();
    expect(repository.review).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('creates a new reviewed version when the catalog version increases', async () => {
    const selected = ONBOARDING_AGENT_CATALOG[0];
    const selectedIndex = curatedResources.findIndex(
      (entry) => entry.resource.identifier === selected.identifier,
    );
    let index = 0;
    const pool = {
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('GROUP BY type')) return countResult;
        if (sql.includes('SELECT r.id')) {
          const entry = curatedResources[index];
          const currentIndex = index;
          index += 1;
          return {
            rowCount: 1,
            rows: [
              {
                artifact_sha256: entry?.artifact ? artifactHash(currentIndex) : null,
                avatar: entry?.resource.avatar,
                category: entry?.resource.category,
                id: currentIndex + 1,
                metadata: entry?.artifact ? {} : { artifactSha256: artifactHash(currentIndex) },
                owner_account_id: account.id,
                status: 'published',
                version: currentIndex === selectedIndex ? '0.9.0' : entry?.resource.version,
                version_id: currentIndex + 100,
                workflow_state: 'published',
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const repository = createRepository();
    const storage = { ping: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };

    await runCuratedSeed(config, {
      pool: pool as never,
      repository: repository as never,
      storage: storage as never,
    });

    expect(repository.createVersion).toHaveBeenCalledOnce();
    expect(repository.createVersion).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({
        avatar: selected.avatar,
        category: selected.category,
        identifier: selected.identifier,
        version: selected.seedVersion,
      }),
      account,
    );
    expect(repository.review).toHaveBeenCalledTimes(5);
  });

  it('repairs onboarding presentation drift without creating another version', async () => {
    const selected = ONBOARDING_AGENT_CATALOG[0];
    let index = 0;
    const pool = {
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('GROUP BY type')) return countResult;
        if (sql.includes('SELECT r.id')) {
          const entry = curatedResources[index];
          const currentIndex = index;
          index += 1;
          const isSelected = entry?.resource.identifier === selected.identifier;
          return {
            rowCount: 1,
            rows: [
              {
                artifact_sha256: entry?.artifact ? artifactHash(currentIndex) : null,
                avatar: isSelected
                  ? 'https://stale.example.com/avatar.svg'
                  : entry?.resource.avatar,
                category: isSelected ? 'office' : entry?.resource.category,
                id: currentIndex + 1,
                metadata: entry?.artifact ? {} : { artifactSha256: artifactHash(currentIndex) },
                owner_account_id: account.id,
                status: 'published',
                version: entry?.resource.version,
                version_id: currentIndex + 100,
                workflow_state: 'published',
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      }),
    };
    const repository = createRepository();

    await runCuratedSeed(config, {
      pool: pool as never,
      repository: repository as never,
      storage: { ping: vi.fn(async () => undefined), put: vi.fn() } as never,
    });

    const presentationUpdate = pool.query.mock.calls.find(
      ([sql, params]) => sql.includes('avatar=COALESCE') && params?.at(-1) === selected.identifier,
    );
    expect(presentationUpdate?.[1]?.[3]).toBe(selected.avatar);
    expect(presentationUpdate?.[1]?.[4]).toBe(selected.category);
    expect(repository.createVersion).not.toHaveBeenCalled();
    expect(repository.review).not.toHaveBeenCalled();
  });

  it('deprecates resources created by a failed batch without deleting data', async () => {
    const pool = {
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT r.id')) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      }),
    };
    const repository = createRepository();
    const storage = {
      ping: vi.fn(async () => undefined),
      put: vi.fn(async () => {
        throw new Error('object storage unavailable');
      }),
    };

    await expect(
      runCuratedSeed(config, {
        pool: pool as never,
        repository: repository as never,
        storage: storage as never,
      }),
    ).rejects.toThrow('object storage unavailable');

    const rollbackQueries = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("status='deprecated'"),
    );
    expect(rollbackQueries).toHaveLength(51);
    expect(pool.end).toHaveBeenCalledOnce();
    expect(
      (pool.query.mock.calls as unknown as Array<[string, unknown[]?]>).some(([, params]) =>
        params?.includes(CURATED_SEED_BATCH),
      ),
    ).toBe(true);
  });
});
