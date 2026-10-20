import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';

import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createEffectiveModelCatalog } from '@/server/services/modelCatalog';
import { matchesEmbeddingKind } from '@/server/services/modelCatalog/projection';

import type { UserMemoryEmbeddingRuntime } from './embedding';

const normalizeProvider = (provider: string) => provider.toLowerCase();

export interface AuthorizedUserMemoryEmbeddingRuntime {
  model: string;
  provider: string;
  runtime: UserMemoryEmbeddingRuntime;
}

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
  const configured = DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
  const aiInfraRepos = new AiInfraRepos(db, userId, {});
  const runtimeState = await aiInfraRepos.getAiProviderRuntimeState(
    KeyVaultsGateKeeper.getUserKeyVaults,
  );
  const configuredProvider = normalizeProvider(configured.provider);

  if (configuredProvider === 'newapi') {
    const catalog = await createEffectiveModelCatalog(db, userId).read(undefined, false);
    if (catalog.status === 'changed' && !catalog.stale) {
      runtimeState.enabledAiModels = [
        ...runtimeState.enabledAiModels.filter((model) => model.providerId !== 'newapi'),
        ...catalog.models.filter((model) => model.enabled && matchesEmbeddingKind(model)),
      ];
    } else if (catalog.status !== 'disabled') {
      throw new Error('Current Aihub model catalog is unavailable for personal memory embedding.');
    }
  }

  const provider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
    fallbackProvider: configuredProvider,
    label: 'user memory embedding',
    modelId: configured.model,
    preferredProviders: [configuredProvider],
    requireModelMatch: true,
    requiredModelType: 'embedding',
  });
  if (provider !== configuredProvider) {
    throw new Error(
      `The fixed user memory embedding provider "${configuredProvider}" is unavailable.`,
    );
  }

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
    model: configured.model,
    provider,
    runtime: await initModelRuntimeFromDB(db, userId, provider),
  };
};
