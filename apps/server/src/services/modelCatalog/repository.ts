import { randomUUID } from 'node:crypto';

import type {
  ManagedModelDescription,
  ManagedModelRecord,
  ManagedModelRevision,
  ModelCatalogSettings,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';

import {
  enterpriseAuditLogs,
  managedModelCatalog,
  managedModelCatalogRevisions,
  systemConfigs,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const configKey = 'managed_model_catalog';
export const defaultCatalogSettings: ModelCatalogSettings = {
  enabled: true,
  silentRefreshEnabled: true,
  generation: 'initial',
};

export class ModelCatalogRepository {
  constructor(private db: LobeChatDatabase) {}

  async settings(): Promise<ModelCatalogSettings> {
    const [row] = await this.db
      .select()
      .from(systemConfigs)
      .where(and(eq(systemConfigs.key, configKey), eq(systemConfigs.scope, 'global')));
    return { ...defaultCatalogSettings, ...row?.value };
  }
  list = async (): Promise<ManagedModelRecord[]> =>
    this.db.select().from(managedModelCatalog).orderBy(managedModelCatalog.modelId);
  history = async (modelId: string): Promise<ManagedModelRevision[]> =>
    this.db
      .select()
      .from(managedModelCatalogRevisions)
      .where(eq(managedModelCatalogRevisions.modelId, modelId))
      .orderBy(desc(managedModelCatalogRevisions.createdAt));

  private async audit(
    db: LobeChatDatabase,
    actor: string,
    action: string,
    target: string,
    metadata: Record<string, unknown>,
  ) {
    await db
      .insert(enterpriseAuditLogs)
      .values({
        actorUserId: actor,
        action,
        targetId: target,
        targetType: 'model',
        metadata,
        result: 'success',
      });
  }
  private async bump(
    db: LobeChatDatabase,
    actor: string,
    patch: Partial<ModelCatalogSettings> = {},
  ) {
    // Lock one shared row so publication and switches never lose each other's changes.
    await db
      .insert(systemConfigs)
      .values({ key: configKey, scope: 'global', value: { ...defaultCatalogSettings } })
      .onConflictDoNothing();
    const [row] = await db
      .select()
      .from(systemConfigs)
      .where(and(eq(systemConfigs.key, configKey), eq(systemConfigs.scope, 'global')))
      .for('update');
    const value = { ...defaultCatalogSettings, ...row.value, ...patch, generation: randomUUID() };
    await db
      .update(systemConfigs)
      .set({ value, updatedBy: actor, updatedAt: new Date() })
      .where(eq(systemConfigs.id, row.id));
    return value;
  }
  async updateSettings(
    actor: string,
    patch: Pick<ModelCatalogSettings, 'enabled' | 'silentRefreshEnabled'>,
  ) {
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const value = await this.bump(db, actor, patch);
      await this.audit(db, actor, 'model_catalog.settings', 'settings', patch);
      return value;
    });
  }
  async save(
    actor: string,
    modelId: string,
    expectedVersion: number,
    draft: ManagedModelDescription,
  ) {
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const rows =
        expectedVersion === 0
          ? await db
              .insert(managedModelCatalog)
              .values({ modelId, draft })
              .onConflictDoNothing()
              .returning()
          : await db
              .update(managedModelCatalog)
              .set({
                draft,
                version: sql`${managedModelCatalog.version} + 1`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(managedModelCatalog.modelId, modelId),
                  eq(managedModelCatalog.version, expectedVersion),
                ),
              )
              .returning();
      if (!rows[0])
        throw new TRPCError({
          code: 'CONFLICT',
          message: '模型已被其他管理员修改，请重新打开后编辑。',
        });
      await this.audit(db, actor, 'model_catalog.draft.save', modelId, {
        version: rows[0].version,
      });
      return rows[0];
    });
  }
  async publish(
    actor: string,
    modelId: string,
    expectedVersion: number,
    reason: string,
    rollbackRevision?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const [row] = await db
        .select()
        .from(managedModelCatalog)
        .where(eq(managedModelCatalog.modelId, modelId))
        .for('update');
      if (!row || row.version !== expectedVersion)
        throw new TRPCError({ code: 'CONFLICT', message: '模型版本已变化，请刷新后再发布。' });
      let description = row.draft;
      if (rollbackRevision) {
        const [revision] = await db
          .select()
          .from(managedModelCatalogRevisions)
          .where(
            and(
              eq(managedModelCatalogRevisions.id, rollbackRevision),
              eq(managedModelCatalogRevisions.modelId, modelId),
            ),
          );
        if (!revision) throw new TRPCError({ code: 'NOT_FOUND', message: '历史版本不存在。' });
        description = revision.description;
      }
      const id = randomUUID();
      await db
        .insert(managedModelCatalogRevisions)
        .values({ id, modelId, description, reason, actorUserId: actor });
      const [updated] = await db
        .update(managedModelCatalog)
        .set({
          published: description,
          publishedRevision: id,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(managedModelCatalog.modelId, modelId))
        .returning();
      await this.bump(db, actor);
      await this.audit(
        db,
        actor,
        rollbackRevision ? 'model_catalog.rollback' : 'model_catalog.publish',
        modelId,
        { previousRevision: row.publishedRevision, revision: id, rollbackRevision, reason },
      );
      return updated;
    });
  }
}
