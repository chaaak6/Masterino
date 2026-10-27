import { createHash } from 'node:crypto';

import type {
  ManagedModelRecord,
  ModelCatalogSettings,
  SilentModelCatalogResponse,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type AiProviderModelListItem, type EnabledAiModel, isAiModelVisible } from 'model-bank';

import { NewApiBindingModel } from '@/database/models/newApiBinding';
import { aiModels } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { NewApiService } from '@/server/services/newApi';
import { resolveAihubDisplayPricing } from '@/server/services/newApi/pricing';

import { projectPublishedDescription } from './projection';
import { ModelCatalogRepository } from './repository';

const CACHE_TTL = 5 * 60_000;
interface Snapshot {
  expiresAt: number;
  models: EnabledAiModel[];
  revision: string;
}
const snapshots = new Map<string, Snapshot>();
const failedUntil = new Map<string, number>();
const inFlight = new Map<string, Promise<Snapshot>>();
let publishedCache: { generation: string; records: ManagedModelRecord[] } | undefined;
// A binding's update time and model preferences may change without changing its token identity.
const snapshotScope = (identity: string) => identity.split(':').slice(0, 3).join(':');

export interface CatalogReadDependencies {
  identity: () => Promise<string>;
  now?: () => number;
  readModels: () => Promise<AiProviderModelListItem[]>;
  records: () => Promise<ManagedModelRecord[]>;
  settings: () => Promise<ModelCatalogSettings>;
}
const stableContent = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableContent);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'fetchedAt')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableContent(item)]),
    );
  return value;
};

/** Cheap unchanged responses; single-flight rebuild retains the last successful snapshot. */
export class EffectiveModelCatalog {
  constructor(private deps: CatalogReadDependencies) {}
  async read(knownRevision?: string, silent = true): Promise<SilentModelCatalogResponse> {
    if (
      process.env.MASTERINO_MODEL_CATALOG_ENABLED === 'false' ||
      (silent && process.env.MASTERINO_SILENT_MODEL_REFRESH_ENABLED === 'false')
    )
      return { status: 'disabled' };
    const settings = await this.deps.settings();
    if (!settings.enabled || (silent && !settings.silentRefreshEnabled))
      return { status: 'disabled' };
    let identity: string;
    try {
      identity = await this.deps.identity();
    } catch {
      return { status: 'unavailable' };
    }
    const key = `${identity}:${settings.generation}`;
    const now = this.deps.now?.() ?? Date.now();
    let snapshot = snapshots.get(key);
    let stale = false;
    if (!snapshot || snapshot.expiresAt <= now) {
      try {
        if ((failedUntil.get(key) ?? 0) > now) throw new Error('Catalog source is backing off');
        let pending = inFlight.get(key);
        if (!pending) {
          pending = (async () => {
            const [records, models] = await Promise.all([
              this.deps.records(),
              this.deps.readModels(),
            ]);
            const byId = new Map(records.map((record) => [record.modelId, record]));
            const projected = models.filter(isAiModelVisible).map((model) => {
              const value = projectPublishedDescription(model, byId.get(model.id));
              return {
                ...value,
                providerId: 'newapi',
                settings: {
                  ...value.settings,
                  aihubPricing: resolveAihubDisplayPricing(value.settings?.aihubPricing) ?? {
                    version: 1 as const,
                    currency: 'CNY' as const,
                    status: 'unavailable' as const,
                  },
                },
              } as EnabledAiModel;
            });
            const revision = createHash('sha256')
              .update(JSON.stringify(stableContent(projected)))
              .digest('hex');
            const next = { models: projected, revision, expiresAt: now + CACHE_TTL };
            // Bounded cache contains only redacted DTOs, never token values.
            if (snapshots.size >= 1000) snapshots.delete(snapshots.keys().next().value!);
            snapshots.set(key, next);
            failedUntil.delete(key);
            return next;
          })();
          inFlight.set(key, pending);
        }
        snapshot = await pending;
      } catch {
        stale = true;
        if (!failedUntil.has(key) || failedUntil.get(key)! <= now) {
          if (failedUntil.size >= 1000) failedUntil.delete(failedUntil.keys().next().value!);
          failedUntil.set(key, now + 30_000);
        }
        // After publication, retain prior-generation data for display on a transient outage.
        snapshot ??= [...snapshots.entries()]
          .reverse()
          .find(([entry]) => entry.startsWith(`${snapshotScope(identity)}:`))?.[1];
        if (!snapshot) return { status: 'unavailable' };
      } finally {
        inFlight.delete(key);
      }
    }
    const revision = stale ? `${snapshot.revision}:stale` : snapshot.revision;
    const models = stale
      ? snapshot.models.map((model) =>
          model.settings?.aihubPricing
            ? {
                ...model,
                settings: {
                  ...model.settings,
                  aihubPricing: {
                    ...model.settings.aihubPricing,
                    stale: true,
                    displayRates: undefined,
                  },
                },
              }
            : model,
        )
      : snapshot.models;
    return knownRevision === revision
      ? { status: 'unchanged', revision, stale }
      : { status: 'changed', revision, models, stale };
  }
}

export const createEffectiveModelCatalog = (db: LobeChatDatabase, userId: string) => {
  const repository = new ModelCatalogRepository(db);
  return new EffectiveModelCatalog({
    settings: () => repository.settings(),
    records: async () => {
      const { generation } = await repository.settings();
      if (publishedCache?.generation !== generation)
        publishedCache = { generation, records: await repository.list() };
      return publishedCache.records;
    },
    readModels: () => new NewApiService({ db, userId }).readAuthorizedModelSnapshot(),
    identity: async () => {
      const [binding, preferences] = await Promise.all([
        new NewApiBindingModel(db, userId).find(),
        db
          .select({
            revision: sql<string>`coalesce(max(${aiModels.updatedAt})::text, '') || ':' || count(*)::text`,
          })
          .from(aiModels)
          .where(
            and(
              eq(aiModels.userId, userId),
              eq(aiModels.providerId, 'newapi'),
              isNull(aiModels.workspaceId),
            ),
          ),
      ]);
      if (!binding?.managedTokenId || !binding.newApiUserId)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Aihub binding is not ready' });
      return `${userId}:${binding.newApiUserId}:${binding.managedTokenId}:${binding.updatedAt?.getTime()}:${preferences[0]?.revision}`;
    },
  });
};

export const applyPublishedModelDescriptions = async <
  T extends {
    id: string;
    abilities?: AiProviderModelListItem['abilities'];
    providerId?: string;
    type: AiProviderModelListItem['type'];
  },
>(
  db: LobeChatDatabase,
  models: T[],
): Promise<T[]> => {
  if (process.env.MASTERINO_MODEL_CATALOG_ENABLED === 'false') return models;
  const repository = new ModelCatalogRepository(db);
  const settings = await repository.settings();
  if (!settings.enabled) return models;
  if (publishedCache?.generation !== settings.generation)
    publishedCache = { generation: settings.generation, records: await repository.list() };
  const byId = new Map(publishedCache.records.map((record) => [record.modelId, record]));
  let changed = false;
  const projected = models.filter(isAiModelVisible).map((model) => {
    if (model.providerId !== 'newapi') return model;
    const next = projectPublishedDescription(
      model as unknown as AiProviderModelListItem,
      byId.get(model.id),
    ) as unknown as T;
    if (next !== model) changed = true;
    return next;
  });
  return changed ? projected : models;
};
