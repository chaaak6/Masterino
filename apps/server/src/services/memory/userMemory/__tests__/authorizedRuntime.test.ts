import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { resolveAuthorizedUserMemoryEmbeddingRuntime } from '../authorizedRuntime';

const mocks = vi.hoisted(() => ({
  getAiProviderRuntimeState: vi.fn(),
  getUserSettings: vi.fn(),
  tryMatchingProviderFrom: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({ getUserSettings: mocks.getUserSettings })),
}));

vi.mock('@/database/repositories/aiInfra', () => {
  const AiInfraRepos = vi.fn(() => ({
    getAiProviderRuntimeState: mocks.getAiProviderRuntimeState,
  })) as any;
  AiInfraRepos.tryMatchingProviderFrom = mocks.tryMatchingProviderFrom;

  return { AiInfraRepos };
});

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    embedding: { model: 'text-embedding-3-large', provider: 'newapi' },
  }),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('resolveAuthorizedUserMemoryEmbeddingRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSettings.mockResolvedValue({});
    mocks.tryMatchingProviderFrom.mockResolvedValue('newapi');
    mocks.getAiProviderRuntimeState.mockResolvedValue({
      enabledAiModels: [
        {
          abilities: {},
          enabled: true,
          id: 'text-embedding-3-large',
          providerId: 'newapi',
          type: 'embedding',
        },
      ],
      enabledAiProviders: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: {
        newapi: { keyVaults: { apiKey: 'managed-user-token' } },
      },
    });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ embeddings: vi.fn() } as any);
  });

  it('requires the exact configured Aihub embedding model and current user token', async () => {
    const db = {} as any;

    const result = await resolveAuthorizedUserMemoryEmbeddingRuntime(db, 'user-1');

    expect(mocks.tryMatchingProviderFrom).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        fallbackProvider: 'newapi',
        modelId: 'text-embedding-3-large',
        preferredProviders: ['newapi'],
        requireModelMatch: true,
        requiredModelType: 'embedding',
      }),
    );
    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(db, 'user-1', 'newapi');
    expect(result).toMatchObject({
      model: 'text-embedding-3-large',
      provider: 'newapi',
    });
  });

  it('uses the current user memory embedding override when present', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: {
        userMemoryEmbedding: { model: 'text-embedding-v4', provider: 'newapi' },
      },
    });

    const result = await resolveAuthorizedUserMemoryEmbeddingRuntime({} as any, 'user-1');

    expect(mocks.tryMatchingProviderFrom).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ modelId: 'text-embedding-v4' }),
    );
    expect(result.model).toBe('text-embedding-v4');
  });

  it('blocks online memory operations when the managed token is missing', async () => {
    mocks.getAiProviderRuntimeState.mockResolvedValue({
      enabledAiModels: [],
      enabledAiProviders: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: { newapi: { keyVaults: {} } },
    });

    await expect(resolveAuthorizedUserMemoryEmbeddingRuntime({} as any, 'user-1')).rejects.toThrow(
      'managed credentials',
    );
    expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
  });
});
