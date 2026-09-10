import '../_testFixtures/emptySkills';

import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockCreateServerAgentToolsEngine, mockMessageCreate } = vi.hoisted(
  () => ({
    mockCreateOperation: vi.fn(),
    mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
      generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
      getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
    }),
    mockMessageCreate: vi.fn(),
  }),
);

const { mockDeviceProxy } = vi.hoisted(() => ({
  mockDeviceProxy: {
    cleanupScratchWorkspace: vi.fn(),
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

const {
  MockWorkspaceAlreadyBoundError,
  mockBindingBind,
  mockBindingGetState,
  mockBuildAccessRoots,
  mockDecryptWorkspaceEnv,
  mockDeleteScratch,
  mockFindAiModel,
  mockFindWorkspaceById,
  mockGetOrCreateWorkspace,
  mockGetUserSettings,
} = vi.hoisted(() => ({
  MockWorkspaceAlreadyBoundError: class WorkspaceAlreadyBoundError extends Error {
    readonly scratchWorkspaceId?: string;

    constructor(scratchWorkspaceId?: string) {
      super('WORKSPACE_ALREADY_BOUND');
      this.scratchWorkspaceId = scratchWorkspaceId;
    }
  },
  mockBindingBind: vi.fn(),
  mockBindingGetState: vi.fn(),
  mockBuildAccessRoots: vi.fn(),
  mockDecryptWorkspaceEnv: vi.fn(),
  mockDeleteScratch: vi.fn(),
  mockFindAiModel: vi.fn(),
  mockFindWorkspaceById: vi.fn(),
  mockGetOrCreateWorkspace: vi.fn(),
  mockGetUserSettings: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(() => ({
    findByDeviceId: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn().mockImplementation(() => ({
    findByIdAndProvider: mockFindAiModel,
    getAllModels: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/projectWorkspace', () => ({
  ProjectWorkspaceModel: vi.fn().mockImplementation(() => ({
    deleteScratch: mockDeleteScratch,
    findById: mockFindWorkspaceById,
    getOrCreate: mockGetOrCreateWorkspace,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: mockGetUserSettings,
  })),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({ decrypt: mockDecryptWorkspaceEnv }),
  },
}));

vi.mock('@/server/services/projectWorkspace/bindingStore', () => ({
  DatabaseTopicWorkspaceBindingStore: vi.fn().mockImplementation(() => ({
    bind: mockBindingBind,
    captureTargetIfAbsent: vi.fn(),
    getState: mockBindingGetState,
  })),
  WorkspaceAlreadyBoundError: MockWorkspaceAlreadyBoundError,
}));

vi.mock('@/server/services/workspaceAccessGrant', () => ({
  WorkspaceAccessGrantService: vi.fn().mockImplementation(() => ({
    buildAccessRoots: mockBuildAccessRoots,
  })),
}));

const topicMock = {
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  updateMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => topicMock),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: mockDeviceProxy,
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService.execAgent - device auto-activation', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  it.each([undefined, 'organization-workspace'])(
    'keeps device project skills visible with organization scope %s',
    async (workspaceId) => {
      service = new AiAgentService(mockDb, userId, { workspaceId });
      vi.spyOn(service as any, 'resolveWorkspaceInit').mockResolvedValue({
        instructions: [],
        skills: [{ name: 'project-probe', path: '/repo/.agents/skills/project-probe/SKILL.md' }],
      });
      const result = await (service as any).resolveFrozenSkillRegistry({
        activeDeviceId: 'device-1',
        agentId: 'agent-1',
        agentConfig: {},
        skillPolicy: { includeProjectSkills: true },
        executionContext: {
          version: 1,
          cwd: '/repo',
          plan: { kind: 'device', deviceId: 'device-1', target: 'local' },
          workspace: {
            id: 'project-workspace-1',
            kind: 'device',
            deviceId: 'device-1',
            rootPath: '/repo',
          },
        },
        topicId: 'topic-1',
      });
      expect(result.skills).toContainEqual(
        expect.objectContaining({
          name: 'project-probe',
          source: 'project',
          ownerId: 'project-workspace-1',
        }),
      );
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    topicMock.updateMetadata.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockBuildAccessRoots.mockResolvedValue([]);
    // Reset device proxy state
    mockDeviceProxy.isConfigured = false;
    mockDeviceProxy.cleanupScratchWorkspace.mockResolvedValue(undefined);
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]);
    // Production binding storage returns an empty state for an existing,
    // intentionally-unbound topic. `undefined` means the topic row itself is
    // missing and must fail closed under the authoritative snapshot contract.
    mockBindingGetState.mockResolvedValue({});
    mockBindingBind.mockReset();
    mockDeleteScratch.mockResolvedValue(undefined);
    mockFindWorkspaceById.mockResolvedValue(undefined);
    mockFindAiModel.mockResolvedValue(undefined);
    mockGetOrCreateWorkspace.mockReset();
    mockGetUserSettings.mockResolvedValue({});
    mockDecryptWorkspaceEnv.mockImplementation(async (value: string) => ({
      plaintext: value.replace(/^enc:/, ''),
      wasAuthentic: true,
    }));

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const onlineDevice = {
    deviceId: 'device-001',
    hostname: 'my-laptop',
    lastSeen: '2026-03-06T12:00:00.000Z',
    online: true,
    platform: 'linux' as const,
  };

  const onlineDevice2 = {
    deviceId: 'device-002',
    hostname: 'my-desktop',
    lastSeen: '2026-03-06T12:00:00.000Z',
    online: true,
    platform: 'darwin' as const,
  };

  describe('operation-frozen workspace authority', () => {
    const bindWorkspace = () => {
      mockBindingGetState.mockResolvedValue({
        snapshot: {
          boundDeviceId: 'device-001',
          target: 'local',
          targetCapturedAt: '2026-09-03T00:00:00.000Z',
          version: 1,
          workspaceBoundAt: '2026-09-03T00:00:00.000Z',
          workspaceId: 'workspace-1',
          workspaceKind: 'device',
        },
        workspace: {
          deviceId: 'device-001',
          id: 'workspace-1',
          kind: 'device',
          rootPath: '/approved/project',
        },
      });
      mockFindWorkspaceById.mockResolvedValue({
        env: {
          PUBLIC_FLAG: { secret: false, value: 'enc:enabled' },
          TOKEN: { secret: true, value: 'enc:resolved-secret' },
        },
        id: 'workspace-1',
        skillPolicy: {
          includeAgentSkills: false,
          includeProjectSkills: true,
          includeUserSkills: false,
          pinned: ['project-skill'],
        },
      });
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
    };

    it('fails closed when canonical topic binding storage is unavailable', async () => {
      mockBindingGetState.mockRejectedValue(new Error('binding store unavailable'));

      await expect(
        service.execAgent({ agentId: 'agent-1', prompt: 'continue in the current workspace' }),
      ).rejects.toThrow('binding store unavailable');
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('recovers a concurrent formal bind after a successful scratch tool and cleans scratch', async () => {
      const now = new Date('2026-09-04T00:00:00.000Z');
      mockGetOrCreateWorkspace.mockResolvedValue({
        createdAt: now,
        deviceId: 'device-001',
        displayName: 'topic-1',
        env: null,
        envFiles: [],
        id: 'scratch-workspace',
        kind: 'scratch',
        lastUsedAt: now,
        repoType: null,
        rootPath: '/tmp/masterino/topic-1',
        scan: null,
        scannedAt: null,
        scopeKey: 'scratch:device-001:/tmp/masterino/topic-1',
        skillPolicy: null,
        updatedAt: now,
        userId,
        workspaceId: null,
      });
      mockBindingBind.mockRejectedValue(new MockWorkspaceAlreadyBoundError());
      const authoritative = {
        snapshot: {
          boundDeviceId: 'device-001',
          target: 'local' as const,
          targetCapturedAt: now.toISOString(),
          version: 1 as const,
          workspaceBoundAt: now.toISOString(),
          workspaceId: 'formal-workspace',
          workspaceKind: 'device' as const,
        },
        workspace: {
          deviceId: 'device-001',
          id: 'formal-workspace',
          kind: 'device' as const,
          rootPath: '/Users/me/formal-project',
        },
      };
      mockBindingGetState.mockResolvedValue(authoritative);
      mockDeviceProxy.cleanupScratchWorkspace.mockResolvedValue({
        removed: true,
        root: '/tmp/masterino/topic-1',
      });

      await expect(
        service.bindScratchAfterToolSuccess({
          deviceId: 'device-001',
          rootPath: '/tmp/masterino/topic-1',
          toolSucceeded: true,
          topicId: 'topic-1',
        }),
      ).resolves.toEqual(authoritative);

      expect(mockDeleteScratch).toHaveBeenCalledWith('scratch-workspace');
      expect(mockDeviceProxy.cleanupScratchWorkspace).toHaveBeenCalledWith({
        deviceId: 'device-001',
        topicId: 'topic-1',
        userId,
      });
    });

    it('keeps the formal bind and scratch evidence when device cleanup fails', async () => {
      const now = new Date('2026-09-04T00:00:00.000Z');
      mockGetOrCreateWorkspace.mockResolvedValue({
        createdAt: now,
        deviceId: 'device-001',
        displayName: 'topic-1',
        env: null,
        envFiles: [],
        id: 'scratch-workspace',
        kind: 'scratch',
        lastUsedAt: now,
        repoType: null,
        rootPath: '/tmp/masterino/topic-1',
        scan: null,
        scannedAt: null,
        scopeKey: 'scratch:device-001:/tmp/masterino/topic-1',
        skillPolicy: null,
        updatedAt: now,
        userId,
        workspaceId: null,
      });
      mockBindingBind.mockRejectedValue(new MockWorkspaceAlreadyBoundError());
      const authoritative = {
        snapshot: {
          boundDeviceId: 'device-001',
          target: 'local' as const,
          targetCapturedAt: now.toISOString(),
          version: 1 as const,
          workspaceBoundAt: now.toISOString(),
          workspaceId: 'formal-workspace',
          workspaceKind: 'device' as const,
        },
        workspace: {
          deviceId: 'device-001',
          id: 'formal-workspace',
          kind: 'device' as const,
          rootPath: '/Users/me/formal-project',
        },
      };
      mockBindingGetState.mockResolvedValue(authoritative);
      mockDeviceProxy.cleanupScratchWorkspace.mockRejectedValue(new Error('device offline'));

      await expect(
        service.bindScratchAfterToolSuccess({
          deviceId: 'device-001',
          rootPath: '/tmp/masterino/topic-1',
          toolSucceeded: true,
          topicId: 'topic-1',
        }),
      ).resolves.toEqual(authoritative);

      expect(mockDeleteScratch).not.toHaveBeenCalled();
    });

    it('keeps the formal bind when catalog deletion fails after confirmed device cleanup', async () => {
      const now = new Date('2026-09-04T00:00:00.000Z');
      mockGetOrCreateWorkspace.mockResolvedValue({
        createdAt: now,
        deviceId: 'device-001',
        displayName: 'topic-1',
        env: null,
        envFiles: [],
        id: 'scratch-workspace',
        kind: 'scratch',
        lastUsedAt: now,
        repoType: null,
        rootPath: '/tmp/masterino/topic-1',
        scan: null,
        scannedAt: null,
        scopeKey: 'scratch:device-001:/tmp/masterino/topic-1',
        skillPolicy: null,
        updatedAt: now,
        userId,
        workspaceId: null,
      });
      mockBindingBind.mockRejectedValue(new MockWorkspaceAlreadyBoundError());
      const authoritative = {
        snapshot: {
          boundDeviceId: 'device-001',
          target: 'local' as const,
          targetCapturedAt: now.toISOString(),
          version: 1 as const,
          workspaceBoundAt: now.toISOString(),
          workspaceId: 'formal-workspace',
          workspaceKind: 'device' as const,
        },
        workspace: {
          deviceId: 'device-001',
          id: 'formal-workspace',
          kind: 'device' as const,
          rootPath: '/Users/me/formal-project',
        },
      };
      mockBindingGetState.mockResolvedValue(authoritative);
      mockDeviceProxy.cleanupScratchWorkspace.mockResolvedValue({
        removed: true,
        root: '/tmp/masterino/topic-1',
      });
      mockDeleteScratch.mockRejectedValue(new Error('database unavailable'));

      await expect(
        service.bindScratchAfterToolSuccess({
          deviceId: 'device-001',
          rootPath: '/tmp/masterino/topic-1',
          toolSucceeded: true,
          topicId: 'topic-1',
        }),
      ).resolves.toEqual(authoritative);

      expect(mockDeleteScratch).toHaveBeenCalledWith('scratch-workspace');
    });

    it('decrypts persisted workspace env and freezes its persisted skill policy', async () => {
      bindWorkspace();

      await service.execAgent({ agentId: 'agent-1', prompt: 'Use the project environment' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.executionContext).toMatchObject({
        cwd: '/approved/project',
        env: {
          secretKeys: ['TOKEN'],
          sources: { PUBLIC_FLAG: 'workspace', TOKEN: 'workspace' },
          values: { PUBLIC_FLAG: 'enabled', TOKEN: 'resolved-secret' },
        },
        workspace: { id: 'workspace-1', rootPath: '/approved/project' },
      });
      expect(createOpArgs.skillRegistryResult.policy).toEqual({
        includeAgentSkills: false,
        includeProjectSkills: true,
        includeUserSkills: false,
        materializeForHeteroCli: 'off',
        pinned: ['project-skill'],
      });
      expect(mockFindWorkspaceById).toHaveBeenCalledWith('workspace-1');
      expect(mockDecryptWorkspaceEnv).toHaveBeenCalledTimes(2);
    });

    it('freezes auto-approve with the operation execution context', async () => {
      bindWorkspace();

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Read an external file without another path prompt',
        userInterventionConfig: { approvalMode: 'auto-run' },
      });

      expect(mockCreateOperation.mock.calls[0][0].executionContext).toMatchObject({
        approvalMode: 'auto-run',
        cwd: '/approved/project',
      });
    });

    it('fails operation creation when a configured env value cannot be authenticated', async () => {
      bindWorkspace();
      mockDecryptWorkspaceEnv.mockResolvedValue({ plaintext: '', wasAuthentic: false });

      await expect(
        service.execAgent({ agentId: 'agent-1', prompt: 'Use the project environment' }),
      ).rejects.toThrow(/Unable to decrypt execution environment/);
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('freezes direct first-party absolute paths as read-only operation candidates', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: '请读取 "/outside/docs" 里的说明',
        userInterventionConfig: { approvalMode: 'manual' },
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const operationRoot = createOpArgs.executionContext.accessRoots.find(
        (root: { source?: string }) => root.source === 'direct-user-message',
      );
      expect(operationRoot).toEqual({
        deviceId: 'device-001',
        modes: ['read'],
        operationId: createOpArgs.operationId,
        rootPath: '/outside/docs',
        scope: 'operation',
        source: 'direct-user-message',
        topicId: 'topic-1',
      });
      expect(createOpArgs.agentConfig.systemRole).not.toContain('/outside/docs');
    });

    it('injects active topic grants into the agent prompt on a later operation', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      mockBuildAccessRoots.mockResolvedValue([
        {
          deviceId: 'device-001',
          grantId: 'grant-private-id',
          modes: ['read', 'write'],
          rootPath: '/approved/additional/',
          scope: 'topic',
          source: 'user-approval',
          topicId: 'topic-1',
        },
      ]);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Continue the prior work',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.agentConfig.systemRole).toContain('<additional_directories>');
      expect(createOpArgs.agentConfig.systemRole).toContain(
        '<directory path="/approved/additional" modes="read,write" scope="topic" />',
      );
      expect(createOpArgs.agentConfig.systemRole).not.toMatch(
        /grant-private-id|device-001|topic-1/,
      );
    });

    it('rejects a reranker even when an exact persisted catalog mislabeled it as chat', async () => {
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementationOnce(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'qwen3-vl-rerank',
              plugins: [],
              provider: 'newapi',
            }),
          }) as any,
      );
      mockFindAiModel.mockResolvedValue({
        settings: {
          modelCatalog: {
            denied: false,
            drift: [],
            entry: {
              abilitySources: { text: 'catalog:chat-kind' },
              contextWindowSource: 'catalog',
              contextWindowTokens: 32_000,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'unknown',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'catalog',
              modelId: 'qwen3-vl-rerank',
              providerId: 'newapi',
            },
            version: 1,
          },
        },
        type: 'chat',
      });
      service = new AiAgentService(mockDb, userId);

      await expect(
        service.execAgent({ agentId: 'agent-1', prompt: 'Rank these documents' }),
      ).rejects.toThrow('MODEL_NOT_CHAT_ELIGIBLE');
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('keeps exact builtin provider chat evidence eligible when catalog persistence fails', async () => {
      mockFindAiModel.mockRejectedValueOnce(new Error('catalog database unavailable'));

      await expect(
        service.execAgent({ agentId: 'agent-1', prompt: 'Use the builtin chat model' }),
      ).resolves.toMatchObject({ success: true });
      expect(mockCreateOperation).toHaveBeenCalledOnce();
    });

    it('uses persisted context-window rejection evidence in the next operation snapshot', async () => {
      mockFindAiModel.mockResolvedValue({
        contextWindowTokens: 32_000,
        settings: {
          modelCatalog: {
            denied: false,
            drift: [
              {
                conflictingSource: 'provider-meta',
                conflictingValue: 128_000,
                field: 'contextWindowTokens',
                selectedSource: 'observed',
                selectedValue: 32_000,
              },
            ],
            entry: {
              abilitySources: { text: 'provider-meta:chat-kind' },
              contextWindowSource: 'observed',
              contextWindowTokens: 32_000,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'unknown',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'provider-meta',
              modelId: 'gpt-4',
              modelVersion: '2026-08-31',
              providerId: 'openai',
              verifiedAt: '2026-09-03T12:00:01.000Z',
            },
            observed: {
              contextWindowRejectionTokens: 32_000,
              modelVersion: '2026-08-31',
              verifiedAt: '2026-09-03T12:00:01.000Z',
            },
            version: 1,
          },
        },
        type: 'chat',
      });

      await service.execAgent({ agentId: 'agent-1', prompt: 'Continue after recovery' });

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          modelCatalogSnapshot: expect.objectContaining({
            entry: expect.objectContaining({
              contextWindowSource: 'observed',
              contextWindowTokens: 32_000,
              modelId: 'gpt-4',
              providerId: 'openai',
            }),
          }),
        }),
      );
    });

    it('freezes an unknown main model as the compatible unverified chat fallback', async () => {
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementationOnce(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'private-unknown-v9',
              plugins: [],
              provider: 'private-provider',
            }),
          }) as any,
      );
      mockFindAiModel.mockRejectedValueOnce(new Error('catalog database unavailable'));
      service = new AiAgentService(mockDb, userId);

      await expect(
        service.execAgent({ agentId: 'agent-1', prompt: 'Continue' }),
      ).resolves.toMatchObject({ success: true });
      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          modelCatalogSnapshot: expect.objectContaining({
            entry: expect.objectContaining({
              kind: 'chat',
              kindSource: 'default',
              modelId: 'private-unknown-v9',
            }),
          }),
        }),
      );
    });

    it('freezes an unknown compression model as the compatible unverified chat fallback', async () => {
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementationOnce(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              chatConfig: { compressionModelId: 'unknown-compressor' },
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
            }),
          }) as any,
      );
      mockFindAiModel
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('catalog database unavailable'));
      service = new AiAgentService(mockDb, userId);

      await expect(
        service.execAgent({ agentId: 'agent-1', prompt: 'Continue' }),
      ).resolves.toMatchObject({ success: true });
      expect(mockFindAiModel).toHaveBeenCalledWith('unknown-compressor', 'openai');
      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          compressionModelCatalogSnapshot: expect.objectContaining({
            entry: expect.objectContaining({
              kind: 'chat',
              kindSource: 'default',
              modelId: 'unknown-compressor',
            }),
          }),
        }),
      );
    });

    it('freezes an Electron local intent to the same online gateway device', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          topicExecutionIntent: {
            platform: 'desktop',
            target: 'local',
            targetDeviceId: 'device-001',
          },
        },
        deviceId: 'device-001',
        prompt: 'Run on this Mac',
      });

      expect(mockDeviceProxy.queryDeviceList).toHaveBeenCalledWith(userId);
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      expect(createOpArgs.executionContext.plan).toEqual({
        deviceId: 'device-001',
        kind: 'device',
        target: 'local',
      });
      expect(topicMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            executionSnapshot: expect.objectContaining({
              boundDeviceId: 'device-001',
              target: 'local',
            }),
          }),
        }),
      );
    });
  });

  describe('IM/Bot scenario with botContext', () => {
    it('should auto-activate when exactly one device is online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should NOT auto-activate when multiple devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT auto-activate when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('IM/Bot scenario with discordContext', () => {
    it('should auto-activate when exactly one device is online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        discordContext: { channelId: 'ch-1', guildId: 'guild-1' },
        prompt: 'Check system info',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });
  });

  describe('Web UI scenario (no botContext/discordContext)', () => {
    // regular chat used to leave activeDeviceId undefined when no
    // device was bound, which caused the local-system system prompt's
    // {{workingDirectory}} / {{hostname}} placeholders to reach the LLM as
    // literals. The model would then waste the first N steps groping for cwd.
    // Now we auto-activate when exactly one device is online — multi-device
    // users still need to bind explicitly, since picking one by recency
    // would be a guess that could route tool calls to the wrong machine.
    it('should auto-activate the only online device', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should NOT auto-activate when multiple devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT auto-activate when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('legacy executionTarget isolation from the desktop platform default', () => {
    const overrideAgencyConfig = async (agencyConfig: Record<string, unknown>) => {
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              agencyConfig,
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );
      service = new AiAgentService(mockDb, userId);
    };

    it('should default desktop to local when legacy web executionTarget is none', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await overrideAgencyConfig({ executionTarget: 'none' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      expect(createOpArgs.executionContext.plan).toMatchObject({ kind: 'device', target: 'local' });
    });

    it('should keep the desktop local default when legacy web executionTarget has a binding', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await overrideAgencyConfig({ boundDeviceId: 'device-001', executionTarget: 'none' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      expect(createOpArgs.executionContext.plan).toMatchObject({ kind: 'device', target: 'local' });
    });

    it('should not let a legacy web sandbox target contaminate the desktop default', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await overrideAgencyConfig({ boundDeviceId: 'device-001', executionTarget: 'sandbox' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      expect(createOpArgs.executionContext.plan).toMatchObject({ kind: 'device', target: 'local' });
    });
  });

  describe('boundDeviceId scenario', () => {
    it('should use boundDeviceId when device is online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      // Override the agent config mock to include boundDeviceId
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              agencyConfig: { boundDeviceId: 'device-001' },
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Run a command',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should NOT activate boundDeviceId when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              agencyConfig: { boundDeviceId: 'device-001' },
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Run a command',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('topic and explicit device binding', () => {
    it('should prefer explicit deviceId over topic and agent bindings when online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);
      topicMock.findById.mockResolvedValue({ metadata: { boundDeviceId: 'device-002' } });

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              agencyConfig: { boundDeviceId: 'device-002' },
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-existing' },
        deviceId: 'device-001',
        prompt: 'Run a command',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      // updateMetadata is called for runningOperation persistence, but not for device binding
      expect(topicMock.updateMetadata).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ boundDeviceId: expect.anything() }),
      );
    });

    // Verifies topic-stored metadata.boundDeviceId is NOT silently reused as
    // the runtime bound device. Setup: topic.metadata says device-002, but the
    // only online device is device-001. If the topic metadata were reused as
    // boundDeviceId, activeDeviceId would be undefined (device-002 is offline).
    // After auto-activate, we instead pick the most-recent online
    // device (device-001) — proving the topic's stale metadata wasn't honored.
    it('should not reuse topic boundDeviceId when no explicit deviceId is provided', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      topicMock.findById.mockResolvedValue({ metadata: { boundDeviceId: 'device-002' } });
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-existing' },
        prompt: 'Run a command',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).not.toBe('device-002');
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should keep explicit topic binding when the bound device is offline', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice2]);

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'device-001',
        prompt: 'Run a command',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
      expect(topicMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ boundDeviceId: 'device-001' }),
        }),
      );
    });
  });

  describe('gateway not configured', () => {
    it('should never set activeDeviceId when gateway is not configured', async () => {
      mockDeviceProxy.isConfigured = false;

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
      expect(mockDeviceProxy.queryDeviceList).not.toHaveBeenCalled();
    });

    it('keeps Electron local intent unrouted instead of falling back to sandbox', async () => {
      mockDeviceProxy.isConfigured = false;

      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          topicExecutionIntent: {
            platform: 'desktop',
            target: 'local',
            targetDeviceId: 'device-001',
          },
        },
        deviceId: 'device-001',
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
      expect(createOpArgs.executionContext.plan).toEqual({
        kind: 'device-unrouted',
        reason: 'bound-device-offline',
        target: 'local',
      });
      expect(mockDeviceProxy.queryDeviceList).not.toHaveBeenCalled();
    });
  });

  describe('topic metadata binding', () => {
    it('should include requested deviceId when creating a new topic', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'device-001',
        prompt: 'Run with device',
      });

      expect(topicMock.create).toHaveBeenCalled();
      const createArgs = topicMock.create.mock.calls[0][0];
      expect(createArgs.metadata?.boundDeviceId).toBe('device-001');
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    // Mirrors the "should not reuse topic boundDeviceId" test above with a
    // different mock shape. Topic metadata stores device-002, but only
    // device-001 is online; if topic metadata leaked into boundDeviceId,
    // activeDeviceId would be undefined (since device-002 is offline). The
    // post-auto-activate picks device-001 instead, confirming the
    // stale topic.metadata.boundDeviceId path is dead.
    it('should not reuse topic metadata bound device when no deviceId is supplied', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      topicMock.findById.mockResolvedValue({
        id: 'topic-1',
        metadata: { boundDeviceId: 'device-002' },
      });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Use topic device',
        appContext: { topicId: 'topic-1' },
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).not.toBe('device-002');
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should not update topic metadata when a new deviceId is provided for existing topic', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice2]);
      topicMock.findById.mockResolvedValue({
        id: 'topic-1',
        metadata: { boundDeviceId: 'device-old' },
      });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Switch device',
        appContext: { topicId: 'topic-1' },
        deviceId: 'device-002',
      });

      // updateMetadata is called for runningOperation persistence, but not for device binding
      expect(topicMock.updateMetadata).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ boundDeviceId: expect.anything() }),
      );
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-002');
    });
  });

  describe('Remote Device tool injection when device is auto-activated', () => {
    it('should mark autoActivated when single device is auto-activated (IM/Bot)', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );
      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      // Device auto-activated → Remote Device tool should be suppressed
      expect(toolsEngineArgs.deviceContext.autoActivated).toBe(true);
    });

    it('should mark autoActivated when boundDeviceId matches an online device', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              agencyConfig: { boundDeviceId: 'device-001' },
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );

      service = new AiAgentService(mockDb, userId);
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Run a command',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(toolsEngineArgs.deviceContext.autoActivated).toBe(true);
    });

    it('should NOT mark autoActivated when multiple devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);

      // Restore default AgentService mock (previous test overrides with boundDeviceId)
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
            getAgentConfig: vi.fn().mockResolvedValue({
              chatConfig: {},
              files: [],
              id: 'agent-1',
              knowledgeBases: [],
              model: 'gpt-4',
              plugins: [],
              provider: 'openai',
              systemRole: 'You are a helpful assistant',
            }),
          }) as any,
      );
      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(toolsEngineArgs.deviceContext.autoActivated).toBeUndefined();
    });

    it('should NOT mark autoActivated when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(toolsEngineArgs.deviceContext.autoActivated).toBeUndefined();
    });
  });
});
