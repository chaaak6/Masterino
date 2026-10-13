import { getModelCatalogFromSettings, mergeModelCatalogEntry } from '@lobechat/business-model-bank';
import type { ManagedModelRecord } from '@lobechat/types';
import type { AiProviderModelListItem } from 'model-bank';

/** Published metadata never grants access: callers supply already-authorized models. */
export const projectPublishedDescription = (
  model: AiProviderModelListItem,
  record?: ManagedModelRecord,
): AiProviderModelListItem => {
  const published = record?.published;
  if (!published) return model;
  const previous = getModelCatalogFromSettings(model.settings);
  const catalog = mergeModelCatalogEntry({
    modelId: model.id,
    providerId: 'newapi',
    catalog: {
      kind: model.type,
      abilities: model.abilities,
      contextWindowTokens: model.contextWindowTokens,
    },
    providerMetadata: { modelVersion: previous?.entry.modelVersion },
    observed: previous?.observed,
    manual: {
      createdAt: record.updatedAt.toISOString(),
      owner: 'managed-model-catalog',
      reason: record.publishedRevision!,
      kind: published.kind === 'video' ? 'unknown' : published.kind,
      inputModalities: published.inputModalities,
      contextWindowTokens: published.contextWindowTokens ?? undefined,
      maxOutput: published.maxOutput ?? undefined,
    },
  });
  catalog.entry.capabilities = { ...published.capabilities };
  const abilities = { ...model.abilities };
  for (const [key, state] of Object.entries(published.capabilities)) {
    abilities[key as keyof typeof abilities] =
      state === 'unknown' ? undefined : state === 'supported';
  }
  for (const [key, modality] of [
    ['vision', 'image'],
    ['video', 'video'],
    ['files', 'file'],
  ] as const) {
    const state = catalog.entry.inputModalities[modality];
    abilities[key] = state === 'unknown' ? undefined : state === 'supported';
  }
  return {
    ...model,
    displayName: published.displayName,
    organization: published.organization,
    description: published.description,
    abilities,
    contextWindowTokens: catalog.entry.contextWindowTokens,
    type:
      published.kind === 'rerank' || published.kind === 'moderation' || published.kind === 'unknown'
        ? 'embedding'
        : published.kind,
    settings: {
      ...model.settings,
      modelCatalog: catalog,
      managedModelCatalog: { revision: record.publishedRevision!, description: published },
    },
  };
};

/** Rerank/moderation use a legacy embedding DTO type but cannot produce embedding vectors. */
export const matchesEmbeddingKind = (model: { id: string; type: string; settings?: unknown }) => {
  const entry = getModelCatalogFromSettings(model.settings)?.entry;
  return entry?.modelId === model.id ? entry.kind === 'embedding' : model.type === 'embedding';
};
