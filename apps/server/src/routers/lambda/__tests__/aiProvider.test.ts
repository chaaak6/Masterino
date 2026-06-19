// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiProviderModel } from '@/database/models/aiProvider';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { type AiProviderDetailItem, type AiProviderRuntimeState } from '@/types/aiProvider';

import { aiProviderRouter } from '../aiProvider';

vi.mock('@/server/globalConfig');
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/database/repositories/aiInfra');
vi.mock('@/database/models/aiProvider');
vi.mock('@/database/models/user');

describe('aiProviderRouter', () => {
  const mockUserId = 'test-user-id';
  const mockProviderId = ModelProvider.NewAPI;
  const mockNonNewApiProviderId = 'test-provider-id';
  const mockEncrypt = vi.fn();
  const mockDecrypt = vi.fn();

  const mockGateKeeper = {
    encrypt: mockEncrypt,
    decrypt: mockDecrypt,
  };

  const mockProviderDetail: AiProviderDetailItem = {
    id: mockProviderId,
    name: 'Aihub',
    enabled: true,
    description: 'Managed Aihub provider',
    source: 'custom',
    settings: {},
  };

  const mockRuntimeState: AiProviderRuntimeState = {
    enabledAiModels: [],
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    runtimeConfig: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getServerGlobalConfig).mockReturnValue({
      aiProvider: {},
    } as any);

    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as any);
  });

  const createMockContext = () => ({
    userId: mockUserId,
  });

  describe('createAiProvider', () => {
    it('should reject custom provider creation', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: mockProviderId });
      vi.mocked(AiProviderModel).prototype.create = mockCreate;

      const caller = aiProviderRouter.createCaller(createMockContext());

      await expect(
        caller.createAiProvider({
          id: mockNonNewApiProviderId,
          name: 'Test Provider',
          source: 'custom',
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Custom providers are disabled in this Aihub-only deployment',
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('getAiProviderById', () => {
    it('should get Aihub provider by id', async () => {
      const mockGetDetail = vi.fn().mockResolvedValue(mockProviderDetail);
      vi.mocked(AiInfraRepos).prototype.getAiProviderDetail = mockGetDetail;

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.getAiProviderById({ id: mockProviderId });

      expect(result).toEqual(mockProviderDetail);
      expect(mockGetDetail).toHaveBeenCalledWith(
        mockProviderId,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
    });

    it('should reject non-Aihub provider ids', async () => {
      const mockGetDetail = vi.fn();
      vi.mocked(AiInfraRepos).prototype.getAiProviderDetail = mockGetDetail;

      const caller = aiProviderRouter.createCaller(createMockContext());

      await expect(
        caller.getAiProviderById({ id: mockNonNewApiProviderId }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'This deployment only allows the Aihub provider',
      });
      expect(mockGetDetail).not.toHaveBeenCalled();
    });
  });

  describe('getAiProviderList', () => {
    it('should only return the Aihub provider', async () => {
      const mockList = [
        mockProviderDetail,
        {
          ...mockProviderDetail,
          id: mockNonNewApiProviderId,
          name: 'Other Provider',
        },
      ];
      const mockGetList = vi.fn().mockResolvedValue(mockList);
      vi.mocked(AiInfraRepos).prototype.getAiProviderList = mockGetList;

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.getAiProviderList();

      expect(result).toEqual([mockProviderDetail]);
      expect(mockGetList).toHaveBeenCalled();
    });
  });

  describe('getAiProviderRuntimeState', () => {
    it('should get AI provider runtime state', async () => {
      const mockGetState = vi.fn().mockResolvedValue(mockRuntimeState);
      vi.mocked(AiInfraRepos).prototype.getAiProviderRuntimeState = mockGetState;

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.getAiProviderRuntimeState({});

      expect(result).toEqual(mockRuntimeState);
      expect(mockGetState).toHaveBeenCalledWith(KeyVaultsGateKeeper.getUserKeyVaults);
    });
  });

  describe('removeAiProvider', () => {
    it('should reject removing the managed Aihub provider', async () => {
      const mockDelete = vi.fn();
      vi.mocked(AiProviderModel).prototype.delete = mockDelete;

      const caller = aiProviderRouter.createCaller(createMockContext());

      await expect(caller.removeAiProvider({ id: mockProviderId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'The Aihub provider is managed by administrator bindings',
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('toggleProviderEnabled', () => {
    it('should keep Aihub enabled', async () => {
      const mockToggle = vi.fn();
      vi.mocked(AiProviderModel).prototype.toggleProviderEnabled = mockToggle;

      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.toggleProviderEnabled({
        id: mockProviderId,
        enabled: true,
      });

      expect(mockToggle).toHaveBeenCalledWith(mockProviderId, true);
    });

    it('should reject disabling Aihub', async () => {
      const mockToggle = vi.fn();
      vi.mocked(AiProviderModel).prototype.toggleProviderEnabled = mockToggle;

      const caller = aiProviderRouter.createCaller(createMockContext());

      await expect(
        caller.toggleProviderEnabled({
          enabled: false,
          id: mockProviderId,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'The Aihub provider cannot be disabled',
      });

      expect(mockToggle).not.toHaveBeenCalled();
    });
  });

  describe('updateAiProvider', () => {
    it('should update the Aihub provider', async () => {
      const mockUpdate = vi.fn();
      vi.mocked(AiProviderModel).prototype.update = mockUpdate;

      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.updateAiProvider({
        id: mockProviderId,
        value: { name: 'Updated Provider' },
      });

      expect(mockUpdate).toHaveBeenCalledWith(mockProviderId, {
        name: 'Updated Provider',
      });
    });
  });

  describe('updateAiProviderConfig', () => {
    it('should update non-credential Aihub provider config', async () => {
      const mockUpdateConfig = vi.fn();
      vi.mocked(AiProviderModel).prototype.updateConfig = mockUpdateConfig;

      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.updateAiProviderConfig({
        id: mockProviderId,
        value: { checkModel: 'gpt-4' },
      });

      expect(mockUpdateConfig).toHaveBeenCalledWith(
        mockProviderId,
        { checkModel: 'gpt-4' },
        mockGateKeeper.encrypt,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
    });
  });

  describe('updateAiProviderOrder', () => {
    it('should update Aihub provider order', async () => {
      const mockUpdateOrder = vi.fn();
      vi.mocked(AiProviderModel).prototype.updateOrder = mockUpdateOrder;

      const sortMap = [{ id: mockProviderId, sort: 1 }];
      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.updateAiProviderOrder({ sortMap });

      expect(mockUpdateOrder).toHaveBeenCalledWith(sortMap);
    });
  });
});
