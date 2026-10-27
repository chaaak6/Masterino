import {
  getModelCatalogFromSettings,
  type PersistedModelCatalog,
  recordContextWindowRejectionEvidence,
} from '@lobechat/business-model-bank';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  AiModelSortMap,
  AiProviderModelListItem,
  EnabledAiModel,
  ToggleAiModelEnableParams,
} from 'model-bank';
import { AiModelSourceEnum } from 'model-bank';

import type { AiModelSelectItem, NewAiModelItem } from '../schemas';
import { aiModels } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class AiModelModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * The database column is varchar(10). Remote model feeds can send ISO timestamps
   * such as `2025-01-01T00:00:00.000Z`, which PostgreSQL rejects on insert.
   */
  private normalizeReleasedAt(releasedAt?: string | null) {
    if (!releasedAt) return releasedAt;

    return releasedAt.length > 10 ? releasedAt.slice(0, 10) : releasedAt;
  }

  private normalizeAiModelValues<T extends { releasedAt?: string | null }>(values: T): T {
    return {
      ...values,
      releasedAt: this.normalizeReleasedAt(values.releasedAt),
    };
  }

  /**
   * Helper method to validate if array is empty and return early if needed
   * @param array - Array to validate
   * @returns true if array is empty, false otherwise
   */
  private isEmptyArray(array: unknown[]): boolean {
    return array.length === 0;
  }

  create = async (params: NewAiModelItem) => {
    const values = this.normalizeAiModelValues(params);

    const [result] = await this.db
      .insert(aiModels)
      .values({
        ...values,
        enabled: params.enabled ?? true, // enabled by default, but respect explicit value
        source: AiModelSourceEnum.Custom,
        userId: this.userId,
      })
      .returning();

    return result;
  };

  delete = async (id: string, providerId: string) => {
    return this.db
      .delete(aiModels)
      .where(
        and(
          eq(aiModels.id, id),
          eq(aiModels.providerId, providerId),
          eq(aiModels.userId, this.userId),
        ),
      );
  };

  deleteAll = async () => {
    return this.db.delete(aiModels).where(eq(aiModels.userId, this.userId));
  };

  query = async () => {
    return this.db.query.aiModels.findMany({
      orderBy: [desc(aiModels.updatedAt)],
      where: eq(aiModels.userId, this.userId),
    });
  };

  getModelListByProviderId = async (providerId: string) => {
    const result = await this.db
      .select({
        abilities: aiModels.abilities,
        config: aiModels.config,
        contextWindowTokens: aiModels.contextWindowTokens,
        description: aiModels.description,
        displayName: aiModels.displayName,
        organization: aiModels.organization,
        sort: aiModels.sort,
        enabled: aiModels.enabled,
        id: aiModels.id,
        parameters: aiModels.parameters,
        pricing: aiModels.pricing,
        releasedAt: aiModels.releasedAt,
        settings: aiModels.settings,
        source: aiModels.source,
        type: aiModels.type,
      })
      .from(aiModels)
      .where(and(eq(aiModels.providerId, providerId), eq(aiModels.userId, this.userId)))
      .orderBy(
        asc(aiModels.sort),
        desc(aiModels.enabled),
        desc(aiModels.releasedAt),
        desc(aiModels.updatedAt),
      );

    return result as AiProviderModelListItem[];
  };

  getAllModels = async () => {
    const data = await this.db
      .select({
        abilities: aiModels.abilities,
        config: aiModels.config,
        contextWindowTokens: aiModels.contextWindowTokens,
        displayName: aiModels.displayName,
        description: aiModels.description,
        organization: aiModels.organization,
        sort: aiModels.sort,
        enabled: aiModels.enabled,
        id: aiModels.id,
        parameters: aiModels.parameters,
        providerId: aiModels.providerId,
        releasedAt: aiModels.releasedAt,
        settings: aiModels.settings,
        source: aiModels.source,
        type: aiModels.type,
      })
      .from(aiModels)
      .where(and(eq(aiModels.userId, this.userId)));

    return data as EnabledAiModel[];
  };

  findById = async (id: string) => {
    return this.db.query.aiModels.findFirst({
      where: and(eq(aiModels.id, id), eq(aiModels.userId, this.userId)),
    });
  };

  findByIdAndProvider = async (id: string, providerId: string) => {
    return this.db.query.aiModels.findFirst({
      where: and(
        eq(aiModels.id, id),
        eq(aiModels.providerId, providerId),
        eq(aiModels.userId, this.userId),
      ),
    });
  };

  update = async (id: string, providerId: string, value: Partial<AiModelSelectItem>) => {
    const normalizedValue = this.normalizeAiModelValues(value);

    return this.db
      .insert(aiModels)
      .values({ ...normalizedValue, id, providerId, updatedAt: new Date(), userId: this.userId })
      .onConflictDoUpdate({
        set: normalizedValue,
        target: [aiModels.id, aiModels.providerId, aiModels.userId],
        targetWhere: isNull(aiModels.workspaceId),
      });
  };

  recordContextWindowRejection = async (input: {
    contextWindowRejectionTokens: number;
    modelCatalogSnapshot?: ModelCatalogSnapshot;
    modelId: string;
    modelVersion?: string;
    providerId: string;
    verifiedAt?: string;
  }): Promise<boolean> => {
    const persist = async (db: LobeChatDatabase, lockExisting: boolean) => {
      const scopedModel = new AiModelModel(db, this.userId);
      const ownership = and(
        eq(aiModels.id, input.modelId),
        eq(aiModels.providerId, input.providerId),
        eq(aiModels.userId, this.userId),
        isNull(aiModels.workspaceId),
      );
      let existing: AiModelSelectItem | undefined;
      if (lockExisting) {
        [existing] = await db.select().from(aiModels).where(ownership).limit(1).for('update');
      } else {
        [existing] = await db.select().from(aiModels).where(ownership).limit(1);
      }
      const persistedCatalog = getModelCatalogFromSettings(existing?.settings);
      const snapshotEntry = input.modelCatalogSnapshot?.entry;
      const exactSnapshot =
        snapshotEntry?.modelId === input.modelId && snapshotEntry.providerId === input.providerId
          ? snapshotEntry
          : undefined;
      const baseCatalog: PersistedModelCatalog | undefined =
        persistedCatalog?.entry.modelId === input.modelId &&
        persistedCatalog.entry.providerId === input.providerId
          ? persistedCatalog
          : exactSnapshot
            ? { denied: false, drift: [], entry: exactSnapshot, version: 1 }
            : undefined;
      if (!baseCatalog) return false;

      const modelCatalog = recordContextWindowRejectionEvidence(baseCatalog, {
        contextWindowRejectionTokens: input.contextWindowRejectionTokens,
        modelVersion: input.modelVersion ?? exactSnapshot?.modelVersion,
        verifiedAt: input.verifiedAt ?? new Date().toISOString(),
      });
      const update = {
        contextWindowTokens: modelCatalog.entry.contextWindowTokens,
        settings: { ...existing?.settings, modelCatalog },
      };
      if (existing) {
        await db
          .update(aiModels)
          .set({ ...update, updatedAt: new Date() })
          .where(ownership);
      } else {
        await scopedModel.update(input.modelId, input.providerId, update);
      }
      return true;
    };

    if (typeof this.db.transaction === 'function') {
      return this.db.transaction((transaction) => persist(transaction as LobeChatDatabase, true));
    }
    return persist(this.db, false);
  };

  toggleModelEnabled = async (value: ToggleAiModelEnableParams) => {
    const now = new Date();
    const insertValues = {
      ...value,
      updatedAt: now,
      userId: this.userId,
    } as typeof aiModels.$inferInsert;

    if (value.type) insertValues.type = value.type;

    const updateValues: Partial<typeof aiModels.$inferInsert> = {
      enabled: value.enabled,
      updatedAt: now,
    };

    if (value.type) updateValues.type = value.type;

    return this.db
      .insert(aiModels)
      .values(insertValues)
      .onConflictDoUpdate({
        set: updateValues,
        target: [aiModels.id, aiModels.providerId, aiModels.userId],
        targetWhere: isNull(aiModels.workspaceId),
      });
  };

  batchUpdateAiModels = async (providerId: string, models: AiProviderModelListItem[]) => {
    // Early return if models array is empty to prevent database insertion error
    if (this.isEmptyArray(models)) {
      return [];
    }

    const records = models.map(({ id, ...model }) => ({
      ...model,
      id,
      providerId,
      releasedAt: this.normalizeReleasedAt(model.releasedAt),
      updatedAt: new Date(),
      userId: this.userId,
    }));

    return this.db
      .insert(aiModels)
      .values(records)
      .onConflictDoNothing({
        target: [aiModels.id, aiModels.userId, aiModels.providerId],
        where: isNull(aiModels.workspaceId),
      })
      .returning();
  };

  batchToggleAiModels = async (providerId: string, models: string[], enabled: boolean) => {
    // Early return if models array is empty to prevent database insertion error
    if (this.isEmptyArray(models)) {
      return;
    }

    // Get default model list to preserve type information
    const { loadModels } = await import('@lobechat/business-model-bank/model-config');
    const defaultModels = await loadModels();
    const defaultModelMap = new Map(defaultModels.map((m) => [`${m.providerId}:${m.id}`, m]));

    // Prepare all records for batch upsert
    const allRecords = models.map((modelId) => {
      const defaultModel =
        defaultModelMap.get(`${providerId}:${modelId}`) ??
        defaultModels.find((model) => model.id === modelId);
      const record: typeof aiModels.$inferInsert = {
        enabled,
        id: modelId,
        providerId,
        // if the model is not in the db, it's a builtin model
        source: AiModelSourceEnum.Builtin,
        updatedAt: new Date(),
        userId: this.userId,
      };

      // Preserve type if available from default model list
      if (defaultModel?.type) {
        record.type = defaultModel.type;
      }

      return record;
    });

    // Use batch upsert to handle both insert and update in a single query
    return this.db
      .insert(aiModels)
      .values(allRecords)
      .onConflictDoUpdate({
        set: {
          enabled: sql`excluded.enabled`,
          updatedAt: sql`excluded.updated_at`,
        },
        target: [aiModels.id, aiModels.userId, aiModels.providerId],
        targetWhere: isNull(aiModels.workspaceId),
      });
  };

  clearRemoteModels(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(
        and(
          eq(aiModels.providerId, providerId),
          eq(aiModels.source, AiModelSourceEnum.Remote),
          eq(aiModels.userId, this.userId),
        ),
      );
  }

  clearModelsByProvider(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(and(eq(aiModels.providerId, providerId), eq(aiModels.userId, this.userId)));
  }

  updateModelsOrder = async (providerId: string, sortMap: AiModelSortMap[]) => {
    // Early return if sortMap array is empty
    if (this.isEmptyArray(sortMap)) {
      return;
    }

    await this.db.transaction(async (tx) => {
      const updates = sortMap.map(({ id, sort, type }) => {
        const now = new Date();
        const insertValues: typeof aiModels.$inferInsert = {
          enabled: true,
          id,
          providerId,
          sort,
          // source: isBuiltin ? 'builtin' : 'custom',
          updatedAt: now,
          userId: this.userId,
        };

        if (type) insertValues.type = type;

        const updateValues: Partial<typeof aiModels.$inferInsert> = {
          sort,
          updatedAt: now,
        };

        if (type) updateValues.type = type;

        return tx
          .insert(aiModels)
          .values(insertValues)
          .onConflictDoUpdate({
            set: updateValues,
            target: [aiModels.id, aiModels.userId, aiModels.providerId],
            targetWhere: isNull(aiModels.workspaceId),
          });
      });

      await Promise.all(updates);
    });
  };
}
