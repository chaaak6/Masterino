import { getModelCatalogFromSettings, mergeModelCatalogEntry } from '@lobechat/business-model-bank';
import type { ManagedModelRecord } from '@lobechat/types';
import type { AiProviderModelListItem } from 'model-bank';

/** Published metadata never grants access: callers supply already-authorized models. */
export const projectPublishedDescription = (
  model: AiProviderModelListItem,
  record?: ManagedModelRecord,
): AiProviderModelListItem => {
  const published = record?.published;
  if (!published && model.type !== 'chat') return model;
  const previous = getModelCatalogFromSettings(model.settings);
  const catalog =
    previous ??
    mergeModelCatalogEntry({
      modelId: model.id,
      providerId: 'newapi',
      catalog: {
        kind: model.type,
        abilities: model.abilities,
        contextWindowTokens: model.contextWindowTokens,
      },
    });
  // Descriptions and reference prices are editorial data. They must not alter
  // routing, context limits, modalities, or any other execution capability.
  const explicitToolSupport = published?.capabilities.functionCall;
  const hasToolDecision =
    model.type === 'chat' ||
    explicitToolSupport === 'supported' ||
    explicitToolSupport === 'unsupported';
  const toolSupport = explicitToolSupport === 'unsupported' ? false : model.type === 'chat';
  const abilities = {
    ...model.abilities,
    ...(hasToolDecision
      ? { functionCall: explicitToolSupport === 'supported' || toolSupport }
      : {}),
  };
  const projectedCatalog = {
    ...catalog,
    entry: {
      ...catalog.entry,
      providerId: 'newapi',
      ...(model.type !== 'embedding' ? { kind: model.type } : {}),
      ...(model.contextWindowTokens !== undefined
        ? { contextWindowTokens: model.contextWindowTokens }
        : {}),
      ...(hasToolDecision
        ? {
            capabilities: {
              ...catalog.entry.capabilities,
              functionCall: abilities.functionCall
                ? ('supported' as const)
                : ('unsupported' as const),
            },
          }
        : {}),
    },
  };
  return {
    ...model,
    ...(published
      ? {
          displayName: published.displayName,
          organization: published.organization,
          description: published.description,
        }
      : {}),
    abilities,
    settings: {
      ...model.settings,
      modelCatalog: projectedCatalog,
      ...(published
        ? { managedModelCatalog: { revision: record!.publishedRevision!, description: published } }
        : {}),
    },
  };
};

/** Runtime model kind, rather than editorial metadata, determines embedding access. */
export const matchesEmbeddingKind = (model: { id: string; type: string; settings?: unknown }) => {
  const entry = getModelCatalogFromSettings(model.settings)?.entry;
  return (
    model.type === 'embedding' &&
    (!entry || entry.modelId !== model.id || entry.kind === 'embedding')
  );
};
