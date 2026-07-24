import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import type { UserServiceModelConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { LobeChatDatabase } from '@/database/type';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { UserMemoryEmbeddingRuntime } from './embedding';

const normalizeProvider = (provider: string) => provider.toLowerCase();

export interface AuthorizedUserMemoryEmbeddingRuntime {
  model: string;
  provider: string;
  runtime: UserMemoryEmbeddingRuntime;
}

const resolveUserMemoryEmbeddingConfig = async (db: LobeChatDatabase, userId: string) => {
  const { embedding } = parseMemoryExtractionConfig();
  const settings = await new UserModel(db, userId).getUserSettings();
  const override = (settings?.systemAgent as Partial<UserServiceModelConfig> | undefined)
    ?.userMemoryEmbedding;

  return {
    model: override?.model || embedding.model || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM.model,
    provider:
      override?.provider || embedding.provider || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM.provider,
  };
};

/**
 * Resolves the online memory embedding runtime from the current user's provider state.
 *
 * The configured provider/model must be enabled for the user and classified as an
 * embedding model. Non-LobeHub providers must also have a user-managed API key;
 * server environment credentials are intentionally not accepted for personal memory.
 */
export const resolveAuthorizedUserMemoryEmbeddingRuntime = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<AuthorizedUserMemoryEmbeddingRuntime> => {
  const config = await resolveUserMemoryEmbeddingConfig(db, userId);
  const configuredProvider = normalizeProvider(config.provider);
  const aiInfraRepos = new AiInfraRepos(db, userId, {});
  const runtimeState = await aiInfraRepos.getAiProviderRuntimeState(
    KeyVaultsGateKeeper.getUserKeyVaults,
  );

  const provider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
    fallbackProvider: configuredProvider,
    label: 'user memory embedding',
    modelId: config.model,
    preferredProviders: [configuredProvider],
    requireModelMatch: true,
    requiredModelType: 'embedding',
  });

  if (provider !== 'lobehub') {
    const providerRuntime = Object.entries(runtimeState.runtimeConfig || {}).find(
      ([providerId]) => normalizeProvider(providerId) === provider,
    )?.[1];
    const apiKey = (providerRuntime?.keyVaults as { apiKey?: unknown } | undefined)?.apiKey;

    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error(
        `Unable to initialize personal memory embedding provider "${provider}" with the current user's managed credentials.`,
      );
    }
  }

  return {
    model: config.model,
    provider,
    runtime: await initModelRuntimeFromDB(db, userId, provider),
  };
};
