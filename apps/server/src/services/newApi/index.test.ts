// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bindingStore: new Map<string, any>(),
  batchUpdateAiModels: vi.fn(),
  clearRemoteModels: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  findUserByUsername: vi.fn(),
  toggleProviderEnabled: vi.fn(),
  updateConfig: vi.fn(),
  updateSyncState: vi.fn(),
  upsertBinding: vi.fn(),
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn().mockImplementation(() => ({
    batchUpdateAiModels: mocks.batchUpdateAiModels,
    clearRemoteModels: mocks.clearRemoteModels,
  })),
}));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(() => ({
    toggleProviderEnabled: mocks.toggleProviderEnabled,
    updateConfig: mocks.updateConfig,
  })),
}));

vi.mock('@/database/models/newApiBinding', () => ({
  NewApiBindingModel: vi.fn().mockImplementation((_db, userId: string) => ({
    find: vi.fn(async () => mocks.bindingStore.get(userId)),
    updateSyncState: vi.fn(async (params) => {
      mocks.updateSyncState(params);
      const existing = mocks.bindingStore.get(userId);
      if (existing) mocks.bindingStore.set(userId, { ...existing, ...params });
    }),
    upsert: vi.fn(async (params) => {
      mocks.upsertBinding(params);
      const binding = {
        errorMessage: null,
        lastSyncedAt: null,
        managedTokenId: params.managedTokenId ?? null,
        status: params.status ?? 'pending',
        updatedAt: new Date(),
        userId,
        ...params,
      };
      mocks.bindingStore.set(userId, binding);
      return [binding];
    }),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: {
    findByEmail: mocks.findUserByEmail,
    findById: mocks.findUserById,
    findByUsername: mocks.findUserByUsername,
  },
}));

import { NewApiService } from './index';

const createGateKeeper = () =>
  ({
    decrypt: vi.fn(async (value: string) => ({
      plaintext: value.replace(/^enc:/, ''),
      wasAuthentic: true,
    })),
    encrypt: vi.fn(async (value: string) => `enc:${value}`),
  }) as any;

describe('NewApiService', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mathRandomSpy?.mockRestore();
    mathRandomSpy = undefined;
    mocks.bindingStore.clear();
    process.env.AIHUB_PROXY_URL = 'https://aihub.internal';
    process.env.AIHUB_ADMIN_USER_ID = '1';
    process.env.AIHUB_ADMIN_ACCESS_TOKEN = 'admin-token';
    process.env.AIHUB_DATA_SOURCE = 'hybrid';
    process.env.AIHUB_MANAGED_TOKEN_NAME = 'masterlion-managed';
    delete process.env.AIHUB_READONLY_DATABASE_URL;
    delete process.env.AIHUB_DEFAULT_MODEL;
    delete process.env.AIHUB_HIDDEN_MODELS;
  });

  it('imports a binding by matching the MasterLion email to an Aihub user with admin auth', async () => {
    mocks.findUserByEmail.mockResolvedValue({
      email: 'ada@example.com',
      id: 'lobe-user',
      username: 'ada',
    });
    const client = {
      searchUsers: vi.fn().mockResolvedValue({
        items: [{ email: 'ada@example.com', id: 7, username: 'ada' }],
        total: 1,
      }),
    };
    const readOnlyDb = {
      findUserByIdentity: vi.fn().mockResolvedValue(undefined),
      findManagedToken: vi.fn().mockResolvedValue({
        id: 12,
        key: 'sk-managed',
        name: 'masterlion-managed',
      }),
      isEnabled: vi.fn(() => true),
    };
    const service = new NewApiService({
      client: client as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'admin-user',
    });

    const result = await service.importBindings([{ email: 'ada@example.com' }]);

    expect(result).toEqual([
      { lobeUserId: 'lobe-user', newApiUserId: 7, ok: true, source: 'admin-api' },
    ]);
    expect(client.searchUsers).toHaveBeenCalledWith(
      { accessToken: 'admin-token', newApiUserId: 1 },
      { keyword: 'ada@example.com', pageSize: 20 },
    );
    expect(mocks.upsertBinding).toHaveBeenCalledWith({
      encryptedAccessToken: null,
      newApiUserId: 7,
      status: 'pending',
    });
    expect(readOnlyDb.findManagedToken).toHaveBeenCalledWith(7, 'masterlion-managed');
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        keyVaults: {
          apiKey: 'sk-managed',
          baseURL: 'https://aihub.internal',
        },
      }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(mocks.toggleProviderEnabled).toHaveBeenCalledWith('newapi', true);
    expect(mocks.updateSyncState).toHaveBeenCalledWith({
      errorMessage: null,
      lastSyncedAt: expect.any(Date),
      managedTokenId: 12,
      status: 'active',
    });
  });

  it('still supports the legacy per-user access token import path', async () => {
    mocks.findUserById.mockResolvedValue({
      email: 'grace@example.com',
      id: 'lobe-user',
      username: 'grace',
    });
    const client = {
      createToken: vi.fn().mockResolvedValue(undefined),
      getSelf: vi.fn().mockResolvedValue({ id: 9, quota: 100, username: 'grace' }),
      getTokenKey: vi.fn().mockResolvedValue({ key: 'sk-created' }),
      listTokens: vi
        .fn()
        .mockResolvedValueOnce({ items: [], total: 0 })
        .mockResolvedValueOnce({
          items: [{ id: 21, name: 'masterlion-managed' }],
          total: 1,
        }),
    };
    const service = new NewApiService({
      client: client as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      userId: 'admin-user',
    });

    const result = await service.importBindings([
      {
        lobeUserId: 'lobe-user',
        newApiAccessToken: 'user-access-token',
        newApiUserId: 9,
      },
    ]);

    expect(result).toEqual([
      { lobeUserId: 'lobe-user', newApiUserId: 9, ok: true, source: 'direct-token' },
    ]);
    expect(client.getSelf).toHaveBeenCalledWith({
      accessToken: 'user-access-token',
      newApiUserId: 9,
    });
    expect(mocks.upsertBinding).toHaveBeenCalledWith({
      encryptedAccessToken: 'enc:user-access-token',
      newApiUserId: 9,
      status: 'pending',
    });
    expect(client.createToken).toHaveBeenCalled();
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        keyVaults: {
          apiKey: 'sk-created',
          baseURL: 'https://aihub.internal',
        },
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('uses the injected read source instead of administrator impersonation when a binding has no user access token', async () => {
    mocks.findUserByEmail.mockResolvedValue({
      email: 'lin@example.com',
      id: 'lobe-user',
      username: 'lin',
    });
    const client = {
      searchUsers: vi.fn().mockResolvedValue({
        items: [{ email: 'lin@example.com', id: 7, username: 'lin' }],
        total: 1,
      }),
    };
    const readOnlyDb = {
      findUserByIdentity: vi.fn().mockResolvedValue(undefined),
      findManagedToken: vi.fn().mockResolvedValue({
        id: 31,
        key: 'sk-bridge-managed',
        name: 'masterlion-managed',
      }),
      isEnabled: vi.fn(() => true),
    };
    const service = new NewApiService({
      client: client as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'admin-user',
    });

    const result = await service.importBindings([{ email: 'lin@example.com' }]);

    expect(result).toEqual([
      { lobeUserId: 'lobe-user', newApiUserId: 7, ok: true, source: 'admin-api' },
    ]);
    expect(readOnlyDb.findManagedToken).toHaveBeenCalledWith(7, 'masterlion-managed');
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        keyVaults: {
          apiKey: 'sk-bridge-managed',
          baseURL: 'https://aihub.internal',
        },
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('fails fast in bridge mode when the bridge read source is disabled', async () => {
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      newApiUserId: 17,
      status: 'pending',
      userId: 'current-user',
    });
    process.env.AIHUB_DATA_SOURCE = 'bridge';
    const readOnlyDb = {
      findManagedToken: vi.fn(),
      isEnabled: vi.fn(() => false),
    };
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(service.ensureManagedToken()).rejects.toThrow(
      'Aihub read source is required for AIHUB_DATA_SOURCE=bridge',
    );
  });

  it('returns the persisted error state when first auto-bind succeeds but token provisioning fails', async () => {
    process.env.AIHUB_DATA_SOURCE = 'bridge';
    mocks.findUserById.mockResolvedValue({
      email: 'temp@example.com',
      id: 'current-user',
      username: 'temp',
    });
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue(undefined),
      findUserByIdentity: vi.fn().mockResolvedValue({
        email: 'temp@example.com',
        id: 17,
        username: 'temp',
      }),
      isEnabled: vi.fn(() => true),
    };
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(service.getBindingStatus()).resolves.toMatchObject({
      errorMessage: 'Aihub read-only database did not return an active API token for the current user',
      isBound: false,
      newApiUserId: 17,
      status: 'error',
    });
  });

  it('reports an error binding with no Aihub user id as unbound', async () => {
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      errorMessage: 'AIHub provisioning failed',
      managedTokenId: null,
      newApiUserId: null,
      status: 'error',
      userId: 'current-user',
    });
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      userId: 'current-user',
    });

    await expect(service.getBindingStatus()).resolves.toMatchObject({
      errorMessage: 'AIHub provisioning failed',
      isBound: false,
      status: 'error',
    });
  });

  it('does not use a failed binding without a real Aihub user id', async () => {
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      errorMessage: 'AIHub provisioning failed',
      managedTokenId: null,
      newApiUserId: null,
      status: 'error',
      userId: 'current-user',
    });
    const client = {
      listTokens: vi.fn(),
    };
    const readOnlyDb = {
      findManagedToken: vi.fn(),
      isEnabled: vi.fn(() => true),
    };
    const service = new NewApiService({
      client: client as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(service.ensureManagedToken()).rejects.toThrow(
      'Aihub binding is in error state: AIHub provisioning failed',
    );
    expect(readOnlyDb.findManagedToken).not.toHaveBeenCalled();
    expect(client.listTokens).not.toHaveBeenCalled();
  });

  it('allows retrying an error binding when it still has a real Aihub user id', async () => {
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      errorMessage: 'temporary token sync failure',
      managedTokenId: null,
      newApiUserId: 17,
      status: 'error',
      userId: 'current-user',
    });
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 44,
        key: 'sk-recovered',
        name: 'masterlion-managed',
      }),
      isEnabled: vi.fn(() => true),
    };
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(service.ensureManagedToken()).resolves.toEqual({
      key: 'sk-recovered',
      tokenId: 44,
    });
    expect(readOnlyDb.findManagedToken).toHaveBeenCalledWith(17, 'masterlion-managed');
    expect(mocks.updateSyncState).toHaveBeenCalledWith({
      errorMessage: null,
      lastSyncedAt: expect.any(Date),
      managedTokenId: 44,
      status: 'active',
    });
  });

  it('treats a zero Aihub user id as missing and never calls remote services with it', async () => {
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      errorMessage: null,
      managedTokenId: null,
      newApiUserId: 0,
      status: 'pending',
      userId: 'current-user',
    });
    const client = {
      listTokens: vi.fn(),
    };
    const readOnlyDb = {
      findManagedToken: vi.fn(),
      isEnabled: vi.fn(() => true),
    };
    const service = new NewApiService({
      client: client as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(service.getBindingStatus()).resolves.toMatchObject({
      errorMessage: 'Aihub binding does not have a NewAPI user id',
      isBound: false,
      status: 'missing',
    });
    await expect(service.ensureManagedToken()).rejects.toThrow(
      'Aihub binding does not have a NewAPI user id',
    );
    expect(readOnlyDb.findManagedToken).not.toHaveBeenCalled();
    expect(client.listTokens).not.toHaveBeenCalled();
  });

  it('auto-binds the current MasterLion user from Aihub read-only DB and syncs accessible models', async () => {
    mocks.findUserById.mockResolvedValue({
      email: 'neo@example.com',
      id: 'current-user',
      username: 'neo',
    });
    const client = {
      listModels: vi.fn(),
    };
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 44,
        key: 'sk-db-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'manual-token',
      }),
      findUserById: vi.fn().mockResolvedValue({
        email: 'neo@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: 'neo',
      }),
      findUserByIdentity: vi.fn().mockResolvedValue({
        email: 'neo@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: 'neo',
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi
        .fn()
        .mockResolvedValue(['glm-5.2', 'qwen-image-2.0', 'text-embedding-v4']),
    };
    const service = new NewApiService({
      client: client as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    const status = await service.getBindingStatus();
    const synced = await service.syncModels();

    expect(status).toMatchObject({
      isBound: true,
      managedTokenId: 44,
      newApiUserId: 17,
      status: 'active',
    });
    expect(readOnlyDb.findUserByIdentity).toHaveBeenCalledWith({
      email: 'neo@example.com',
      username: 'neo',
    });
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        keyVaults: {
          apiKey: 'sk-db-token',
          baseURL: 'https://aihub.internal',
        },
      }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(synced.models.map((model: any) => model.id)).toEqual([
      'glm-5.2',
      'qwen-image-2.0',
      'text-embedding-v4',
    ]);
    expect(synced.defaultModel).toBe('glm-5.2');
    expect(synced.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilities: expect.objectContaining({
            functionCall: true,
            reasoning: true,
            search: true,
          }),
          id: 'glm-5.2',
          type: 'chat',
        }),
        expect.objectContaining({
          abilities: expect.objectContaining({
            functionCall: false,
          }),
          id: 'qwen-image-2.0',
          type: 'image',
        }),
        expect.objectContaining({
          id: 'text-embedding-v4',
          type: 'embedding',
        }),
      ]),
    );
    expect(mocks.batchUpdateAiModels).toHaveBeenCalledWith(
      'newapi',
      expect.arrayContaining([
        expect.objectContaining({
          abilities: expect.objectContaining({ functionCall: true, reasoning: true }),
          id: 'glm-5.2',
          type: 'chat',
        }),
        expect.objectContaining({ id: 'qwen-image-2.0', type: 'image' }),
        expect.objectContaining({ id: 'text-embedding-v4', type: 'embedding' }),
      ]),
    );
    expect(client.listModels).not.toHaveBeenCalled();
  });

  it('falls back to a random chat model when the Aihub default model is not accessible', async () => {
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.7);
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      errorMessage: null,
      lastSyncedAt: null,
      managedTokenId: 44,
      newApiUserId: 17,
      status: 'active',
      userId: 'current-user',
    });
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 44,
        key: 'sk-db-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'manual-token',
      }),
      findUserById: vi.fn().mockResolvedValue({
        group: 'default',
        id: 17,
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi
        .fn()
        .mockResolvedValue(['deepseek-v4-flash', 'kimi-k2.7-code', 'minimax-m3']),
    };
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    const synced = await service.syncModels();

    expect(synced.defaultModel).toBe('minimax-m3');
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        checkModel: 'minimax-m3',
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('falls back when compact GLM aliases are present without the exact Aihub default model id', async () => {
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      errorMessage: null,
      lastSyncedAt: null,
      managedTokenId: 44,
      newApiUserId: 17,
      status: 'active',
      userId: 'current-user',
    });
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 44,
        key: 'sk-db-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'manual-token',
      }),
      findUserById: vi.fn().mockResolvedValue({
        group: 'default',
        id: 17,
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi.fn().mockResolvedValue(['gpt-4o-mini', 'glm5.1', 'deepseek-chat']),
    };
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    const synced = await service.syncModels();

    expect(synced.defaultModel).toBe('gpt-4o-mini');
  });

  it('keeps separated compact GLM aliases as ordinary Aihub chat models', async () => {
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    mocks.bindingStore.set('current-user', {
      encryptedAccessToken: null,
      errorMessage: null,
      lastSyncedAt: null,
      managedTokenId: 44,
      newApiUserId: 17,
      status: 'active',
      userId: 'current-user',
    });
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 44,
        key: 'sk-db-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'manual-token',
      }),
      findUserById: vi.fn().mockResolvedValue({
        group: 'default',
        id: 17,
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi.fn().mockResolvedValue(['gpt-4o-mini', 'glm5-5.1', 'deepseek-chat']),
    };
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    const synced = await service.syncModels();

    expect(synced.defaultModel).toBe('gpt-4o-mini');
    expect(synced.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'glm5-5.1',
          enabled: true,
          id: 'glm5-5.1',
          type: 'chat',
        }),
      ]),
    );
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        checkModel: 'gpt-4o-mini',
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('does not auto-bind enterprise WeCom users without a provisioning-created binding', async () => {
    mocks.findUserById.mockResolvedValue({
      email: 'enterprise@example.com',
      id: 'current-user',
      username: '10193226',
    });
    const db = {
      query: {
        account: {
          findFirst: vi.fn().mockResolvedValue({
            accountId: '10193226',
            providerId: 'wecom',
            userId: 'current-user',
          }),
        },
      },
    };
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 13,
        key: 'sk-bridge-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'masterlion-managed',
      }),
      findUserById: vi.fn().mockResolvedValue({
        email: 'enterprise@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: '10193226',
      }),
      findUserByIdentity: vi.fn().mockResolvedValue({
        email: 'enterprise@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: '10193226',
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi.fn().mockResolvedValue(['gpt-4o-mini']),
    };
    const service = new NewApiService({
      client: {} as any,
      db: db as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(service.getBindingStatus()).resolves.toMatchObject({
      errorMessage: 'Aihub provisioning is managed by enterprise provisioning policy',
      isBound: false,
      status: 'missing',
    });

    expect(db.query.account.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.findUserById).not.toHaveBeenCalled();
    expect(readOnlyDb.findUserByIdentity).not.toHaveBeenCalled();
    expect(mocks.upsertBinding).not.toHaveBeenCalled();
  });

  it('does not auto-bind enterprise WeCom users before managed token or model sync', async () => {
    mocks.findUserById.mockResolvedValue({
      email: 'enterprise@example.com',
      id: 'current-user',
      username: '10193226',
    });
    const db = {
      query: {
        account: {
          findFirst: vi.fn().mockResolvedValue({
            accountId: '10193226',
            providerId: 'wecom',
            userId: 'current-user',
          }),
        },
      },
    };
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 13,
        key: 'sk-bridge-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'masterlion-managed',
      }),
      findUserById: vi.fn().mockResolvedValue({
        email: 'enterprise@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: '10193226',
      }),
      findUserByIdentity: vi.fn().mockResolvedValue({
        email: 'enterprise@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: '10193226',
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi.fn().mockResolvedValue(['gpt-4o-mini']),
    };
    const service = new NewApiService({
      client: {} as any,
      db: db as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(service.ensureManagedToken()).rejects.toThrow(
      'Aihub provisioning is managed by enterprise provisioning policy',
    );
    mocks.bindingStore.clear();

    const syncService = new NewApiService({
      client: {} as any,
      db: db as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    await expect(syncService.syncModels()).rejects.toThrow(
      'Aihub provisioning is managed by enterprise provisioning policy',
    );

    expect(db.query.account.findFirst).toHaveBeenCalledTimes(2);
    expect(readOnlyDb.findUserByIdentity).not.toHaveBeenCalled();
    expect(mocks.upsertBinding).not.toHaveBeenCalled();
  });

  it('covers the bridge-backed user journey: bind, choose models, read balance, and aggregate usage', async () => {
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    process.env.AIHUB_DATA_SOURCE = 'bridge';
    process.env.AIHUB_USAGE_PAGE_SIZE = '2';
    mocks.findUserById.mockResolvedValue({
      email: '10193226@example.com',
      id: 'current-user',
      username: '10193226',
    });
    const client = {
      getStatus: vi.fn().mockResolvedValue({
        quota_display_type: 'CNY',
        quota_per_unit: 500_000,
        usd_exchange_rate: 7.12,
      }),
      listModels: vi.fn(),
    };
    const account = {
      email: '10193226@example.com',
      group: 'vip',
      id: 6,
      quota: 10_000,
      request_count: 11,
      used_quota: 1_250,
      username: '10193226',
    };
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 13,
        key: 'sk-bridge-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'CC',
        remain_quota: 8_750,
        unlimited_quota: false,
        used_quota: 1_250,
      }),
      findUserById: vi.fn().mockResolvedValue(account),
      findUserByIdentity: vi.fn().mockResolvedValue(account),
      getUsageLogs: vi
        .fn()
        .mockResolvedValueOnce({
          items: [
            {
              completion_tokens: 20,
              created_at: 1_700_000_000,
              id: 101,
              model_name: 'gpt-4o-mini',
              prompt_tokens: 10,
              quota: 3,
              request_id: 'req-101',
              token_name: 'CC',
            },
            {
              completion_tokens: 40,
              created_at: 1_700_000_100,
              id: 102,
              model_name: 'deepseek-chat',
              prompt_tokens: 30,
              quota: 7,
              request_id: 'req-102',
              token_name: 'CC',
            },
          ],
          total: 3,
        })
        .mockResolvedValueOnce({
          items: [
            {
              completion_tokens: 8,
              created_at: 1_700_000_200,
              id: 103,
              model_name: 'gpt-4o-mini',
              prompt_tokens: 12,
              quota: 2,
              request_id: 'req-103',
              token_name: 'CC',
            },
          ],
          total: 3,
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi.fn().mockResolvedValue(['gpt-4o-mini', 'glm5.1', 'deepseek-chat']),
      listManagedTokens: vi.fn().mockResolvedValue([
        { id: 13, name: 'masterlion-managed' },
        { id: 12, name: 'masterlion-managed' },
      ]),
    };
    const service = new NewApiService({
      client: client as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    const status = await service.getBindingStatus();
    const synced = await service.syncModels();
    const summary = await service.getAccountSummary();
    const usage = await service.getUsageSummary({ endTimestamp: 1_700_001_000, startTimestamp: 1 });

    expect(status).toMatchObject({
      isBound: true,
      managedTokenId: 13,
      managedTokens: [
        { id: 13, name: 'masterlion-managed' },
        { id: 12, name: 'masterlion-managed' },
      ],
      newApiUserId: 6,
      status: 'active',
    });
    expect(synced.models.map((model: any) => model.id)).toEqual([
      'gpt-4o-mini',
      'glm5.1',
      'deepseek-chat',
    ]);
    expect(summary).toMatchObject({
      email: '10193226@example.com',
      group: 'vip',
      newApiUserId: 6,
      quotaPolicy: {
        quotaDisplayType: 'CNY',
        quotaPerUnit: 500_000,
        usdExchangeRate: 7.12,
      },
      quota: 10_000,
      requestCount: 11,
      usedQuota: 1_250,
      username: '10193226',
    });
    expect(usage.quotaPolicy).toEqual({
      quotaDisplayType: 'CNY',
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.12,
    });
    expect(usage.tokenUsage).toMatchObject({
      modelLimitsEnabled: false,
      name: 'CC',
      totalAvailable: 8_750,
      totalGranted: 10_000,
      totalUsed: 1_250,
    });
    expect(usage.byModel['gpt-4o-mini']).toMatchObject({
      completionTokens: 28,
      promptTokens: 22,
      requests: 2,
      totalTokens: 50,
    });
    expect(usage.byModel['deepseek-chat']).toMatchObject({
      completionTokens: 40,
      promptTokens: 30,
      requests: 1,
      totalTokens: 70,
    });
    expect(readOnlyDb.getUsageLogs).toHaveBeenNthCalledWith(1, 6, {
      endTimestamp: 1_700_001_000,
      page: 1,
      pageSize: 2,
      startTimestamp: 1,
    });
    expect(readOnlyDb.getUsageLogs).toHaveBeenNthCalledWith(2, 6, {
      endTimestamp: 1_700_001_000,
      page: 2,
      pageSize: 2,
      startTimestamp: 1,
    });
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      'newapi',
      expect.objectContaining({
        checkModel: 'gpt-4o-mini',
        keyVaults: {
          apiKey: 'sk-bridge-token',
          baseURL: 'https://aihub.internal',
        },
      }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(client.listModels).not.toHaveBeenCalled();
  });

  it('filters out models listed in AIHUB_HIDDEN_MODELS during sync', async () => {
    process.env.AIHUB_HIDDEN_MODELS = 'glm-5.1,gpt-3.5-turbo';
    mocks.findUserById.mockResolvedValue({
      email: 'neo@example.com',
      id: 'current-user',
      username: 'neo',
    });
    const readOnlyDb = {
      findManagedToken: vi.fn().mockResolvedValue({
        id: 44,
        key: 'sk-db-token',
        model_limits: '',
        model_limits_enabled: false,
        name: 'manual-token',
      }),
      findUserById: vi.fn().mockResolvedValue({
        email: 'neo@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: 'neo',
      }),
      findUserByIdentity: vi.fn().mockResolvedValue({
        email: 'neo@example.com',
        group: 'default',
        id: 17,
        quota: 900,
        request_count: 4,
        used_quota: 100,
        username: 'neo',
      }),
      isEnabled: vi.fn(() => true),
      listAccessibleModels: vi
        .fn()
        .mockResolvedValue(['glm-5.1', 'glm-5.2', 'gpt-3.5-turbo', 'deepseek-chat']),
    };
    const service = new NewApiService({
      client: {} as any,
      db: {} as any,
      gateKeeper: createGateKeeper(),
      readOnlyDb: readOnlyDb as any,
      userId: 'current-user',
    });

    const synced = await service.syncModels();

    expect(synced.models.map((model: any) => model.id)).toEqual(['glm-5.2', 'deepseek-chat']);
    expect(synced.defaultModel).toBe('glm-5.2');
    expect(mocks.batchUpdateAiModels).toHaveBeenCalledWith(
      'newapi',
      expect.arrayContaining([
        expect.objectContaining({ id: 'glm-5.2' }),
        expect.objectContaining({ id: 'deepseek-chat' }),
      ]),
    );
    expect(mocks.batchUpdateAiModels).not.toHaveBeenCalledWith(
      'newapi',
      expect.arrayContaining([expect.objectContaining({ id: 'glm-5.1' })]),
    );
    expect(mocks.batchUpdateAiModels).not.toHaveBeenCalledWith(
      'newapi',
      expect.arrayContaining([expect.objectContaining({ id: 'gpt-3.5-turbo' })]),
    );
  });
});
