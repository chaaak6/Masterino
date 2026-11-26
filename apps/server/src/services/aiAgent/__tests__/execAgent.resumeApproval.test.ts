import '../_testFixtures/emptySkills';

import type { LobeChatDatabase } from '@lobechat/database';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockFindById,
  mockFindMessagePlugin,
  mockMessageCreate,
  mockMessageQuery,
  mockGetWorkspaceState,
  mockBindScratch,
  mockUpdateMessagePlugin,
  mockUpdateToolMessage,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockFindById: vi.fn(),
  mockFindMessagePlugin: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockGetWorkspaceState: vi.fn(),
  mockBindScratch: vi.fn(),
  mockUpdateMessagePlugin: vi.fn(),
  mockUpdateToolMessage: vi.fn(),
}));

const { mockDeviceProxy } = vi.hoisted(() => ({
  mockDeviceProxy: {
    isConfigured: false,
    ensureScratchWorkspace: vi.fn(),
    queryDeviceList: vi.fn().mockResolvedValue([]),
    queryDeviceSystemInfo: vi.fn().mockResolvedValue(undefined),
    resolveRealPath: vi.fn().mockResolvedValue('/outside/docs'),
  },
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    findById: mockFindById,
    findMessagePlugin: mockFindMessagePlugin,
    query: mockMessageQuery,
    update: vi.fn().mockResolvedValue({}),
    updateMessagePlugin: mockUpdateMessagePlugin,
    updateToolMessage: mockUpdateToolMessage,
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({ queryAgents: vi.fn().mockResolvedValue([]) })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
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
  PluginModel: vi.fn().mockImplementation(() => ({ query: vi.fn().mockResolvedValue([]) })),
}));

vi.mock('@/database/models/projectWorkspace', () => ({
  ProjectWorkspaceModel: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue({ env: {}, id: 'workspace-a' }),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    updateMetadata: vi.fn(),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn().mockImplementation(() => ({
    getLatestPersonaDocument: vi.fn().mockResolvedValue(undefined),
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
  FileService: vi.fn().mockImplementation(() => ({ uploadFromUrl: vi.fn() })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: mockDeviceProxy,
}));

vi.mock('@/server/services/projectWorkspace/bindingStore', () => ({
  DatabaseTopicWorkspaceBindingStore: vi.fn().mockImplementation(() => ({
    captureTargetIfAbsent: vi.fn(),
    getState: mockGetWorkspaceState,
  })),
}));

vi.mock('@/server/services/projectWorkspace', () => ({
  ProjectWorkspaceService: vi.fn().mockImplementation(() => ({
    bindScratchAfterToolSuccess: mockBindScratch,
    resolveAndMigrateTopic: mockGetWorkspaceState,
  })),
}));

vi.mock('@/server/services/workspaceAccessGrant', () => ({
  WorkspaceAccessGrantService: vi.fn().mockImplementation(() => ({
    buildAccessRoots: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService.execAgent - resumeApproval', () => {
  let service: AiAgentService;

  // `messages` row — `findById` returns this. Note plugin metadata (apiName,
  // identifier, etc.) lives in a separate `message_plugins` table.
  const pendingToolMessage = {
    id: 'tool-msg-1',
    role: 'tool',
    sessionId: 'session-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  };
  // `message_plugins` row — fetched via `db.query.messagePlugins.findFirst`.
  const pendingToolPlugin = {
    apiName: 'runCommand',
    arguments: '{"command":"echo"}',
    identifier: 'lobe-local-system',
    toolCallId: 'call_xyz',
    type: 'builtin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockFindById.mockResolvedValue(pendingToolMessage);
    mockFindMessagePlugin.mockResolvedValue(pendingToolPlugin);
    mockMessageQuery.mockResolvedValue([{ content: 'hi', id: 'history-1', role: 'user' }]);
    mockMessageCreate.mockResolvedValue({ id: 'assistant-msg-new' });
    mockGetWorkspaceState.mockResolvedValue({
      snapshot: {
        target: 'none',
        targetCapturedAt: '2026-09-04T00:00:00.000Z',
        version: 1,
      },
    });
    mockUpdateMessagePlugin.mockResolvedValue(undefined);
    mockUpdateToolMessage.mockResolvedValue({ success: true });
    mockDeviceProxy.isConfigured = false;
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]);
    mockDeviceProxy.queryDeviceSystemInfo.mockResolvedValue(undefined);
    // `MessageModel` is fully mocked above, so the service never touches the
    // raw `db` arg — cast an empty stub through `unknown` to satisfy the
    // `LobeChatDatabase` parameter type without dragging the real schema.
    service = new AiAgentService({} as unknown as LobeChatDatabase, 'user-1');
  });

  const baseParams = {
    agentId: 'agent-1',
    appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
    parentMessageId: 'tool-msg-1',
    prompt: '',
  };

  describe('scratch runtime delegate seams', () => {
    it('accepts only a device-authored absolute scratch root and does not bind it yet', async () => {
      mockDeviceProxy.ensureScratchWorkspace.mockResolvedValue({ root: '/scratch/topic-1' });

      await expect(
        service.ensureScratchWorkspace({ deviceId: 'device-a', topicId: 'topic-1' }),
      ).resolves.toEqual({ root: '/scratch/topic-1' });
      expect(mockBindScratch).not.toHaveBeenCalled();
    });

    it('binds scratch only through the explicit successful-tool callback', async () => {
      mockBindScratch.mockResolvedValue({ id: 'workspace-scratch' });

      await service.bindScratchAfterToolSuccess({
        deviceId: 'device-a',
        rootPath: '/scratch/topic-1',
        target: 'local',
        toolSucceeded: true,
        topicId: 'topic-1',
      });

      expect(mockBindScratch).toHaveBeenCalledWith({
        deviceId: 'device-a',
        rootPath: '/scratch/topic-1',
        target: 'local',
        toolSucceeded: true,
        topicId: 'topic-1',
        workspaceId: undefined,
      });
    });
  });

  describe('decision=approved', () => {
    it('keeps the decision pending and creates no assistant when history cannot be loaded', async () => {
      mockMessageQuery.mockRejectedValueOnce(new Error('History unavailable'));

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow('History unavailable');

      expect(mockUpdateMessagePlugin).not.toHaveBeenCalled();
      expect(mockMessageCreate).not.toHaveBeenCalled();
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('persists intervention=approved and seeds initialContext for human_approved_tool', async () => {
      await service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      });

      expect(mockUpdateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
        intervention: { status: 'approved' },
      });
      // `approved` decision never writes tool content — the content arrives
      // when the approved tool actually executes.
      expect(mockUpdateToolMessage).not.toHaveBeenCalled();

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              approvedToolCall: expect.objectContaining({
                apiName: 'runCommand',
                arguments: '{"command":"echo"}',
                id: 'call_xyz',
                identifier: 'lobe-local-system',
              }),
              parentMessageId: 'tool-msg-1',
              skipCreateToolMessage: true,
            }),
            phase: 'human_approved_tool',
          }),
        }),
      );
    });

    it('injects a matching allow-once decision into only the new operation', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([
        {
          deviceId: 'device-a',
          hostname: 'local',
          online: true,
          platform: 'darwin',
        },
      ]);
      mockGetWorkspaceState.mockResolvedValue({
        snapshot: {
          boundDeviceId: 'device-a',
          target: 'local',
          targetCapturedAt: '2026-09-04T00:00:00.000Z',
          version: 1,
        },
      });
      mockFindMessagePlugin.mockResolvedValue({
        ...pendingToolPlugin,
        state: {
          workspacePathConsent: {
            actualCwd: '/workspace',
            deviceId: 'device-a',
            modes: ['read'],
            operationId: 'op-old',
            primaryCwd: '/workspace',
            requestedPath: '/outside/docs',
            topicId: 'topic-1',
            version: 1,
          },
        },
      });

      await service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          pathConsent: {
            deviceId: 'device-a',
            modes: ['read'],
            requestedPath: '/outside/docs',
            rootPath: '/outside/docs',
            scope: 'operation',
            sourceOperationId: 'op-old',
            topicId: 'topic-1',
            version: 1,
          },
          toolCallId: 'call_xyz',
        },
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.executionContext.accessRoots).toContainEqual({
        deviceId: 'device-a',
        modes: ['read'],
        operationId: createOpArgs.operationId,
        rootPath: '/outside/docs',
        scope: 'operation',
        source: 'user-approval',
        topicId: 'topic-1',
      });
      expect(createOpArgs.operationId).not.toBe('op-old');
      expect(mockDeviceProxy.resolveRealPath).toHaveBeenCalledWith({
        deviceId: 'device-a',
        path: '/outside/docs',
        userId: 'user-1',
      });
      expect(mockUpdateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
        intervention: { status: 'approved' },
      });
    });
  });

  // Server handles `rejected` and `rejected_continue` identically — both
  // persist the rejection and resume the LLM with the updated history so it
  // can respond to the user. The client-side split is only about optimistic
  // writes / button UX; beyond the DB write there's nothing meaningful to
  // differentiate once the decision is persisted.
  describe.each([
    ['rejected' as const, 'not appropriate', 'with reason: not appropriate'],
    ['rejected_continue' as const, 'too risky', 'with reason: too risky'],
  ])('decision=%s', (decision, rejectionReason, expectedSuffix) => {
    it(`persists rejection + resumes LLM with user_input phase`, async () => {
      await service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision,
          parentMessageId: 'tool-msg-1',
          rejectionReason,
          toolCallId: 'call_xyz',
        },
      });

      expect(mockUpdateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
        content: `User reject this tool calling ${expectedSuffix}`,
        intervention: { rejectedReason: rejectionReason, status: 'rejected' },
      });
      expect(mockUpdateMessagePlugin).not.toHaveBeenCalled();

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              message: [{ content: '' }],
              parentMessageId: 'tool-msg-1',
            }),
            phase: 'user_input',
          }),
        }),
      );
    });
  });

  describe('resumeInteraction', () => {
    it('seeds the explicit tool_result phase under a server-created operation', async () => {
      await service.execAgent({
        ...baseParams,
        resumeInteraction: {
          parentMessageId: 'tool-msg-1',
          phase: 'tool_result',
        },
      });

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          executionContext: expect.any(Object),
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              isFirstMessage: false,
              parentMessageId: 'tool-msg-1',
            }),
            phase: 'tool_result',
          }),
        }),
      );
    });

    it('accepts user_input only when the persisted parent is a user message', async () => {
      mockFindById.mockResolvedValue({
        id: 'submitted-user-msg',
        role: 'user',
        sessionId: 'session-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      });

      await service.execAgent({
        ...baseParams,
        parentMessageId: 'submitted-user-msg',
        resumeInteraction: {
          parentMessageId: 'submitted-user-msg',
          phase: 'user_input',
        },
      });

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          executionContext: expect.any(Object),
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({ parentMessageId: 'submitted-user-msg' }),
            phase: 'user_input',
          }),
        }),
      );
    });

    it('rejects a forged phase that does not match the persisted parent role', async () => {
      await expect(
        service.execAgent({
          ...baseParams,
          resumeInteraction: {
            parentMessageId: 'tool-msg-1',
            phase: 'user_input',
          },
        }),
      ).rejects.toThrow("requires a role='user' parent message");
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('rejects conflicting approval and interaction resume authority', async () => {
      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
          resumeInteraction: {
            parentMessageId: 'tool-msg-1',
            phase: 'tool_result',
          },
        }),
      ).rejects.toThrow('mutually exclusive');
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });
  });

  it('falls back to the no-reason rejection string when rejectionReason is omitted', async () => {
    await service.execAgent({
      ...baseParams,
      resumeApproval: {
        decision: 'rejected',
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
    });

    expect(mockUpdateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
      content: 'User reject this tool calling without reason',
      intervention: { rejectedReason: undefined, status: 'rejected' },
    });
  });

  describe('validation guards', () => {
    it('rejects an allow-once decision replayed from another operation', async () => {
      mockFindMessagePlugin.mockResolvedValue({
        ...pendingToolPlugin,
        state: {
          workspacePathConsent: {
            actualCwd: '/workspace',
            deviceId: 'device-a',
            modes: ['read'],
            operationId: 'op-old',
            primaryCwd: '/workspace',
            requestedPath: '/outside/docs',
            topicId: 'topic-1',
            version: 1,
          },
        },
      });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            pathConsent: {
              deviceId: 'device-a',
              modes: ['read'],
              requestedPath: '/outside/docs',
              rootPath: '/outside/docs',
              scope: 'operation',
              sourceOperationId: 'op-replayed',
              topicId: 'topic-1',
              version: 1,
            },
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/does not match/);
      expect(mockUpdateMessagePlugin).not.toHaveBeenCalled();
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws when the parent message is not role=tool', async () => {
      mockFindById.mockResolvedValue({ ...pendingToolMessage, role: 'user' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/role='tool'/);
    });

    it('throws when the stored tool_call_id does not match the resume request', async () => {
      // toolCallId lives on the plugin row — mutate the plugin mock, not the
      // message. This is exactly the class of bug that the separate-table
      // fetch guards against.
      mockFindMessagePlugin.mockResolvedValue({ ...pendingToolPlugin, toolCallId: 'call_other' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/toolCallId mismatch/);
    });

    it('throws when no plugin row exists for the target message', async () => {
      mockFindMessagePlugin.mockResolvedValue(undefined);

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/no plugin row/);
    });
  });
});
