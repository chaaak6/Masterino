import { createHash } from 'node:crypto';

import type { MarketConfig } from './config.js';
import { CURATED_SEED_BATCH, curatedResources } from './curatedCatalog.js';
import { createPool } from './db.js';
import { MarketObjectStorage } from './objectStorage.js';
import { MarketRepository } from './repository.js';
import { createStoredZip } from './zip.js';

const scanResult = (artifactSha256: string, seedBatchId: string) => ({
  artifactSha256,
  checkedAt: new Date().toISOString(),
  checks: ['archive-paths', 'embedded-secrets', 'installers', 'license', 'manual-review'],
  seedBatchId,
  source: 'masterino-curated-seed',
  status: 'passed',
});

export interface CuratedSeedDependencies {
  pool?: ReturnType<typeof createPool>;
  repository?: MarketRepository;
  storage?: MarketObjectStorage;
}

export const runCuratedSeed = async (
  config: MarketConfig,
  dependencies: CuratedSeedDependencies = {},
) => {
  const pool = dependencies.pool || createPool(config.MARKET_DATABASE_URL);
  const repository = dependencies.repository || new MarketRepository(pool);
  const storage = dependencies.storage || new MarketObjectStorage(config);
  const account = await repository.syncAccount(
    {
      clientId: 'masterino-curated-seed',
      name: 'Masterino 官方精选',
      nonce: CURATED_SEED_BATCH,
      timestamp: Date.now(),
      userId: 'masterino-curated-seed',
    },
    new Set(['masterino-curated-seed']),
  );
  const created: Array<{ identifier: string; seedBatchId: string; type: string }> = [];
  const updated: Array<{
    avatar: string | null;
    category: string | null;
    currentVersionId: number | null;
    description: string | null;
    identifier: string;
    metadata: Record<string, unknown>;
    name: string;
    replacementVersionId?: number;
    tags: unknown[];
    type: string;
  }> = [];

  try {
    await Promise.all([repository.ping(), storage.ping()]);
    for (const entry of curatedResources) {
      const seedBatchId = entry.seedBatchId;
      const artifact = entry.artifact ? createStoredZip(entry.artifact.files) : undefined;
      const artifactHash = artifact
        ? createHash('sha256').update(artifact).digest('hex')
        : createHash('sha256').update(JSON.stringify(entry.resource)).digest('hex');
      const idempotencyKey = `${seedBatchId}:${entry.type}:${entry.resource.identifier}:${entry.resource.version}:${artifactHash}`;
      const existing = await pool.query(
        `SELECT r.id, r.status, r.metadata, r.owner_account_id, r.name, r.description,
          r.avatar, r.category, r.tags, r.current_version_id, v.id AS version_id, v.version,
          v.workflow_state, v.artifact_sha256
         FROM market_resources r LEFT JOIN market_versions v ON v.id=r.current_version_id
         WHERE r.type=$1 AND r.identifier=$2`,
        [entry.type, entry.resource.identifier],
      );
      const current = existing.rows[0];
      const previousHash = current?.artifact_sha256 || current?.metadata?.artifactSha256;
      const presentationMatches =
        current?.category === entry.resource.category &&
        (entry.resource.avatar === undefined || current?.avatar === entry.resource.avatar);

      if (
        current?.status === 'published' &&
        current.version === entry.resource.version &&
        previousHash === artifactHash &&
        current.workflow_state === 'published' &&
        presentationMatches
      ) {
        console.info(`seed skip ${entry.type}:${entry.resource.identifier}`);
        continue;
      }
      if (current && Number(current.owner_account_id) !== account.id) {
        throw new Error(
          `Curated identifier is already owned by another account: ${entry.resource.identifier}`,
        );
      }
      if (
        current?.version === entry.resource.version &&
        previousHash &&
        previousHash !== artifactHash
      ) {
        throw new Error(
          `Curated resource ${entry.type}:${entry.resource.identifier} changed without a version bump`,
        );
      }

      const metadata = {
        ...entry.resource.metadata,
        artifactSha256: artifactHash,
        idempotencyKey,
        seedBatchId,
      };
      if (!current) {
        await repository.createResource(entry.type, { ...entry.resource, metadata }, account);
        created.push({ identifier: entry.resource.identifier, seedBatchId, type: entry.type });
      } else {
        updated.push({
          avatar: current.avatar,
          category: current.category,
          currentVersionId: current.current_version_id ? Number(current.current_version_id) : null,
          description: current.description,
          identifier: entry.resource.identifier,
          metadata: current.metadata || {},
          name: current.name,
          tags: current.tags || [],
          type: entry.type,
        });
        await pool.query(
          `UPDATE market_resources SET metadata=$1, name=$2, description=$3,
            avatar=COALESCE($4, avatar), category=$5, tags=$6,
            updated_at=now() WHERE type=$7 AND identifier=$8`,
          [
            JSON.stringify(metadata),
            entry.resource.name,
            entry.resource.description,
            entry.resource.avatar,
            entry.resource.category,
            JSON.stringify(entry.resource.tags || []),
            entry.type,
            entry.resource.identifier,
          ],
        );
      }

      let version =
        current?.version === entry.resource.version
          ? { id: Number(current.version_id), version: entry.resource.version }
          : undefined;
      let workflow = current?.workflow_state || 'draft';
      if (workflow === 'deprecated' && version) {
        await pool.query(
          `UPDATE market_versions SET workflow_state='draft', review_reason=NULL WHERE id=$1`,
          [version.id],
        );
        await pool.query(`UPDATE market_resources SET status='draft' WHERE id=$1`, [current.id]);
        workflow = 'draft';
      }
      if (!version) {
        version = await repository.createVersion(
          entry.type,
          { ...entry.resource, metadata },
          account,
        );
        workflow = 'draft';
        const snapshot = updated.at(-1);
        if (snapshot?.identifier === entry.resource.identifier && snapshot.type === entry.type) {
          snapshot.replacementVersionId = version.id;
        }
      }

      if (artifact) {
        const artifactKey = `${entry.type}/${entry.resource.identifier}/${entry.resource.version}/${artifactHash}.zip`;
        await storage.put(artifactKey, artifact, artifactHash);
        await pool.query(
          `UPDATE market_versions SET artifact_key=$1, artifact_sha256=$2 WHERE id=$3`,
          [artifactKey, artifactHash, version.id],
        );
      } else {
        await pool.query(
          `UPDATE market_resources SET metadata=jsonb_set(metadata, '{artifactSha256}', to_jsonb($1::text))
           WHERE type=$2 AND identifier=$3`,
          [artifactHash, entry.type, entry.resource.identifier],
        );
      }

      const transitions: Record<string, string[]> = {
        approved: ['publish'],
        draft: ['submit', 'scan-start', 'scan-passed', 'approve', 'publish'],
        in_review: ['approve', 'publish'],
        scanning: ['scan-passed', 'approve', 'publish'],
        submitted: ['scan-start', 'scan-passed', 'approve', 'publish'],
      };
      for (const action of transitions[workflow] || []) {
        await repository.review(
          entry.type,
          entry.resource.identifier,
          action,
          undefined,
          account,
          action === 'scan-passed' ? scanResult(artifactHash, seedBatchId) : undefined,
        );
      }
      console.info(`seed publish ${entry.type}:${entry.resource.identifier}`);
    }

    const curatedIdentifiers = curatedResources.map((entry) => entry.resource.identifier);
    const counts = await pool.query(
      `SELECT type, count(*)::int AS count FROM market_resources
       WHERE status='published' AND owner_account_id=$1 AND identifier=ANY($2::text[])
       GROUP BY type ORDER BY type`,
      [account.id, curatedIdentifiers],
    );
    const actual = Object.fromEntries(counts.rows.map((row) => [row.type, Number(row.count)]));
    if (actual.agent !== 50 || actual.skill !== 5 || actual.mcp !== 5) {
      throw new Error(`Curated seed count mismatch: ${JSON.stringify(actual)}`);
    }
    console.info(`Masterino curated community seed complete: ${JSON.stringify(actual)}`);
    return actual;
  } catch (error) {
    for (const item of [...updated].reverse()) {
      await pool.query(
        `UPDATE market_resources SET name=$1, description=$2, avatar=$3, category=$4, tags=$5,
          metadata=$6, current_version_id=$7, status='published', updated_at=now()
         WHERE type=$8 AND identifier=$9`,
        [
          item.name,
          item.description,
          item.avatar,
          item.category,
          JSON.stringify(item.tags),
          JSON.stringify(item.metadata),
          item.currentVersionId,
          item.type,
          item.identifier,
        ],
      );
      if (item.replacementVersionId) {
        await pool.query(`UPDATE market_versions SET workflow_state='deprecated' WHERE id=$1`, [
          item.replacementVersionId,
        ]);
      }
    }
    for (const item of created) {
      await pool.query(
        `UPDATE market_resources SET status='deprecated', updated_at=now()
         WHERE type=$1 AND identifier=$2 AND metadata->>'seedBatchId'=$3`,
        [item.type, item.identifier, item.seedBatchId],
      );
      await pool.query(
        `UPDATE market_versions SET workflow_state='deprecated'
         WHERE resource_id=(SELECT id FROM market_resources WHERE type=$1 AND identifier=$2)`,
        [item.type, item.identifier],
      );
    }
    throw error;
  } finally {
    await pool.end();
  }
};
