import { supportsEmbeddingDimension } from '@lobechat/business-model-bank';
import { DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS } from '@lobechat/const';
import type { AiProviderRuntimeState } from '@lobechat/types';

import type { MemoryAgentConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

/** A saved chat-model choice must not prevent hourly memory extraction forever. */
export const resolveMemoryEmbeddingConfig = (
  runtimeState: AiProviderRuntimeState,
  selected: MemoryAgentConfig,
  fallback: MemoryAgentConfig,
): MemoryAgentConfig => {
  const isEnabledEmbedding = (config: MemoryAgentConfig) =>
    runtimeState.enabledAiModels.some(
      (model) =>
        model.enabled !== false &&
        model.type === 'embedding' &&
        supportsEmbeddingDimension(model.id, DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS) &&
        model.id === config.model &&
        model.providerId.toLowerCase() === (config.provider || 'openai').toLowerCase(),
    );

  if (isEnabledEmbedding(selected)) return selected;
  if (isEnabledEmbedding(fallback)) return fallback;

  // Keep the strict provider/model authorization error when neither choice is available.
  return selected;
};
