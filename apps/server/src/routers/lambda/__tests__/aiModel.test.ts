import { describe, expect, it, vi } from 'vitest';
import { ModelProvider } from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';
import { AiInfraRepos } from '@/database/repositories/aiInfra';

import { aiModelRouter } from '../aiModel';

vi.mock('@/database/models/aiModel');
vi.mock('@/database/models/user');
vi.mock('@/database/repositories/aiInfra');
vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: vi.fn().mockReturnValue({
    aiProvider: {},
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    }),
  },
}));

describe('aiModelRouter', () => {
  const mockCtx = {
    userId: 'test-user',
  };
  const newApiProvider = ModelProvider.NewAPI;

  it('should create ai model', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'model-1' });
    const mockFindByIdAndProvider = vi.fn().mockResolvedValue(null);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
          findByIdAndProvider: mockFindByIdAndProvider,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.createAiModel({
      id: 'test-model',
      providerId: newApiProvider,
    });

    expect(result).toBe('model-1');
    expect(mockFindByIdAndProvider).toHaveBeenCalledWith('test-model', newApiProvider);
    expect(mockCreate).toHaveBeenCalledWith({
      id: 'test-model',
      providerId: newApiProvider,
    });
  });

  it('should reject creating models for non-Aihub providers', async () => {
    const mockCreate = vi.fn();
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
          findByIdAndProvider: vi.fn(),
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await expect(
      caller.createAiModel({
        id: 'test-model',
        providerId: 'test-provider',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'This deployment only allows Aihub models',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should reject duplicate ai model before creating', async () => {
    const mockCreate = vi.fn();
    const mockFindByIdAndProvider = vi.fn().mockResolvedValue({ id: 'test-model' });
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
          findByIdAndProvider: mockFindByIdAndProvider,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await expect(
      caller.createAiModel({
        id: 'test-model',
        providerId: newApiProvider,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Model "test-model" already exists',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should convert duplicate insert races to conflict errors', async () => {
    const duplicateError = Object.assign(new Error('failed query'), {
      cause: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'ai_models_id_provider_id_user_id_pk',
      }),
    });
    const mockCreate = vi.fn().mockRejectedValue(duplicateError);
    const mockFindByIdAndProvider = vi.fn().mockResolvedValue(null);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
          findByIdAndProvider: mockFindByIdAndProvider,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await expect(
      caller.createAiModel({
        id: 'test-model',
        providerId: newApiProvider,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Model "test-model" already exists',
    });
  });

  it('should get ai model by id', async () => {
    const mockModel = {
      id: 'model-1',
      name: 'Test Model',
    };
    const mockFindById = vi.fn().mockResolvedValue(mockModel);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          findById: mockFindById,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.getAiModelById({ id: 'model-1' });

    expect(result).toEqual(mockModel);
    expect(mockFindById).toHaveBeenCalledWith('model-1');
  });

  it('should get ai provider model list', async () => {
    const mockModelList = [
      { id: 'model-1', name: 'Model 1' },
      { id: 'model-2', name: 'Model 2' },
    ];
    const mockGetList = vi.fn().mockResolvedValue(mockModelList);
    vi.mocked(AiInfraRepos).mockImplementation(
      () =>
        ({
          getAiProviderModelList: mockGetList,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.getAiProviderModelList({ id: newApiProvider });

    expect(result).toEqual(mockModelList);
    expect(mockGetList).toHaveBeenCalledWith(newApiProvider, {
      enabled: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('should remove ai model', async () => {
    const mockDelete = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.removeAiModel({
      id: 'model-1',
      providerId: newApiProvider,
    });

    expect(mockDelete).toHaveBeenCalledWith('model-1', newApiProvider);
  });

  it('should update ai model', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.updateAiModel({
      id: 'model-1',
      providerId: newApiProvider,
      value: {
        displayName: 'Updated Model',
      },
    });

    expect(mockUpdate).toHaveBeenCalledWith('model-1', newApiProvider, {
      displayName: 'Updated Model',
    });
  });

  it('should toggle model enabled status', async () => {
    const mockToggle = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          toggleModelEnabled: mockToggle,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.toggleModelEnabled({
      id: 'model-1',
      providerId: newApiProvider,
      enabled: true,
      type: 'embedding',
    });

    expect(mockToggle).toHaveBeenCalledWith({
      id: 'model-1',
      providerId: newApiProvider,
      enabled: true,
      type: 'embedding',
    });
  });

  it('should batch toggle ai models', async () => {
    const mockBatchToggle = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          batchToggleAiModels: mockBatchToggle,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.batchToggleAiModels({
      id: newApiProvider,
      models: ['model-1', 'model-2'],
      enabled: true,
    });

    expect(mockBatchToggle).toHaveBeenCalledWith(newApiProvider, ['model-1', 'model-2'], true);
  });

  it('should batch update ai models', async () => {
    const mockBatchUpdate = vi.fn().mockResolvedValue([]);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          batchUpdateAiModels: mockBatchUpdate,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.batchUpdateAiModels({
      id: newApiProvider,
      models: [{ id: 'model-1' }, { id: 'model-2' }],
    });

    expect(mockBatchUpdate).toHaveBeenCalledWith(newApiProvider, [
      { id: 'model-1' },
      { id: 'model-2' },
    ]);
  });

  it('should clear models by provider', async () => {
    const mockClear = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          clearModelsByProvider: mockClear,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.clearModelsByProvider({
      providerId: newApiProvider,
    });

    expect(mockClear).toHaveBeenCalledWith(newApiProvider);
  });

  it('should clear remote models', async () => {
    const mockClearRemote = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          clearRemoteModels: mockClearRemote,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.clearRemoteModels({
      providerId: newApiProvider,
    });

    expect(mockClearRemote).toHaveBeenCalledWith(newApiProvider);
  });
});
