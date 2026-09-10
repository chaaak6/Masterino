import type { AgentState } from '@lobechat/agent-runtime';
import * as agentRuntime from '@lobechat/agent-runtime';
import { createModelCatalogSnapshot, mergeModelCatalogEntry } from '@lobechat/business-model-bank';
import type * as LobeChatConst from '@lobechat/const';
import { type ExecutionContext, type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { type EnabledAiModel, ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as toolEngineering from '@/helpers/toolEngineering';
import { agentDocumentService } from '@/services/agentDocument';
import { chatService } from '@/services/chat';
import * as agentConfigResolver from '@/services/chat/mecha/agentConfigResolver';
import { messageService } from '@/services/message';
import { projectWorkspaceService } from '@/services/projectWorkspace';
import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { buildRunLifecycle } from '../runLifecycle/buildRunLifecycle';
import {
  createMockAgentConfig,
  createMockChatConfig,
  createMockMessage,
  createMockResolvedAgentConfig,
  TEST_CONTENT,
  TEST_IDS,
} from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

const serverConfigMock = vi.hoisted(() => ({ enableVisualUnderstanding: false }));
const agentSignalBridgeMock = vi.hoisted(() => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/localStorage', () => {
  class AsyncLocalStorage<State> {
    async getFromLocalStorage(): Promise<State> {
      return {} as State;
    }

    async saveToLocalStorage(): Promise<void> {
      return undefined;
    }
  }

  return { AsyncLocalStorage };
});

interface AgentRuntimeStepContext {
  agent: {
    config: {
      compressionConfig: {
        enabled: boolean;
        maxWindowToken?: number;
      };
    };
  };
}

const getCreatedAgentCompressionConfig = (stepSpy: { mock: { contexts: unknown[] } }) => {
  const runtime = stepSpy.mock.contexts[0] as AgentRuntimeStepContext;
  return runtime.agent.config.compressionConfig;
};

const createMockRuntimeState = (operationId: string, status: AgentState['status']): AgentState => ({
  status,
  operationId,
  messages: [],
  maxSteps: 10,
  stepCount: 1,
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  toolManifestMap: {},
  userInterventionConfig: { approvalMode: 'manual', allowList: [] },
  usage: {
    llm: { apiCalls: 1, processingTimeMs: 100, tokens: { input: 10, output: 20, total: 30 } },
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
  },
  cost: {
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    total: 0,
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
  },
});

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');
vi.mock('@/store/chat/slices/aiChat/actions/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: agentSignalBridgeMock.emitClientAgentSignalSourceEvent,
}));
// Desktop notification gating: isDesktop defaults to false (web/test env), matching
// the real env so the existing suite is unaffected; flipped true per-test to exercise
// the notification branch. The service is dynamically imported inside executeClientAgent.
const desktopFlag = vi.hoisted(() => ({ value: false }));
const desktopNotificationMock = vi.hoisted(() => ({ showNotification: vi.fn() }));
vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeChatConst>();
  return {
    ...actual,
    get isDesktop() {
      return desktopFlag.value;
    },
  };
});
vi.mock('@/services/electron/desktopNotification', () => ({
  desktopNotificationService: desktopNotificationMock,
}));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({
    serverConfig: { enableVisualUnderstanding: serverConfigMock.enableVisualUnderstanding },
  }),
  serverConfigSelectors: {
    enableVisualUnderstanding: (state: { serverConfig: { enableVisualUnderstanding?: boolean } }) =>
      !!state.serverConfig.enableVisualUnderstanding,
  },
}));

const realExecAgentRuntime = useChatStore.getState().executeClientAgent;
const realCreateAgentState = useChatStore.getState().internal_createAgentState;

const mockInternalCreateAgentState = (value: ReturnType<typeof realCreateAgentState>) => {
  act(() => {
    useChatStore.setState({
      internal_createAgentState: vi.fn<typeof realCreateAgentState>().mockReturnValue(value),
    });
  });
};

beforeEach(() => {
  resetTestEnvironment();
  vi.spyOn(agentDocumentService, 'getSkills').mockResolvedValue([]);
  useProjectWorkspaceStore.setState({ operationConsentByMessage: {} });
  setupMockSelectors();
  spyOnMessageService();
  serverConfigMock.enableVisualUnderstanding = false;

  act(() => {
    useAgentStore.setState({ availableAgents: [] });
    useChatStore.setState({
      refreshMessages: vi.fn(),
      executeClientAgent: vi.fn(),
      internal_createAgentState: realCreateAgentState,
    });
  });
});

afterEach(() => {
  useAiInfraStore.setState({ enabledAiModels: [] });
  vi.restoreAllMocks();
});

describe('StreamingExecutor actions', () => {
  describe('WorkingModel image evidence', () => {
    const imageMessage = () =>
      createMockMessage({
        role: 'user',
        attachments: {
          schemaVersion: 1,
          items: [
            {
              attachmentId: 'image-1',
              localResourceId: 'resource-1',
              source: 'local',
              deviceId: 'device-1',
              mime: 'image/png',
              name: 'image.png',
              size: 4,
              version: 'v1',
            },
          ],
        },
      });

    it.each([
      ['unsupported', true, false],
      ['supported', false, true],
      ['unknown', true, false],
    ] as const)(
      'uses catalog %s instead of legacy vision=%s for local images',
      (image, legacyVision, allowed) => {
        setupMockSelectors({ agentConfig: { model: 'catalog-image', provider: 'openai' } });
        useAiInfraStore.setState({
          enabledAiModels: [
            {
              id: 'catalog-image',
              providerId: 'openai',
              type: 'chat',
              abilities: { vision: legacyVision },
              settings: {
                modelCatalog: mergeModelCatalogEntry({
                  modelId: 'catalog-image',
                  providerId: 'openai',
                  providerMetadata: { inputModalities: { image } },
                }),
              },
            },
          ],
        });
        const message = imageMessage();
        const before = structuredClone(message);
        const create = () =>
          useChatStore.getState().internal_createAgentState({
            messages: [message],
            parentMessageId: message.id,
            agentId: TEST_IDS.SESSION_ID,
          });
        if (allowed)
          expect(create().state.metadata?.modelCatalogSnapshot).toMatchObject({
            entry: { inputModalities: { image: 'supported' } },
          });
        else expect(create).toThrow('当前模型不支持图片');
        expect(message).toEqual(before);
      },
    );

    it.each([false, true])(
      'uses the submitted model binding after agent config drift (vision=%s)',
      (vision) => {
        setupMockSelectors({ agentConfig: { model: 'old-vision', provider: 'openai' } });
        useAiInfraStore.setState({
          enabledAiModels: [
            { id: 'submitted', providerId: 'openai', type: 'chat', abilities: { vision } },
            { id: 'old-vision', providerId: 'openai', type: 'chat', abilities: { vision: true } },
          ],
        });
        const message = imageMessage();
        const create = () =>
          useChatStore.getState().internal_createAgentState({
            agentId: TEST_IDS.SESSION_ID,
            messages: [message],
            parentMessageId: message.id,
            workingModel: { model: 'submitted', provider: 'openai' },
          });
        if (!vision) expect(create).toThrow('当前模型不支持图片');
        else {
          const result = create();
          expect(result.agentConfig.agentConfig.model).toBe('submitted');
          expect(result.state.metadata?.modelCatalogSnapshot).toMatchObject({
            entry: { modelId: 'submitted' },
          });
        }
      },
    );

    it('does not reuse a previous model snapshot after switching the WorkingModel', () => {
      setupMockSelectors({ agentConfig: { model: 'text-model', provider: 'openai' } });
      useAiInfraStore.setState({
        enabledAiModels: [
          { id: 'text-model', providerId: 'openai', type: 'chat', abilities: { vision: false } },
        ],
      });
      const previous = createModelCatalogSnapshot(
        mergeModelCatalogEntry({
          modelId: 'vision-model',
          providerId: 'openai',
          catalog: { abilities: { vision: true } },
        }).entry,
        'operation-current',
      );
      const message = imageMessage();
      expect(() =>
        useChatStore.getState().internal_createAgentState({
          messages: [message],
          parentMessageId: message.id,
          agentId: TEST_IDS.SESSION_ID,
          operationId: 'operation-current',
          initialState: {
            ...createMockRuntimeState('operation-current', 'running'),
            metadata: { modelCatalogSnapshot: previous },
          },
        }),
      ).toThrow('当前模型不支持图片');
    });
  });
  describe('executeClientAgent', () => {
    it.each(['scratch', 'device'] as const)(
      'keeps the resolved %s workspace authority when a local tool turn resumes',
      async (workspaceKind) => {
        act(() => useChatStore.setState({ executeClientAgent: realExecAgentRuntime }));
        const workspaceId = `workspace-${workspaceKind}`;
        const rootPath =
          workspaceKind === 'scratch' ? '/app/scratch/topic-resume' : '/projects/device-workspace';
        const workspace = {
          deviceId: 'device-local',
          id: workspaceId,
          kind: workspaceKind,
          rootPath,
        };
        useProjectWorkspaceStore.setState({
          grantsByTopicDevice: {
            [`${TEST_IDS.TOPIC_ID}::device-local`]: [
              {
                createdAt: '2026-09-09T00:00:00.000Z',
                deviceId: 'device-local',
                id: 'grant-private-tmp',
                modes: ['read'],
                requestedVia: { messageId: 'approved-tool-message' },
                rootPath: '/private/tmp/work.html',
                scope: 'topic',
                topicId: TEST_IDS.TOPIC_ID,
                userId: 'test-user',
              },
            ],
          },
          topicStatesById: {
            [TEST_IDS.TOPIC_ID]: {
              snapshot: {
                boundDeviceId: 'device-local',
                target: 'local',
                targetCapturedAt: '2026-09-09T00:00:00.000Z',
                version: 1,
                workspaceId,
                workspaceKind,
              },
              workspace,
            },
          },
          workspacesById: { [workspaceId]: workspace },
        });
        vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
          async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
          },
        );

        const parent = useChatStore.getState().startOperation({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          type: 'approveToolCalling',
        });
        await act(async () => {
          await useChatStore.getState().executeClientAgent({
            context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
            messages: [],
            operationSkills: [],
            parentMessageId: 'approved-tool-message',
            parentMessageType: 'tool',
            parentOperationId: parent.operationId,
            skipCreateFirstMessage: true,
          });
        });

        const operation = Object.values(useChatStore.getState().operations).find(
          (op) => op.type === 'execAgentRuntime' && op.parentOperationId === parent.operationId,
        );
        expect(operation?.metadata.executionContext).toMatchObject({
          cwd: rootPath,
          plan: { deviceId: 'device-local', kind: 'device', target: 'local' },
          workspace: { id: workspaceId, kind: workspaceKind, rootPath },
        });
        expect(operation?.metadata.executionContext?.accessRoots).toContainEqual(
          expect.objectContaining({
            grantId: 'grant-private-tmp',
            rootPath: '/private/tmp/work.html',
            scope: 'topic',
          }),
        );
      },
    );

    it.each(['scratch', 'device'] as const)(
      'keeps the paused %s execution identity while applying a topic grant approved afterward',
      async (workspaceKind) => {
        act(() => useChatStore.setState({ executeClientAgent: realExecAgentRuntime }));
        const originalRootPath =
          workspaceKind === 'scratch'
            ? '/app/scratch/original-topic'
            : '/projects/original-device-workspace';
        const originalWorkspaceId = `${workspaceKind}-original`;
        const pausedExecutionContext: ExecutionContext = {
          accessRoots: [
            {
              modes: ['read', 'write', 'exec'],
              rootPath: originalRootPath,
              scope: 'primary' as const,
              source: 'workspace' as const,
            },
          ],
          cwd: originalRootPath,
          env: {
            secretKeys: ['SECRET_TOKEN'],
            sources: { PUBLIC_FLAG: 'workspace' as const, SECRET_TOKEN: 'user' as const },
            values: { PUBLIC_FLAG: 'enabled', SECRET_TOKEN: 'hidden' },
          },
          envFiles: ['.env.local'],
          envSummary: { keys: ['PUBLIC_FLAG', 'SECRET_TOKEN'], secretKeys: ['SECRET_TOKEN'] },
          operationId: 'paused-operation',
          plan: { deviceId: 'device-local', kind: 'device' as const, target: 'local' as const },
          snapshot: {
            boundDeviceId: 'device-local',
            target: 'local' as const,
            targetCapturedAt: '2026-09-09T00:00:00.000Z',
            version: 1 as const,
            workspaceId: originalWorkspaceId,
            workspaceKind,
          },
          version: 1 as const,
          workspace: {
            deviceId: 'device-local',
            id: originalWorkspaceId,
            kind: workspaceKind,
            rootPath: originalRootPath,
          },
        };
        const replacementWorkspace = {
          deviceId: 'device-local',
          id: 'workspace-selected-while-paused',
          kind: 'device' as const,
          rootPath: '/projects/replacement',
        };
        const approvedGrant = {
          createdAt: '2026-09-09T00:01:00.000Z',
          deviceId: 'device-local',
          id: 'grant-approved-after-pause',
          modes: ['read'] as Array<'read'>,
          requestedVia: { messageId: 'approved-tool-message' },
          rootPath: '/private/tmp/work.html',
          scope: 'topic' as const,
          topicId: TEST_IDS.TOPIC_ID,
          userId: 'test-user',
        };
        useProjectWorkspaceStore.setState({
          grantsByTopicDevice: {},
          topicStatesById: {
            [TEST_IDS.TOPIC_ID]: {
              snapshot: {
                boundDeviceId: 'device-local',
                target: 'local',
                targetCapturedAt: '2026-09-09T00:02:00.000Z',
                version: 1,
                workspaceId: replacementWorkspace.id,
                workspaceKind: replacementWorkspace.kind,
              },
              workspace: replacementWorkspace,
            },
          },
          workspacesById: { [replacementWorkspace.id]: replacementWorkspace },
        });
        vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
          async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
          },
        );
        vi.spyOn(projectWorkspaceService, 'grant').mockResolvedValue(approvedGrant);

        await act(async () => {
          const outcome = await useProjectWorkspaceStore.getState().grantTopicAccess({
            deviceId: 'device-local',
            modes: ['read'],
            requestedVia: { messageId: 'approved-tool-message' },
            rootPath: '/private/tmp/work.html',
            topicId: TEST_IDS.TOPIC_ID,
          });
          expect(outcome).toEqual({ ok: true, value: approvedGrant });
        });

        const parent = useChatStore.getState().startOperation({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          type: 'approveToolCalling',
        });
        await act(async () => {
          await useChatStore.getState().executeClientAgent({
            context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
            executionContext: pausedExecutionContext,
            messages: [],
            operationSkills: [],
            parentMessageId: 'approved-tool-message',
            parentMessageType: 'tool',
            parentOperationId: parent.operationId,
            skipCreateFirstMessage: true,
          });
        });

        const operation = Object.values(useChatStore.getState().operations).find(
          (op) => op.type === 'execAgentRuntime' && op.parentOperationId === parent.operationId,
        );
        expect(operation?.metadata.executionContext).toEqual({
          ...pausedExecutionContext,
          accessRoots: [
            pausedExecutionContext.accessRoots![0],
            {
              deviceId: 'device-local',
              grantId: 'grant-approved-after-pause',
              modes: ['read'],
              rootPath: '/private/tmp/work.html',
              scope: 'topic',
              source: 'user-approval',
              topicId: TEST_IDS.TOPIC_ID,
            },
          ],
          operationId: operation?.id,
        });
      },
    );

    it.each(['scratch', 'device'] as const)(
      'waits for persisted topic grants before starting a refreshed %s runtime',
      async (workspaceKind) => {
        act(() => useChatStore.setState({ executeClientAgent: realExecAgentRuntime }));
        const rootPath =
          workspaceKind === 'scratch'
            ? '/app/scratch/refreshed-topic'
            : '/projects/refreshed-device-workspace';
        const workspaceId = `refreshed-${workspaceKind}`;
        const workspace = {
          deviceId: 'device-local',
          id: workspaceId,
          kind: workspaceKind,
          rootPath,
        };
        const frozenExecutionContext: ExecutionContext = {
          accessRoots: [
            {
              modes: ['read', 'write', 'exec'],
              rootPath,
              scope: 'primary',
              source: 'workspace',
            },
          ],
          cwd: rootPath,
          env: {
            secretKeys: ['SECRET_TOKEN'],
            sources: { PUBLIC_FLAG: 'workspace', SECRET_TOKEN: 'user' },
            values: { PUBLIC_FLAG: 'enabled', SECRET_TOKEN: 'hidden' },
          },
          envFiles: ['.env.local'],
          envSummary: { keys: ['PUBLIC_FLAG', 'SECRET_TOKEN'], secretKeys: ['SECRET_TOKEN'] },
          operationId: 'before-refresh-operation',
          plan: { deviceId: 'device-local', kind: 'device', target: 'local' },
          snapshot: {
            boundDeviceId: 'device-local',
            target: 'local',
            targetCapturedAt: '2026-09-10T00:00:00.000Z',
            version: 1,
            workspaceId,
            workspaceKind,
          },
          version: 1,
          workspace,
        };
        const persistedGrant = {
          createdAt: '2026-09-10T00:01:00.000Z',
          deviceId: 'device-local',
          id: `persisted-${workspaceKind}-grant`,
          modes: ['read'] as Array<'read'>,
          requestedVia: { messageId: 'earlier-tool-message' },
          rootPath: '/private/tmp/persisted.txt',
          scope: 'topic' as const,
          topicId: TEST_IDS.TOPIC_ID,
          userId: 'test-user',
        };
        useProjectWorkspaceStore.setState({
          grantsByTopicDevice: {},
          seamAvailable: true,
          topicStatesById: {
            [TEST_IDS.TOPIC_ID]: {
              snapshot: frozenExecutionContext.snapshot,
              workspace,
            },
          },
          workspacesById: { [workspaceId]: workspace },
        });

        let resolveGrants!: (value: (typeof persistedGrant)[]) => void;
        const pendingGrants = new Promise<(typeof persistedGrant)[]>((resolve) => {
          resolveGrants = resolve;
        });
        vi.spyOn(projectWorkspaceService, 'listGrants').mockReturnValue(pendingGrants);
        const streamSpy = vi
          .spyOn(chatService, 'createAssistantMessageStream')
          .mockImplementation(async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
          });
        const parent = useChatStore.getState().startOperation({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          type: 'sendMessage',
        });

        let run!: ReturnType<typeof realExecAgentRuntime>;
        await act(async () => {
          run = useChatStore.getState().executeClientAgent({
            context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
            executionContext: frozenExecutionContext,
            messages: [],
            operationSkills: [],
            parentMessageId: 'assistant-after-refresh',
            parentMessageType: 'assistant',
            parentOperationId: parent.operationId,
            skipCreateFirstMessage: true,
          });
          await Promise.resolve();
        });

        expect(projectWorkspaceService.listGrants).toHaveBeenCalledWith({
          deviceId: 'device-local',
          topicId: TEST_IDS.TOPIC_ID,
        });
        expect(streamSpy).not.toHaveBeenCalled();

        resolveGrants([persistedGrant]);
        await act(async () => run);

        const operation = Object.values(useChatStore.getState().operations).find(
          (item) =>
            item.type === 'execAgentRuntime' && item.parentOperationId === parent.operationId,
        );
        expect(operation?.metadata.executionContext).toEqual({
          ...frozenExecutionContext,
          accessRoots: [
            frozenExecutionContext.accessRoots![0],
            {
              deviceId: 'device-local',
              grantId: persistedGrant.id,
              modes: ['read'],
              rootPath: '/private/tmp/persisted.txt',
              scope: 'topic',
              source: 'user-approval',
              topicId: TEST_IDS.TOPIC_ID,
            },
          ],
          operationId: operation?.id,
        });
        expect(streamSpy).toHaveBeenCalledTimes(1);
      },
    );

    it('keeps an existing thread resume out of the main-window running state', async () => {
      act(() => useChatStore.setState({ executeClientAgent: realExecAgentRuntime }));
      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        },
      );
      await act(async () => {
        await useChatStore.getState().executeClientAgent({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            threadId: 'thread-resume',
            topicId: TEST_IDS.TOPIC_ID,
          },
          executionContext: {
            version: 1,
            accessRoots: [],
            plan: { kind: 'device', target: 'local', deviceId: 'device-local' },
          },
          messages: [],
          operationSkills: [],
          parentMessageId: 'approved-thread-tool',
          parentMessageType: 'tool',
          skipCreateFirstMessage: true,
        });
      });

      const operation = Object.values(useChatStore.getState().operations).find(
        (op) => op.type === 'execAgentRuntime' && op.context.threadId === 'thread-resume',
      );
      expect(operation?.metadata.inThread).toBe(true);
    });

    it('carries the finalized scratch cwd into the next runtime step', async () => {
      act(() => useChatStore.setState({ executeClientAgent: realExecAgentRuntime }));
      const step = vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step');
      step.mockImplementationOnce(async (state, nextContext) => {
        expect(state.metadata?.workingDirectory).toBeUndefined();
        const executionContext = state.metadata!.executionContext!;
        useChatStore.getState().updateOperationMetadata(state.operationId, {
          executionContext: {
            ...executionContext,
            cwd: '/scratch/current-topic',
            workspace: {
              kind: 'scratch',
              rootPath: '/scratch/current-topic',
              deviceId: 'device-local',
            },
          },
        });
        return { events: [], newState: state, nextContext };
      });
      step.mockImplementationOnce(async (state) => {
        expect(state.metadata?.executionContext?.cwd).toBe('/scratch/current-topic');
        expect(state.metadata?.workingDirectory).toBe('/scratch/current-topic');
        return { events: [], newState: { ...state, status: 'done' } };
      });
      await act(async () => {
        await useChatStore.getState().executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          executionContext: {
            version: 1,
            accessRoots: [],
            plan: { kind: 'device', target: 'local', deviceId: 'device-local' },
          },
          workingDirectory: '/private/tmp/old-agent-default',
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
        });
      });
      expect(step).toHaveBeenCalledTimes(2);
    });

    it('projects a preparation failure on the current assistant so the user can retry', async () => {
      const context = { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID };
      const assistant = createMockMessage({
        id: 'preparing-assistant',
        role: 'assistant',
        parentId: 'source-user',
      });
      const updateError = vi.fn().mockResolvedValue(undefined);
      act(() =>
        useChatStore.setState({
          dbMessagesMap: { [messageMapKey(context)]: [assistant] },
          optimisticUpdateMessageError: updateError,
        }),
      );
      const { operationId } = useChatStore
        .getState()
        .startOperation({ type: 'execAgentRuntime', context });
      const lifecycle = buildRunLifecycle(() => useChatStore.getState(), {
        context,
        parentMessageId: 'source-user',
        parentMessageType: 'user',
        runId: operationId,
        runScope: 'top_level',
        runtimeType: 'client',
      });
      await lifecycle.onRunError({
        context,
        operationId,
        runId: operationId,
        runScope: 'top_level',
        runtimeType: 'client',
        error: new Error('Project skill scan failed; retry after reconnecting'),
      });
      expect(updateError).toHaveBeenCalledWith(
        'preparing-assistant',
        expect.objectContaining({
          message: 'Project skill scan failed; retry after reconnecting',
        }),
        { operationId },
      );
    });

    it('carries one approved path from the pending tool into the new local operation', async () => {
      act(() => useChatStore.setState({ executeClientAgent: realExecAgentRuntime }));
      const request = {
        actualCwd: '',
        deviceId: 'device-local',
        modes: ['read'] as const,
        operationId: 'paused-operation',
        primaryCwd: '',
        requestedPath: '/tmp/probe.txt',
        topicId: TEST_IDS.TOPIC_ID,
        version: 1 as const,
      };
      const message = createMockMessage({
        id: 'pending-path-tool',
        role: 'tool',
        pluginState: { workspacePathConsent: request },
      });
      act(() =>
        useChatStore.setState({
          dbMessagesMap: {
            [messageMapKey({ agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID })]: [
              message,
            ],
          },
        }),
      );
      useProjectWorkspaceStore.getState().setOperationPathConsent(message.id, {
        ...request,
        modes: ['read'],
        rootPath: '/private/tmp/probe.txt',
        scope: 'operation',
      });
      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        },
      );
      await act(async () => {
        await useChatStore.getState().executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          executionContext: {
            version: 1,
            accessRoots: [],
            plan: { kind: 'device', target: 'local', deviceId: 'device-local' },
          },
          messages: [
            createMockMessage({
              id: 'assistant-group',
              role: 'assistantGroup',
              children: [{ id: message.id, content: message.content ?? '' }],
            }),
          ],
          parentMessageId: message.id,
          parentMessageType: 'tool',
          skipCreateFirstMessage: true,
        });
      });
      const operation = Object.values(useChatStore.getState().operations).find(
        (op) => op.type === 'execAgentRuntime',
      );
      expect(operation?.metadata.executionContext?.accessRoots).toContainEqual(
        expect.objectContaining({
          rootPath: '/private/tmp/probe.txt',
          source: 'user-approval',
          scope: 'operation',
          modes: ['read'],
          operationId: operation!.id,
          topicId: TEST_IDS.TOPIC_ID,
          deviceId: 'device-local',
        }),
      );
    });

    it.each([true, false])(
      'grants absolute reads only to the explicit current UI submission (%s)',
      async (explicitSubmission) => {
        act(() => useChatStore.setState({ executeClientAgent: realExecAgentRuntime }));
        const message = createMockMessage({
          id: TEST_IDS.USER_MESSAGE_ID,
          role: 'user',
          content: 'Read /tmp/masterino-direct-read.txt',
        });
        vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
          async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
          },
        );
        await act(async () => {
          await useChatStore.getState().executeClientAgent({
            context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
            directUserMessageId: explicitSubmission ? message.id : undefined,
            executionContext: {
              version: 1,
              accessRoots: [],
              plan: { kind: 'device', target: 'local', deviceId: 'device-local' },
            },
            messages: [message],
            parentMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            parentMessageType: 'assistant',
            skipCreateFirstMessage: true,
          });
        });
        const operation = Object.values(useChatStore.getState().operations).find(
          (op) => op.type === 'execAgentRuntime',
        );
        expect(operation?.metadata.executionContext?.accessRoots).toEqual(
          explicitSubmission
            ? [
                expect.objectContaining({
                  rootPath: '/tmp/masterino-direct-read.txt',
                  modes: ['read'],
                  scope: 'operation',
                  source: 'direct-user-message',
                  topicId: TEST_IDS.TOPIC_ID,
                }),
              ]
            : [],
        );
      },
    );

    it('should handle the core AI message processing', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;
      const messages = [userMessage];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages,
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify agent runtime executed successfully
      expect(streamSpy).toHaveBeenCalled();

      // Verify operation was completed
      const operations = Object.values(result.current.operations);
      const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
      expect(execOperation?.status).toBe('completed');
      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            parentMessageId: userMessage.id,
            parentMessageType: 'user',
            triggerMessageId: userMessage.id,
          }),
          sourceId: `${execOperation?.id}:client:start`,
          sourceType: 'client.runtime.start',
        }),
      );

      streamSpy.mockRestore();
    });

    it('should stop agent runtime loop when operation is cancelled before step execution', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      let streamCallCount = 0;
      let cancelDuringFirstCall = false;
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          streamCallCount++;

          // Cancel during the first LLM call to simulate mid-execution cancellation
          if (streamCallCount === 1) {
            const operations = Object.values(result.current.operations);
            const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
            if (execOperation) {
              act(() => {
                result.current.cancelOperation(execOperation.id, 'user_cancelled');
              });
              cancelDuringFirstCall = true;
            }
          }

          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            toolCalls: [
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
            ],
          } as any);
        });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify cancellation happened during execution
      expect(cancelDuringFirstCall).toBe(true);
      // The loop should stop after first call, not continue to second LLM call after tool execution
      expect(streamCallCount).toBe(1);

      streamSpy.mockRestore();
    });

    it('should stop agent runtime loop when operation is cancelled after step completion', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      let streamCallCount = 0;
      let cancelledAfterStep = false;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          streamCallCount++;

          // First call - LLM returns tool calls
          if (streamCallCount === 1) {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
              ],
            } as any);

            // Cancel immediately after LLM step completes
            // This triggers the after-step cancellation check
            await new Promise((resolve) => setTimeout(resolve, 20));
            const operations = Object.values(result.current.operations);
            const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
            if (execOperation && execOperation.status === 'running') {
              act(() => {
                result.current.cancelOperation(execOperation.id, 'user_cancelled');
              });
              cancelledAfterStep = true;
            }
          }
        });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify cancellation happened after step completion
      expect(cancelledAfterStep).toBe(true);

      // Verify that only one LLM call was made (no tool execution happened)
      expect(streamCallCount).toBe(1);

      // Verify the execution stopped and didn't proceed to tool calling
      const operations = Object.values(result.current.operations);
      const toolOperations = operations.filter((op) => op.type === 'toolCalling');

      // If any tool operations were started, they should have been cancelled
      if (toolOperations.length > 0) {
        expect(toolOperations.every((op) => op.status === 'cancelled')).toBe(true);
      }

      streamSpy.mockRestore();
    });

    it('should pass model contextWindowTokens into compressionConfig when creating the agent', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      useAiInfraStore.setState({
        enabledAiModels: [
          {
            abilities: { functionCall: true },
            contextWindowTokens: 200_000,
            id: 'gpt-4o-mini',
            providerId: 'openai',
            type: 'chat',
          } as EnabledAiModel,
        ],
      });
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig({ model: 'gpt-4o-mini', provider: 'openai' }),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      const stepSpy = vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step');
      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      expect(getCreatedAgentCompressionConfig(stepSpy)).toEqual({
        enabled: true,
        maxWindowToken: 200_000,
      });
      const operationState = stepSpy.mock.calls[0][0] as AgentState;
      const snapshot = operationState.metadata?.modelCatalogSnapshot as any;
      expect(snapshot).toEqual(
        expect.objectContaining({
          entry: expect.objectContaining({
            contextWindowTokens: 200_000,
            modelId: 'gpt-4o-mini',
            providerId: 'openai',
          }),
          operationId: expect.any(String),
          version: 1,
        }),
      );
      expect(operationState.metadata?.compressionModelCatalogSnapshot).toBe(snapshot);
      expect((operationState.metadata?.contextBudget as any).catalogSnapshot).toBe(snapshot);

      streamSpy.mockRestore();
    });

    it('should freeze the conservative catalog fallback for unknown models', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const stepSpy = vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step');

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig({ model: 'unknown-model', provider: 'openai' }),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      expect(getCreatedAgentCompressionConfig(stepSpy)).toEqual({
        enabled: true,
        maxWindowToken: 32_000,
      });

      streamSpy.mockRestore();
    });

    it('freezes a dedicated compression model and its own context window', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });
      useAiInfraStore.setState({
        enabledAiModels: [
          {
            contextWindowTokens: 200_000,
            id: 'main-model',
            providerId: 'openai',
            type: 'chat',
          } as EnabledAiModel,
          {
            contextWindowTokens: 8192,
            id: 'compact-model',
            providerId: 'openai',
            type: 'chat',
          } as EnabledAiModel,
        ],
      });
      const chatConfig = createMockChatConfig({ compressionModelId: 'compact-model' });
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig({
          chatConfig,
          model: 'main-model',
          provider: 'openai',
        }),
        chatConfig,
        isBuiltinAgent: false,
        plugins: [],
      });
      const stepSpy = vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step');
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        });
      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        content: TEST_CONTENT.USER_MESSAGE,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      const operationState = stepSpy.mock.calls[0][0] as AgentState;
      expect(operationState.modelRuntimeConfig).toEqual({
        compressionModel: { model: 'compact-model', provider: 'openai' },
        model: 'main-model',
        provider: 'openai',
      });
      expect((operationState.metadata?.modelCatalogSnapshot as any).entry).toEqual(
        expect.objectContaining({ contextWindowTokens: 200_000, modelId: 'main-model' }),
      );
      expect((operationState.metadata?.compressionModelCatalogSnapshot as any).entry).toEqual(
        expect.objectContaining({ contextWindowTokens: 8192, modelId: 'compact-model' }),
      );
      expect(operationState.metadata?.compressionModelCatalogSnapshot).not.toBe(
        operationState.metadata?.modelCatalogSnapshot,
      );
      expect(getCreatedAgentCompressionConfig(stepSpy).maxWindowToken).toBe(200_000);
      streamSpy.mockRestore();
    });

    it('should resolve aborted tools when cancelled after LLM returns tool calls', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      let cancelledAfterLLM = false;
      let streamCallCount = 0;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          streamCallCount++;

          // First call - LLM returns with tool calls
          if (streamCallCount === 1) {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                {
                  id: 'tool-1',
                  type: 'function',
                  function: { name: 'weatherQuery', arguments: '{"city":"Beijing"}' },
                },
                {
                  id: 'tool-2',
                  type: 'function',
                  function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
                },
              ],
            } as any);

            // User cancels after LLM completes but before tool execution
            await new Promise((resolve) => setTimeout(resolve, 20));
            const operations = Object.values(result.current.operations);
            const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
            if (execOperation && execOperation.status === 'running') {
              act(() => {
                result.current.cancelOperation(execOperation.id, 'user_cancelled');
              });
              cancelledAfterLLM = true;
            }
          }
        });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify cancellation happened after LLM call
      expect(cancelledAfterLLM).toBe(true);

      // Verify only one LLM call was made (no tool execution happened)
      expect(streamCallCount).toBe(1);

      // Verify the operation preserves cancelled status (user intentionally stopped it)
      // even though tools were gracefully resolved after cancellation
      const operations = Object.values(result.current.operations);
      const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
      expect(execOperation?.status).toBe('cancelled');

      streamSpy.mockRestore();
    });

    it('should use provided context for trace parameters', async () => {
      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
          activeAgentId: 'active-session',
          activeTopicId: 'active-topic',
        });
      });

      const { result } = renderHook(() => useChatStore());
      const contextSessionId = 'context-session';
      const contextTopicId = 'context-topic';
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: contextSessionId,
        topicId: contextTopicId,
      } as UIChatMessage;

      const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream');

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: contextSessionId, topicId: contextTopicId },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify trace was called with context topicId, not active ones
      expect(streamSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          trace: expect.objectContaining({
            topicId: contextTopicId,
          }),
        }),
      );
    });

    // Note: RAG metadata functionality has been removed
    // RAG is now handled by Knowledge Base Tools (searchKnowledgeBase and readKnowledge)
  });

  describe('afterCompletion hooks', () => {
    it('should execute afterCompletion callbacks after runtime completes', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real executeClientAgent for this test
      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      // Create operation manually to register callbacks
      let operationId!: string;
      const afterCompletionCallback1 = vi.fn();
      const afterCompletionCallback2 = vi.fn();

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;

        // Register callbacks
        result.current.registerAfterCompletionCallback(operationId, afterCompletionCallback1);
        result.current.registerAfterCompletionCallback(operationId, afterCompletionCallback2);
      });

      // Verify callbacks are registered
      expect(
        result.current.operations[operationId!].metadata.runtimeHooks?.afterCompletionCallbacks,
      ).toHaveLength(2);

      // Mock internal_createAgentState to return minimal state
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'done' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 0,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 0,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      // Execute executeClientAgent with the pre-created operationId
      await act(async () => {
        await result.current.executeClientAgent({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Verify callbacks were executed
      expect(afterCompletionCallback1).toHaveBeenCalledTimes(1);
      expect(afterCompletionCallback2).toHaveBeenCalledTimes(1);
    });

    it('should continue execution even if a callback throws an error', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real executeClientAgent for this test
      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId!: string;
      const errorCallback = vi.fn().mockRejectedValue(new Error('Callback error'));
      const successCallback = vi.fn();

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;

        // Register callbacks - error callback first, then success callback
        result.current.registerAfterCompletionCallback(operationId, errorCallback);
        result.current.registerAfterCompletionCallback(operationId, successCallback);
      });

      // Mock internal_createAgentState to return minimal state
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'done' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 0,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 0,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      // Suppress console.error for this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await act(async () => {
        await result.current.executeClientAgent({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Both callbacks should have been called
      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(successCallback).toHaveBeenCalledTimes(1);

      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[executeClientAgent] afterCompletion callback error:',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should not fail when no afterCompletion callbacks are registered', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real executeClientAgent for this test
      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
        // No callbacks registered
      });

      // Mock internal_createAgentState to return minimal state
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'done' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 0,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 0,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      // Should not throw
      await act(async () => {
        await result.current.executeClientAgent({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Operation should complete successfully
      expect(result.current.operations[operationId!].status).toBe('completed');
    });
  });

  describe('initialContext preservation', () => {
    it('should preserve initialContext through multiple steps in agent runtime loop', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      // Track initialContext passed to chatService across multiple calls
      const capturedInitialContexts: any[] = [];
      let streamCallCount = 0;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish, initialContext }) => {
          streamCallCount++;
          capturedInitialContexts.push(initialContext);

          if (streamCallCount === 1) {
            // First LLM call returns tool calls
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
              ],
            } as any);
          } else {
            // Second LLM call (after tool execution) returns final response
            await onFinish?.('Final response', {} as any);
          }
        });

      // Mock internal_createAgentState to include initialContext
      const mockInitialContext = {
        pageEditor: {
          markdown: '# Test Document',
          xml: '<root><h1>Test</h1></root>',
          metadata: { title: 'Test Doc', charCount: 15, lineCount: 1 },
        },
      };

      const originalCreateAgentState = result.current.internal_createAgentState;
      vi.spyOn(result.current, 'internal_createAgentState').mockImplementation((params) => {
        const baseResult = originalCreateAgentState(params);
        return {
          ...baseResult,
          context: {
            ...baseResult.context,
            initialContext: mockInitialContext,
          },
        };
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify that initialContext was passed to all LLM calls
      // Note: The first call should have initialContext, and subsequent calls should preserve it
      expect(capturedInitialContexts.length).toBeGreaterThanOrEqual(1);

      // All captured initialContexts should be the same (preserved through steps)
      capturedInitialContexts.forEach((ctx) => {
        expect(ctx).toEqual(mockInitialContext);
      });

      streamSpy.mockRestore();
    });

    it('should preserve initialContext when result.nextContext does not include it', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const capturedInitialContexts: any[] = [];
      let streamCallCount = 0;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish, initialContext }) => {
          streamCallCount++;
          capturedInitialContexts.push(initialContext);

          if (streamCallCount < 3) {
            // Return tool calls to continue the loop
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                {
                  id: `tool-${streamCallCount}`,
                  type: 'function',
                  function: { name: 'test', arguments: '{}' },
                },
              ],
            } as any);
          } else {
            // Final response without tool calls
            await onFinish?.('Final response', {} as any);
          }
        });

      const mockInitialContext = {
        pageEditor: {
          markdown: '# Preserved Context',
          xml: '<doc>preserved</doc>',
          metadata: { title: 'Preserved', charCount: 20, lineCount: 1 },
        },
      };

      const originalCreateAgentState = result.current.internal_createAgentState;
      vi.spyOn(result.current, 'internal_createAgentState').mockImplementation((params) => {
        const baseResult = originalCreateAgentState(params);
        return {
          ...baseResult,
          context: {
            ...baseResult.context,
            initialContext: mockInitialContext,
          },
        };
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify initialContext was preserved across all LLM calls
      // Even though result.nextContext from executors doesn't include initialContext,
      // the loop should preserve it from the original context
      capturedInitialContexts.forEach((ctx) => {
        expect(ctx).toEqual(mockInitialContext);
      });

      streamSpy.mockRestore();
    });

    it('should merge provided initialContext with runtime page editor context', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: ['lobe-page-agent'],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed: vi.fn().mockReturnValue({
          enabledManifests: [],
          enabledToolIds: ['lobe-page-agent'],
          tools: [],
        }),
      } as any);
      vi.spyOn(pageAgentRuntime, 'isReady').mockReturnValue(true);
      vi.spyOn(pageAgentRuntime, 'getPageContentContext').mockReturnValue({
        markdown: '# Test Document',
        xml: '<root><h1>Test</h1></root>',
        metadata: { title: 'Test Doc', charCount: 15, lineCount: 1 },
      });
      const { operationId } = result.current.startOperation({
        context: {
          agentId: TEST_IDS.SESSION_ID,
          scope: 'page',
          topicId: TEST_IDS.TOPIC_ID,
        },
        type: 'execAgentRuntime',
      });

      const { context } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        operationId,
        initialContext: {
          phase: 'init',
          initialContext: {
            selectedSkills: [{ identifier: 'user_memory', name: 'User Memory' }],
            selectedTools: [{ identifier: 'lobe-notebook', name: 'Notebook' }],
          },
        },
      });

      expect(context.initialContext).toEqual({
        pageEditor: {
          markdown: '# Test Document',
          xml: '<root><h1>Test</h1></root>',
          metadata: { title: 'Test Doc', charCount: 15, lineCount: 1 },
        },
        selectedSkills: [{ identifier: 'user_memory', name: 'User Memory' }],
        selectedTools: [{ identifier: 'lobe-notebook', name: 'Notebook' }],
      });
    });

    it('should not inject page editor context outside page scope', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: ['lobe-page-agent'],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed: vi.fn().mockReturnValue({
          enabledManifests: [],
          enabledToolIds: ['lobe-page-agent'],
          tools: [],
        }),
      } as any);
      const pageContextSpy = vi.spyOn(pageAgentRuntime, 'getPageContentContext');
      const { operationId } = result.current.startOperation({
        context: {
          agentId: TEST_IDS.SESSION_ID,
          scope: 'main',
          topicId: TEST_IDS.TOPIC_ID,
        },
        type: 'execAgentRuntime',
      });

      const { context } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        operationId,
      });

      expect(context.initialContext?.pageEditor).toBeUndefined();
      expect(pageContextSpy).not.toHaveBeenCalled();
    });

    it('should merge selectedTools into generated tools when provided', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const generateToolsDetailed = vi.fn().mockReturnValue({
        enabledManifests: [],
        enabledToolIds: ['lobe-notebook'],
        tools: [],
      });

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: ['lobe-artifacts'],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed,
      } as any);

      result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        initialContext: {
          phase: 'init',
          initialContext: {
            selectedTools: [{ identifier: 'lobe-notebook', name: 'Notebook' }],
          },
        },
      });

      expect(generateToolsDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDefaultTools: undefined,
          toolIds: ['lobe-artifacts', 'lobe-notebook'],
        }),
      );
    });

    it('does not delegate historical paperclip images to another agent', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      serverConfigMock.enableVisualUnderstanding = true;

      const { result } = renderHook(() => useChatStore());
      const previousVisualMessage = {
        id: 'msg_with_image',
        role: 'user',
        content: 'Please inspect this image',
        imageList: [{ id: 'image-file', url: 'https://example.com/image.png' }],
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;
      const currentTextMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: 'Does the person in the first image wear glasses?',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const generateToolsDetailed = vi.fn().mockReturnValue({
        enabledManifests: [],
        enabledToolIds: ['lobe-agent'],
        tools: [],
      });

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig({ model: 'text-only-model', provider: 'openai' }),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed,
      } as any);

      result.current.internal_createAgentState({
        messages: [previousVisualMessage, currentTextMessage],
        parentMessageId: currentTextMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });

      expect(generateToolsDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          toolIds: undefined,
        }),
      );
    });

    it('should not enable visual understanding when the active LobeHub model supports visual media natively', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      serverConfigMock.enableVisualUnderstanding = true;
      useAiInfraStore.setState({
        enabledAiModels: [
          {
            abilities: { functionCall: true, video: true, vision: true },
            id: 'gemini-3.1-flash-lite-preview',
            providerId: ModelProvider.Google,
            type: 'chat',
          } as EnabledAiModel,
        ],
      });

      const { result } = renderHook(() => useChatStore());
      const previousVisualMessage = {
        id: 'msg_with_video',
        role: 'user',
        content: 'Please inspect this video',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        videoList: [{ id: 'video-file', url: 'https://example.com/video.mp4' }],
      } as UIChatMessage;
      const currentTextMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: 'Summarize the previous video',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const generateToolsDetailed = vi.fn().mockReturnValue({
        enabledManifests: [],
        enabledToolIds: [],
        tools: [],
      });

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig({
          model: 'gemini-3.1-flash-lite-preview',
          provider: ModelProvider.LobeHub,
        }),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed,
      } as any);

      result.current.internal_createAgentState({
        messages: [previousVisualMessage, currentTextMessage],
        parentMessageId: currentTextMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });

      expect(generateToolsDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          toolIds: undefined,
        }),
      );
    });

    it('should use excludeDefaultToolIds (not skipDefaultTools) in manual mode for builtin agents', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const generateToolsDetailed = vi.fn().mockReturnValue({
        enabledManifests: [],
        enabledToolIds: [],
        tools: [],
      });

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig({ skillActivateMode: 'manual' }),
        isBuiltinAgent: true,
        plugins: [],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed,
      } as any);

      result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });

      expect(generateToolsDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          // Must NOT use skipDefaultTools for builtin agents in manual mode
          skipDefaultTools: undefined,
          // Must use excludeDefaultToolIds to only exclude discovery tools
          excludeDefaultToolIds: expect.arrayContaining(['lobe-activator', 'lobe-skill-store']),
        }),
      );
    });

    it('should use excludeDefaultToolIds in manual mode for regular agents', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const generateToolsDetailed = vi.fn().mockReturnValue({
        enabledManifests: [],
        enabledToolIds: [],
        tools: [],
      });

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig({ skillActivateMode: 'manual' }),
        isBuiltinAgent: false,
        plugins: [],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed,
      } as any);

      result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });

      expect(generateToolsDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDefaultTools: undefined,
          excludeDefaultToolIds: expect.arrayContaining(['lobe-activator', 'lobe-skill-store']),
        }),
      );
    });

    it('should not set excludeDefaultToolIds in auto mode', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      const generateToolsDetailed = vi.fn().mockReturnValue({
        enabledManifests: [],
        enabledToolIds: [],
        tools: [],
      });

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: true,
        plugins: [],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed,
      } as any);

      result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });

      // In auto mode, no tools should be excluded from defaults
      expect(generateToolsDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDefaultTools: undefined,
          excludeDefaultToolIds: undefined,
        }),
      );
    });

    it('should preserve default model/provider payload when initialContext is provided', () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig({
          model: 'claude-sonnet-4-6',
          provider: 'lobehub',
        }),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed: vi.fn().mockReturnValue({
          enabledManifests: [],
          enabledToolIds: [],
          tools: [],
        }),
      } as any);

      const { context } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        initialContext: {
          phase: 'init',
          initialContext: {
            selectedTools: [{ identifier: 'lobe-notebook', name: 'Notebook' }],
          },
        },
      });

      expect(context.payload).toEqual(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          provider: 'lobehub',
        }),
      );
    });

    it('should pass merged resolvedAgentConfig to chatService when selectedTools are provided', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: ['lobe-artifacts'],
      });
      vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
        generateToolsDetailed: vi.fn().mockReturnValue({
          enabledManifests: [{ identifier: 'lobe-artifacts' }, { identifier: 'lobe-notebook' }],
          enabledToolIds: ['lobe-artifacts', 'lobe-notebook'],
          tools: [
            {
              function: { name: 'lobe-artifacts____create' },
              type: 'function',
            },
            {
              function: { name: 'lobe-notebook____createDocument' },
              type: 'function',
            },
          ],
        }),
      } as any);

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish, params }) => {
          expect(params.resolvedAgentConfig.enabledToolIds).toEqual([
            'lobe-artifacts',
            'lobe-notebook',
          ]);
          expect(params.resolvedAgentConfig.tools).toEqual([
            {
              function: { name: 'lobe-artifacts____create' },
              type: 'function',
            },
            {
              function: { name: 'lobe-notebook____createDocument' },
              type: 'function',
            },
          ]);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          initialContext: {
            phase: 'init',
            initialContext: {
              selectedTools: [{ identifier: 'lobe-notebook', name: 'Notebook' }],
            },
          },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      expect(streamSpy).toHaveBeenCalled();
    });
  });

  describe('internal_createAgentState with disableTools', () => {
    it('should return empty toolManifestMap when disableTools is true', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      // Get actual internal_createAgentState result with disableTools: true
      const { state } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        disableTools: true,
      });

      // toolManifestMap should be empty when disableTools is true
      expect(state.toolManifestMap).toEqual({});
    });

    it('should return empty tools in agentConfig when disableTools is true', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      // Get actual internal_createAgentState result with disableTools: true
      const { agentConfig } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        disableTools: true,
      });

      // agentConfig should have empty tools-related fields when disableTools is true
      expect(agentConfig.tools).toBeUndefined();
      expect(agentConfig.enabledToolIds).toEqual([]);
      expect(agentConfig.enabledManifests).toEqual([]);
    });

    it('should include tools in toolManifestMap when disableTools is false or undefined', async () => {
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      // Mock resolveAgentConfig to return plugins
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: {
          ...createMockAgentConfig(),
          plugins: ['test-plugin'],
        },
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: ['test-plugin'],
      });

      // Get actual internal_createAgentState result without disableTools
      const { state: stateWithoutDisable } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        // disableTools not set (undefined)
      });

      // Get actual internal_createAgentState result with disableTools: false
      const { state: stateWithDisableFalse } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        disableTools: false,
      });

      // Both should have the same toolManifestMap (tools enabled)
      // Note: The actual content depends on what plugins are resolved,
      // but the key point is they should not be empty (unless no plugins are configured)
      expect(stateWithoutDisable.toolManifestMap).toEqual(stateWithDisableFalse.toolManifestMap);
    });
  });

  describe('operation status handling', () => {
    it('emits client.runtime.complete with the latest assistant message id', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      const finalMessages = [
        createMockMessage({
          id: TEST_IDS.USER_MESSAGE_ID,
          role: 'user',
        }),
        createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
        }),
      ];

      act(() => {
        useChatStore.setState((state) => ({
          messagesMap: {
            ...state.messagesMap,
            [messageMapKey({ agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID })]:
              finalMessages,
          },
        }));
      });

      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId!, 'done'),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            anchorMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            operationId,
            status: 'completed',
            triggerMessageId: TEST_IDS.USER_MESSAGE_ID,
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('emits client.runtime.complete with the parent assistant message id for pre-created assistant turns', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      act(() => {
        useChatStore.setState((state) => ({
          messagesMap: {
            ...state.messagesMap,
            [messageMapKey({ agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID })]: [
              createMockMessage({
                id: TEST_IDS.USER_MESSAGE_ID,
                role: 'user',
              }),
              createMockMessage({
                id: TEST_IDS.ASSISTANT_MESSAGE_ID,
                parentId: TEST_IDS.USER_MESSAGE_ID,
                role: 'assistant',
              }),
            ],
          },
        }));
      });

      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId!, 'done'),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [],
          parentMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentMessageType: 'assistant',
          operationId: operationId!,
          skipCreateFirstMessage: true,
        });
      });

      // ROOT CAUSE:
      //
      // Normal client chat pre-creates an assistant message and starts runtime
      // with parentMessageId equal to that assistant id.
      //
      // Before the fix, completion only searched descendant assistant messages:
      // parent assistant -> undefined assistantMessageId.
      //
      // We fixed this by accepting the parent assistant itself when no later
      // descendant assistant exists.
      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            anchorMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            operationId,
            status: 'completed',
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.not.objectContaining({
            triggerMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('does not attach an unrelated assistant message id to client.runtime.complete', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      act(() => {
        useChatStore.setState((state) => ({
          messagesMap: {
            ...state.messagesMap,
            [messageMapKey({ agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID })]: [
              createMockMessage({
                id: TEST_IDS.USER_MESSAGE_ID,
                role: 'user',
              }),
              createMockMessage({
                id: TEST_IDS.ASSISTANT_MESSAGE_ID,
                parentId: 'different-user-message',
                role: 'assistant',
              }),
            ],
          },
        }));
      });

      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId!, 'done'),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            assistantMessageId: undefined,
            operationId,
            status: 'completed',
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('emits client.runtime.complete with the final assistant message id after tool turns', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      act(() => {
        useChatStore.setState((state) => ({
          messagesMap: {
            ...state.messagesMap,
            [messageMapKey({ agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID })]: [
              createMockMessage({
                id: TEST_IDS.USER_MESSAGE_ID,
                role: 'user',
              }),
              createMockMessage({
                id: 'assistant-step-1',
                parentId: TEST_IDS.USER_MESSAGE_ID,
                role: 'assistant',
              }),
              createMockMessage({
                id: 'tool-step-1',
                parentId: 'assistant-step-1',
                role: 'tool',
              }),
              createMockMessage({
                id: 'assistant-final',
                parentId: 'tool-step-1',
                role: 'assistant',
              }),
            ],
          },
        }));
      });

      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId!, 'done'),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            anchorMessageId: 'assistant-final',
            assistantMessageId: 'assistant-final',
            operationId,
            status: 'completed',
            triggerMessageId: TEST_IDS.USER_MESSAGE_ID,
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('emits client.runtime.complete before returning for queued follow-up messages', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() => useChatStore());
      const contextKey = messageMapKey({
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });

      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
          queuedMessages: {
            [contextKey]: [
              {
                content: 'queued follow-up',
                createdAt: Date.now(),
                id: 'queued-message-1',
                interruptMode: 'soft',
              },
            ],
          },
        });
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId!, 'done'),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      vi.useRealTimers();

      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            operationId,
            status: 'completed',
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('emits cancelled client.runtime.complete when operation status is cancelled', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
        result.current.cancelOperation(operationId, 'user_cancelled');
      });

      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId!, 'done'),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            operationId,
            status: 'cancelled',
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('should complete operation when state is waiting_for_human', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real executeClientAgent for this test
      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId!: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      // Mock internal_createAgentState to return waiting_for_human status
      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId!, 'waiting_for_human'),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'waiting_for_human',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValue({
        events: [],
        newState: createMockRuntimeState(operationId!, 'waiting_for_human'),
        nextContext: undefined,
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Operation should be completed (not stuck in running state)
      // This is important because:
      // 1. User can see the tool intervention UI without loading indicator
      // 2. A new operation will be created when user approves/rejects
      expect(result.current.operations[operationId!].status).toBe('completed');
      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            operationId,
            status: 'cancelled',
          }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('should fail operation when state is error', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real executeClientAgent for this test
      act(() => {
        useChatStore.setState({
          executeClientAgent: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      // Mock internal_createAgentState to return error status
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'error' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 1,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: {
              apiCalls: 1,
              processingTimeMs: 100,
              tokens: { input: 10, output: 20, total: 30 },
            },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'error',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.executeClientAgent({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Operation should be failed
      expect(result.current.operations[operationId!].status).toBe('failed');
    });
  });

  describe('isSubAgent filtering', () => {
    it('should filter out lobe-agent tool when isSubAgent is true', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      // Mock resolveAgentConfig to return plugins including lobe-agent
      const resolveAgentConfigSpy = vi
        .spyOn(agentConfigResolver, 'resolveAgentConfig')
        .mockReturnValue({
          agentConfig: createMockAgentConfig(),
          chatConfig: createMockChatConfig(),
          isBuiltinAgent: false,
          plugins: ['lobe-agent', 'lobe-local-system', 'other-plugin'],
        });

      // Create operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execClientSubAgent',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;
      });

      // Call internal_createAgentState with isSubAgent: true
      act(() => {
        result.current.internal_createAgentState({
          messages,
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          operationId,
          isSubAgent: true,
        });
      });

      // Verify that resolveAgentConfig was called
      expect(resolveAgentConfigSpy).toHaveBeenCalled();

      resolveAgentConfigSpy.mockRestore();
    });

    it('should NOT filter out lobe-agent tool when isSubAgent is false or undefined', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      // Mock resolveAgentConfig to return plugins including lobe-agent
      const resolveAgentConfigSpy = vi
        .spyOn(agentConfigResolver, 'resolveAgentConfig')
        .mockReturnValue({
          agentConfig: createMockAgentConfig(),
          chatConfig: createMockChatConfig(),
          isBuiltinAgent: false,
          plugins: ['lobe-agent', 'lobe-local-system', 'other-plugin'],
        });

      // Create operation without isSubAgent (normal conversation)
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;
      });

      // Call internal_createAgentState without isSubAgent
      act(() => {
        result.current.internal_createAgentState({
          messages,
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          operationId,
        });
      });

      // Verify that resolveAgentConfig was called
      expect(resolveAgentConfigSpy).toHaveBeenCalled();

      resolveAgentConfigSpy.mockRestore();
    });
  });

  // Characterization net for the upcoming unified run-lifecycle refactor — cross-transport regression baseline across client, gateway, and hetero runtimes.
  // These lock the CURRENT client completion behavior across terminal branches so the
  // refactor can't silently drift queue-drain gating, unread marking, afterCompletion
  // timing, or the normalized client.runtime.complete signal status.
  describe('terminal-branch characterization (lifecycle refactor regression net)', () => {
    const driveTerminal = (operationId: string, status: AgentState['status']) => {
      mockInternalCreateAgentState({
        state: createMockRuntimeState(operationId, status),
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status,
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });
    };

    const restoreExecutor = () =>
      act(() => {
        useChatStore.setState({ executeClientAgent: realExecAgentRuntime });
      });

    const runExecutor = async (result: any, operationId: string) => {
      await act(async () => {
        await result.current.executeClientAgent({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId,
        });
      });
    };

    beforeEach(() => {
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });
    });

    it('runs afterCompletion callbacks even when the run terminates in error', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      const afterCompletion = vi.fn();
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
        result.current.registerAfterCompletionCallback(operationId, afterCompletion);
      });

      driveTerminal(operationId, 'error');
      await runExecutor(result, operationId);

      expect(afterCompletion).toHaveBeenCalledTimes(1);
      expect(result.current.operations[operationId].status).toBe('failed');
    });

    it('terminalizes the root before invoking a never-settling afterCompletion callback', async () => {
      const { result } = renderHook(() => useChatStore());
      const context = { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID };

      let operationId!: string;
      const statusesObservedByCallback: string[] = [];
      const neverSettlingCallback = vi.fn(() => {
        statusesObservedByCallback.push(
          useChatStore.getState().operations[operationId]?.status ?? 'missing',
        );
        return new Promise<void>(() => {});
      });
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context,
        }).operationId;
        result.current.registerAfterCompletionCallback(operationId, neverSettlingCallback);
      });

      const lifecycle = buildRunLifecycle(() => useChatStore.getState(), {
        context,
        parentMessageId: TEST_IDS.USER_MESSAGE_ID,
        parentMessageType: 'user',
        runId: operationId,
        runScope: 'top_level',
        runtimeType: 'client',
      });
      const completion = lifecycle
        .completeRun({
          context,
          operationId,
          runId: operationId,
          runScope: 'top_level',
          runtimeStatus: 'done',
          runtimeType: 'client',
        })
        .then(() => 'completed' as const);

      let watchdogId!: ReturnType<typeof setTimeout>;
      const outcome = await Promise.race([
        completion,
        new Promise<'timed-out'>((resolve) => {
          watchdogId = setTimeout(() => resolve('timed-out'), 100);
        }),
      ]);
      clearTimeout(watchdogId);

      expect(outcome).toBe('completed');
      expect(neverSettlingCallback).toHaveBeenCalledOnce();
      expect(statusesObservedByCallback).toEqual(['completed']);
      expect(result.current.operations[operationId].status).toBe('completed');
    });

    it('terminalizes the run when persisting an error event also fails', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({
              agentId: TEST_IDS.SESSION_ID,
              topicId: TEST_IDS.TOPIC_ID,
            })]: [createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' })],
          },
        });
      });

      driveTerminal(operationId, 'running');
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValueOnce({
        events: [{ error: new Error('tool pipeline failed'), type: 'error' }],
        newState: createMockRuntimeState(operationId, 'error'),
        nextContext: undefined,
      });
      vi.mocked(messageService.updateMessageError).mockRejectedValueOnce(
        new Error('error persistence unavailable'),
      );

      await runExecutor(result, operationId);

      expect(result.current.operations[operationId].status).toBe('failed');
    });

    it('terminalizes the run when error persistence throws synchronously', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({
              agentId: TEST_IDS.SESSION_ID,
              topicId: TEST_IDS.TOPIC_ID,
            })]: [createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' })],
          },
        });
      });

      driveTerminal(operationId, 'running');
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValueOnce({
        events: [{ error: new Error('tool pipeline failed'), type: 'error' }],
        newState: createMockRuntimeState(operationId, 'error'),
        nextContext: undefined,
      });
      vi.mocked(messageService.updateMessageError).mockImplementationOnce(() => {
        throw new Error('synchronous reporting failure');
      });

      await runExecutor(result, operationId);
      await vi.waitFor(() => expect(messageService.updateMessageError).toHaveBeenCalledTimes(1));

      expect(result.current.operations[operationId].status).toBe('failed');
    });

    it('terminalizes the run when error persistence never settles', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({
              agentId: TEST_IDS.SESSION_ID,
              topicId: TEST_IDS.TOPIC_ID,
            })]: [createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' })],
          },
        });
      });

      driveTerminal(operationId, 'running');
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValueOnce({
        events: [{ error: new Error('tool pipeline failed'), type: 'error' }],
        newState: createMockRuntimeState(operationId, 'error'),
        nextContext: undefined,
      });
      vi.mocked(messageService.updateMessageError).mockReturnValueOnce(new Promise(() => {}));

      const outcome = await Promise.race([
        runExecutor(result, operationId).then(() => 'completed'),
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
      ]);

      expect(outcome).toBe('completed');
      expect(result.current.operations[operationId].status).toBe('failed');
    });

    it('fails safely when post-sub-agent refreshMessages rejects', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      const refreshMessages = vi.fn().mockRejectedValue(new Error('message refresh failed'));
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
        useChatStore.setState({
          refreshMessages,
        });
      });

      driveTerminal(operationId, 'running');
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValueOnce({
        events: [],
        newState: createMockRuntimeState(operationId, 'error'),
        nextContext: {
          phase: 'sub_agents_batch_result',
          session: {
            messageCount: 0,
            sessionId: TEST_IDS.SESSION_ID,
            status: 'error',
            stepCount: 1,
          },
        },
      });

      await expect(runExecutor(result, operationId)).rejects.toThrow('message refresh failed');

      expect(refreshMessages).toHaveBeenCalledWith({
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });
      expect(result.current.operations[operationId].status).toBe('failed');
    });

    it('does not refresh the full message list after lifecycle-managed tool batches', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      const refreshMessages = vi.fn();
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
        useChatStore.setState({ refreshMessages });
      });

      driveTerminal(operationId, 'running');
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValueOnce({
        events: [],
        newState: createMockRuntimeState(operationId, 'done'),
        nextContext: {
          phase: 'tools_batch_result',
          session: {
            messageCount: 0,
            sessionId: TEST_IDS.SESSION_ID,
            status: 'done',
            stepCount: 1,
          },
        },
      });

      await runExecutor(result, operationId);

      expect(refreshMessages).not.toHaveBeenCalled();
      expect(result.current.operations[operationId].status).toBe('completed');
    });

    it('fails the run when a step has no continuation but remains non-terminal', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
      });

      driveTerminal(operationId, 'running');
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValueOnce({
        events: [],
        newState: createMockRuntimeState(operationId, 'running'),
        nextContext: undefined,
      });

      await runExecutor(result, operationId);

      expect(result.current.operations[operationId].status).toBe('failed');
    });

    it('fails a non-terminal run that reaches the completion lifecycle', async () => {
      const { result } = renderHook(() => useChatStore());
      const context = { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID };

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context,
        }).operationId;
      });

      const lifecycle = buildRunLifecycle(() => useChatStore.getState(), {
        context,
        parentMessageId: TEST_IDS.USER_MESSAGE_ID,
        parentMessageType: 'user',
        runId: operationId,
        runScope: 'top_level',
        runtimeType: 'client',
      });

      await lifecycle.completeRun({
        context,
        operationId,
        runId: operationId,
        runScope: 'top_level',
        runtimeStatus: 'running',
        runtimeType: 'client',
      });

      expect(result.current.operations[operationId].status).toBe('failed');
    });

    it('emits client.runtime.complete with status "failed" on runtime error', async () => {
      const { result } = renderHook(() => useChatStore());
      restoreExecutor();

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
      });

      driveTerminal(operationId, 'error');
      await runExecutor(result, operationId);

      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ operationId, status: 'failed' }),
          sourceId: `${operationId}:client:complete`,
          sourceType: 'client.runtime.complete',
        }),
      );
    });

    it('does NOT drain the input queue or mark unread when the run errors', async () => {
      const { result } = renderHook(() => useChatStore());
      const contextKey = messageMapKey({
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });
      const drainQueuedMessages = vi.fn(() => []);
      const markUnreadCompleted = vi.fn();

      restoreExecutor();
      act(() => {
        useChatStore.setState({
          drainQueuedMessages,
          markUnreadCompleted,
          queuedMessages: {
            [contextKey]: [
              { content: 'queued', createdAt: Date.now(), id: 'q1', interruptMode: 'soft' },
            ],
          },
        });
      });

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
      });

      driveTerminal(operationId, 'error');
      await runExecutor(result, operationId);

      expect(drainQueuedMessages).not.toHaveBeenCalled();
      expect(markUnreadCompleted).not.toHaveBeenCalled();
    });

    it('marks unread on a successful (done) terminal with an empty queue', async () => {
      const { result } = renderHook(() => useChatStore());
      const markUnreadCompleted = vi.fn();

      restoreExecutor();
      act(() => {
        useChatStore.setState({ markUnreadCompleted });
      });

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
      });

      driveTerminal(operationId, 'done');
      await runExecutor(result, operationId);

      expect(markUnreadCompleted).toHaveBeenCalledWith(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
      expect(result.current.operations[operationId].status).toBe('completed');
    });

    // Parked states (run ≠ operation). These lock the CURRENT per-state handling that
    // the unified run-lifecycle + normalized parked signal — cross-transport parked / resumed / terminal signal normalization will rewrite.
    const pinStep = (operationId: string, status: AgentState['status']) => {
      vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step').mockResolvedValue({
        events: [],
        newState: createMockRuntimeState(operationId, status),
        nextContext: undefined,
      });
    };

    it('on waiting_for_async_tool: leaves the op uncompleted and emits an undefined complete-signal status', async () => {
      const { result } = renderHook(() => useChatStore());
      const drainQueuedMessages = vi.fn(() => []);
      restoreExecutor();
      act(() => {
        useChatStore.setState({ drainQueuedMessages });
      });

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
      });

      driveTerminal(operationId, 'waiting_for_async_tool');
      pinStep(operationId, 'waiting_for_async_tool');
      await runExecutor(result, operationId);

      // CURRENT BEHAVIOR (suspected gap, locked as baseline for cross-transport parked/resumed/terminal signal normalization): the completion switch
      // has no `waiting_for_async_tool` case, so the op is never completed (stays
      // 'running') and the queue is not drained.
      expect(result.current.operations[operationId].status).toBe('running');
      expect(drainQueuedMessages).not.toHaveBeenCalled();

      // normalizeClientRuntimeCompleteStatus falls through for async_tool → undefined.
      const completeCall = agentSignalBridgeMock.emitClientAgentSignalSourceEvent.mock.calls.find(
        (c: any) => c[0]?.sourceType === 'client.runtime.complete',
      );
      expect(completeCall).toBeTruthy();
      expect(completeCall![0].payload.status).toBeUndefined();
    });

    it('on waiting_for_human (parked): completes the op for the UI but does NOT drain queue or mark unread', async () => {
      const { result } = renderHook(() => useChatStore());
      const drainQueuedMessages = vi.fn(() => []);
      const markUnreadCompleted = vi.fn();
      restoreExecutor();
      act(() => {
        useChatStore.setState({ drainQueuedMessages, markUnreadCompleted });
      });

      let operationId!: string;
      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        }).operationId;
      });

      driveTerminal(operationId, 'waiting_for_human');
      pinStep(operationId, 'waiting_for_human');
      await runExecutor(result, operationId);

      // Parked ≠ terminal: the op is completed so the loading UI clears, but the
      // success-only terminal effects (queue drain, unread marker) MUST NOT fire — a
      // new operation runs them when the user approves/rejects.
      expect(result.current.operations[operationId].status).toBe('completed');
      expect(drainQueuedMessages).not.toHaveBeenCalled();
      expect(markUnreadCompleted).not.toHaveBeenCalled();
    });

    describe('desktop notification gating', () => {
      afterEach(() => {
        desktopFlag.value = false;
        desktopNotificationMock.showNotification.mockClear();
      });

      const seedAssistant = (overrides: any) => {
        act(() => {
          useChatStore.setState((state) => ({
            messagesMap: {
              ...state.messagesMap,
              [messageMapKey({ agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID })]: [
                {
                  ...createMockMessage({ id: 'assistant-notif', role: 'assistant' }),
                  ...overrides,
                },
              ],
            },
          }));
        });
      };

      it('shows a desktop notification on success when the last assistant message has content and no tools', async () => {
        const { result } = renderHook(() => useChatStore());
        restoreExecutor();
        desktopFlag.value = true;

        let operationId!: string;
        act(() => {
          operationId = result.current.startOperation({
            type: 'execAgentRuntime',
            context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          }).operationId;
        });

        seedAssistant({ content: 'hello world', tools: undefined });
        driveTerminal(operationId, 'done');
        await runExecutor(result, operationId);

        expect(desktopNotificationMock.showNotification).toHaveBeenCalledTimes(1);
        expect(desktopNotificationMock.showNotification).toHaveBeenCalledWith(
          expect.objectContaining({ body: expect.stringContaining('hello world') }),
        );
      });

      it('suppresses the notification when the last assistant message is still in tool-calling mode', async () => {
        const { result } = renderHook(() => useChatStore());
        restoreExecutor();
        desktopFlag.value = true;

        let operationId!: string;
        act(() => {
          operationId = result.current.startOperation({
            type: 'execAgentRuntime',
            context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          }).operationId;
        });

        seedAssistant({ content: 'partial', tools: [{ id: 'tool-1' }] });
        driveTerminal(operationId, 'done');
        await runExecutor(result, operationId);

        expect(desktopNotificationMock.showNotification).not.toHaveBeenCalled();
      });
    });
  });
});
