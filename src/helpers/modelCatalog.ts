import {
  getModelCatalogFromSettings,
  isPersistedModelChatEligible,
  mergeModelCatalogEntry,
  type PersistedModelCatalog,
} from '@lobechat/business-model-bank';
import {
  type ChatInputModalityConclusion,
  getChatInputModalityConclusion,
  type ModelCatalogEntry,
} from '@lobechat/types/src/modelCatalog';
import type { AiModelType, ModelAbilities } from 'model-bank';

/** The model shape a select row or detail panel has in hand. */
export interface ChatModelCatalogInput {
  abilities?: ModelAbilities;
  id: string;
  providerId?: string;
  settings?: unknown;
  type?: AiModelType;
}

export interface ResolvedChatModelCatalog {
  /**
   * Mirrors B1 `isAiProviderModelChatEligible`: a denied or non-chat catalog kind never
   * renders as a chat row and never becomes a fallback/default selection.
   */
  chatEligible: boolean;
  entry: ModelCatalogEntry;
  inputModality: ChatInputModalityConclusion;
}

const matchPersistedCatalog = (model: ChatModelCatalogInput): PersistedModelCatalog | undefined => {
  const persisted = getModelCatalogFromSettings(model.settings);
  if (!persisted || persisted.entry.modelId !== model.id) return undefined;
  if (model.providerId && persisted.entry.providerId !== model.providerId) return undefined;

  return persisted;
};

/**
 * Resolve the B1 catalog evidence for a UI row.
 *
 * Persisted evidence wins on an exact provider/model match. Otherwise the same fallback
 * merge that B1 uses for chat eligibility runs, with legacy `abilities` booleans acting
 * only as catalog-level modality evidence (never as a chat-kind claim).
 */
export const resolveChatModelCatalog = (model: ChatModelCatalogInput): ResolvedChatModelCatalog => {
  const catalog =
    matchPersistedCatalog(model) ??
    mergeModelCatalogEntry({
      catalog: model.abilities ? { abilities: model.abilities } : undefined,
      modelId: model.id,
      providerId: model.providerId ?? 'unknown',
      providerMetadata:
        model.type && model.type !== 'chat' ? { declaredKind: model.type } : undefined,
    });

  return {
    chatEligible: isPersistedModelChatEligible(catalog),
    entry: catalog.entry,
    inputModality: getChatInputModalityConclusion(catalog.entry),
  };
};
