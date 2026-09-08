import { type AgentState } from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ContextEngineering from '@/server/modules/Mecha/ContextEngineering';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

import { ModelEmptyError } from '../ModelEmptyError';
import {
  collectProviderMediaTokenEstimates,
  createRuntimeExecutors,
  hasPendingWorkspaceBindFailure,
  resolveCompressionSummaryBudgetTokens,
  type RuntimeExecutorContext,
} from '../RuntimeExecutors';

const mockCreateCompressionGroup = vi.fn();
const mockCancelCompression = vi.fn();
const mockFailCompression = vi.fn();
const mockFinalizeCompression = vi.fn();
const mockBuiltinModels = vi.hoisted(() => [
  {
    abilities: { functionCall: true, video: false, vision: true },
    id: 'gpt-4',
    providerId: 'openai',
  },
  {
    abilities: { functionCall: true, video: true, vision: true },
    id: 'qwen3.6-plus',
    providerId: 'qwen',
    settings: { extendParams: ['preserveThinking'] },
  },
  {
    abilities: { functionCall: false, video: false, vision: false },
    id: 'no-tools-model',
    providerId: 'test-provider',
  },
  {
    abilities: { functionCall: true, video: true, vision: true },
    id: 'gemini-3.1-flash-lite-preview',
    providerId: 'google',
    settings: { extendParams: ['preserveThinking'] },
  },
]);

// Mock dependencies
vi.mock('@/server/modules/ModelRuntime', () => ({
  createTraceOptions: vi.fn(() => ({ callback: {}, headers: new Headers() })),
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    // Emit a minimal non-empty completion so the call_llm empty-completion
    // guard doesn't treat the default mock as a "gave up" turn and
    // throw ModelEmptyError. Tests that exercise real output override this.
    chat: vi.fn().mockImplementation(async (_payload: any, options: any) => {
      await options?.callback?.onText?.('done');
      return new Response('done');
    }),
  }),
}));

vi.mock('@/server/services/message', () => ({
  MessageService: vi.fn().mockImplementation(() => ({
    cancelCompression: mockCancelCompression,
    createCompressionGroup: mockCreateCompressionGroup,
    failCompression: mockFailCompression,
    finalizeCompression: mockFinalizeCompression,
  })),
}));

// @lobechat/model-runtime resolves to @cloud/business-model-runtime which has
// cloud-specific dependencies that are unavailable in the test environment
vi.mock('@lobechat/model-runtime', () => ({
  // The executor resolves extend params via this helper; an empty result keeps
  // the runtime payload unchanged, matching this suite's pre-existing behavior.
  applyModelExtendParams: vi.fn(() => ({})),
  consumeStreamUntilDone: vi.fn().mockResolvedValue(undefined),
  // `llmErrorClassification.ts` reads these at module-load time; an empty
  // spec map is fine here because this suite never exercises the runtime
  // retry classifier path.
  ERROR_CODE_SPECS: {},
  getErrorCodeSpec: () => undefined,
  refineErrorCode: () => undefined,
}));

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue(mockBuiltinModels),
}));

// model-bank is a TypeScript source file that cannot be dynamically imported in vitest
vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: mockBuiltinModels,
}));

// composioEnv uses @t3-oss/env-nextjs which throws in jsdom (treats it as client context)
vi.mock('@/config/composio', () => ({
  getComposioConfig: vi.fn(),
  getServerComposioApiKey: vi.fn().mockReturnValue(undefined),
  composioEnv: { COMPOSIO_API_KEY: undefined },
}));

// fileEnv uses @t3-oss/env-core; stub the only field the runtime reads so the
// generated-image upload pathname is deterministic.
vi.mock('@/envs/file', () => ({
  fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' },
}));

const { mockFindFileById } = vi.hoisted(() => ({ mockFindFileById: vi.fn() }));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({
    findById: mockFindFileById,
    findFilesToInitInSandbox: vi.fn().mockResolvedValue([]),
  })),
}));

// FileService is constructed by the runtime to persist model-generated images
// and to read user-uploaded image attachments for provider-safe data URLs.
// `mockUploadBase64` is the spy multimodal-image tests assert against.
const { mockGetFileByteArray, mockUploadBase64 } = vi.hoisted(() => ({
  mockGetFileByteArray: vi.fn(),
  mockUploadBase64: vi.fn(),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFileByteArray: mockGetFileByteArray,
    getFileAccessUrl: vi.fn().mockResolvedValue('https://files.example/access'),
    uploadBase64: mockUploadBase64,
  })),
}));

describe('RuntimeExecutors', () => {
  let mockMessageModel: any;
  let mockStreamManager: any;
  let mockToolExecutionService: any;
  let ctx: RuntimeExecutorContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFileById.mockReset();
    mockGetFileByteArray.mockReset();
    mockUploadBase64.mockReset();
    vi.mocked(initModelRuntimeFromDB).mockReset();
    mockCancelCompression.mockReset();
    mockFailCompression.mockReset();
    mockCreateCompressionGroup.mockReset();
    mockFinalizeCompression.mockReset();
    mockCreateCompressionGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [],
      success: true,
    });
    mockCancelCompression.mockResolvedValue({ messages: [], success: true });
    mockFailCompression.mockResolvedValue({ messages: [], success: true });
    mockFinalizeCompression.mockResolvedValue({ success: true });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
      chat: vi.fn().mockImplementation(async (_payload: any, options: any) => {
        await options?.callback?.onText?.('done');
        return new Response('done');
      }),
    } as any);

    mockMessageModel = {
      create: vi.fn().mockResolvedValue({ id: 'msg-123' }),
      deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      // call_llm does a parent existence preflight; return a truthy row by
      // default so existing tests don't have to stub it.
      findById: vi.fn().mockResolvedValue({ id: 'msg-existing' }),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMessagePlugin: vi.fn().mockResolvedValue({ success: true }),
      updateToolMessage: vi.fn().mockResolvedValue({ success: true }),
    };

    mockStreamManager = {
      publishStreamChunk: vi.fn().mockResolvedValue('event-1'),
      publishStreamEvent: vi.fn().mockResolvedValue('event-2'),
    };

    mockToolExecutionService = {
      executeTool: vi.fn().mockResolvedValue({
        content: 'Tool result',
        error: null,
        executionTime: 100,
        state: {},
        success: true,
      }),
    };

    ctx = {
      createTraceOptions,
      initModelRuntime: initModelRuntimeFromDB,
      loadAgentState: vi.fn().mockResolvedValue(null),
      messageModel: mockMessageModel,
      operationId: 'op-123',
      serverDB: {} as any, // Mock serverDB
      stepIndex: 0,
      streamManager: mockStreamManager,
      toolExecutionService: mockToolExecutionService,
      userId: 'user-123',
    };
  });

  /**
   * Serialize everything a step hands back, with Errors expanded — a bare
   * `JSON.stringify` renders an Error as `{}` and would pass a "no raw failure
   * details" assertion even if one were embedded.
   */
  const serializeForSecretScan = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item instanceof Error ? `${item.name}: ${item.message}` : item,
    );

  // Helper to create a valid mock usage object
  const createMockUsage = () => ({
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: {
      apiCalls: 0,
      processingTimeMs: 0,
      tokens: { input: 0, output: 0, total: 0 },
    },
    tools: {
      byTool: [],
      totalCalls: 0,
      totalTimeMs: 0,
    },
  });

  // Helper to create a valid mock cost object
  const createMockCost = () => ({
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    llm: {
      byModel: [],
      currency: 'USD',
      total: 0,
    },
    tools: {
      byTool: [],
      currency: 'USD',
      total: 0,
    },
    total: 0,
  });

  const createCompressContextInstruction = (messages: any[]) => ({
    payload: {
      currentTokenCount: 1000,
      messages,
    },
    type: 'compress_context' as const,
  });

  describe('operation-frozen context budget inputs', () => {
    it('uses the matching compression model catalog window without a 32k cap', () => {
      expect(
        resolveCompressionSummaryBudgetTokens({
          compressionModel: { model: 'summary-model', provider: 'openai' },
          compressionModelCatalogSnapshot: {
            capturedAt: '2026-09-04T00:00:00.000Z',
            entry: {
              abilitySources: {},
              contextWindowSource: 'catalog',
              contextWindowTokens: 128_000,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'unknown',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'catalog',
              modelId: 'summary-model',
              providerId: 'openai',
            },
            operationId: 'op-123',
            version: 1,
          },
        }),
      ).toBe(126_976);
    });

    it('never expands a tiny compression model window beyond its prompt capacity', () => {
      expect(
        resolveCompressionSummaryBudgetTokens({
          compressionModel: { model: 'tiny-summary-model', provider: 'openai' },
          compressionModelCatalogSnapshot: {
            capturedAt: '2026-09-04T00:00:00.000Z',
            entry: {
              abilitySources: {},
              contextWindowSource: 'catalog',
              contextWindowTokens: 1024,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'unknown',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'catalog',
              modelId: 'tiny-summary-model',
              providerId: 'openai',
            },
            operationId: 'op-123',
            version: 1,
          },
        }),
      ).toBe(1);
    });

    it('redacts provider media bytes while retaining stable accounting identity', () => {
      expect(
        collectProviderMediaTokenEstimates(
          [
            {
              content: [
                { text: 'inspect', type: 'text' },
                { image_url: { url: 'https://files.example/image-1' }, type: 'image_url' },
              ],
              id: 'message-1',
              role: 'user',
            },
          ] as any,
          [
            {
              id: 'message-1',
              imageList: [{ id: 'file-1', url: 'https://files.example/image-1' }],
              role: 'user',
            } as any,
          ],
        ),
      ).toEqual([{ estimatedTokens: 1000, id: 'file-1', messageId: 'message-1' }]);
    });
  });

  describe('finish executor', () => {
    it('persists the terminal topic state even when no renderer is connected', async () => {
      const completeTopicOperation = vi.fn().mockResolvedValue(undefined);
      const executors = createRuntimeExecutors({
        ...ctx,
        completeTopicOperation,
        topicId: 'topic-123',
      } as RuntimeExecutorContext);
      const state = {
        cost: createMockCost(),
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        maxSteps: 10,
        messages: [],
        operationId: 'op-123',
        status: 'running',
        stepCount: 0,
        toolManifestMap: {},
        usage: createMockUsage(),
      } as AgentState;

      await executors.finish!({ reason: 'completed', type: 'finish' }, state);

      expect(completeTopicOperation).toHaveBeenCalledWith({
        operationId: 'op-123',
        status: 'active',
        topicId: 'topic-123',
      });
    });
  });

  describe('call_llm executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      modelRuntimeConfig: {
        model: 'gpt-4',
        provider: 'openai',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    it('should pass parentId from payload.parentId to messageModel.create', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent-msg-123',
        }),
      );
      expect(FileService).not.toHaveBeenCalled();
    });

    it('does not send an LLM request when projected input exceeds the remaining token budget', async () => {
      const chat = vi.fn();
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        executionBudget: { maxDurationMs: 60_000, maxSteps: 10, maxTotalTokens: 1 },
      });
      const instruction = {
        payload: {
          messages: [{ content: 'This request is larger than one token', role: 'user' }],
          model: 'gpt-4',
          provider: 'openai',
        },
        type: 'call_llm' as const,
      };

      const result = await executors.call_llm!(instruction, state);

      expect(chat).not.toHaveBeenCalled();
      expect(result.newState.status).toBe('interrupted');
      expect(result.newState.metadata?.executionBudgetCompletionReason).toBe('token_limit');
    });

    it('fails closed at the final preflight when an unknown model window exceeds the assumed budget', async () => {
      const chat = vi.fn();
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-123',
          modelCatalogSnapshot: {
            capturedAt: '2026-09-03T00:00:00.000Z',
            entry: {
              abilitySources: {},
              contextWindowSource: 'unknown',
              contextWindowTokens: 32_000,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'unknown',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'default',
              modelId: 'unknown-model',
              providerId: 'unknown-provider',
            },
            operationId: 'op-123',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });
      const instruction = {
        payload: {
          messages: [{ content: 'x'.repeat(150_000), id: 'tail', role: 'user' }],
          model: 'unknown-model',
          provider: 'unknown-provider',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toMatchObject({
        contextBudget: {
          decision: expect.objectContaining({ kind: 'fail' }),
          trace: expect.any(Object),
        },
        error: expect.objectContaining({ ctx: 32_000 }),
        name: 'FinalContextWindowError',
      });
      expect(chat).not.toHaveBeenCalled();
    });

    it('accounts outgoing visual parts at the final preflight and never forwards accounting metadata', async () => {
      const chat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
        await options?.callback?.onText?.('done');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-123',
          modelCatalogSnapshot: {
            capturedAt: '2026-09-04T00:00:00.000Z',
            entry: {
              abilitySources: {},
              contextWindowSource: 'catalog',
              contextWindowTokens: 32_000,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'supported',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'catalog',
              modelId: 'gpt-4',
              providerId: 'openai',
            },
            operationId: 'op-123',
            version: 1,
          },
          topicId: 'topic-123',
        },
      });
      const imageParts = Array.from({ length: 40 }, (_, index) => ({
        image_url: { url: `https://files.example/${index}.png` },
        type: 'image_url',
      }));

      await expect(
        executors.call_llm!(
          {
            payload: {
              messages: [
                {
                  content: [{ text: 'inspect', type: 'text' }, ...imageParts],
                  id: 'tail',
                  role: 'user',
                },
              ],
              model: 'gpt-4',
              provider: 'openai',
              tools: [],
            },
            type: 'call_llm' as const,
          },
          state,
        ),
      ).rejects.toMatchObject({ name: 'FinalContextWindowError' });
      expect(chat).not.toHaveBeenCalled();
    });

    it('strips providerMedia before the actual model runtime call', async () => {
      const chat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
        await options?.callback?.onText?.('done');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);
      const executors = createRuntimeExecutors(ctx);

      await executors.call_llm!(
        {
          payload: {
            messages: [
              {
                content: [
                  { text: 'inspect', type: 'text' },
                  { image_url: { url: 'https://files.example/image.png' }, type: 'image_url' },
                ],
                id: 'tail',
                role: 'user',
              },
            ],
            model: 'gpt-4',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        },
        createMockState(),
      );

      expect(chat.mock.calls[0][0]).not.toHaveProperty('providerMedia');
    });

    it('persists final-preflight auto compression before sending the reduced payload', async () => {
      const chat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
        await options?.callback?.onText?.('summary-or-answer');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'auto-group',
        messagesToSummarize: [{ content: 'x'.repeat(150_000), id: 'old-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [
          { content: 'summary-or-answer', id: 'auto-group', role: 'compressedGroup' },
          { content: 'continue', id: 'latest-user', role: 'user' },
          { content: '', id: 'msg-123', role: 'assistant' },
        ],
        success: true,
      });
      const executors = createRuntimeExecutors(ctx);
      const messages = [
        { content: 'x'.repeat(150_000), id: 'old-history', role: 'user' },
        { content: 'continue', id: 'latest-user', role: 'user' },
      ];
      const state = createMockState({
        messages: messages as any,
        metadata: {
          agentId: 'agent-123',
          modelCatalogSnapshot: {
            capturedAt: '2026-09-04T00:00:00.000Z',
            entry: {
              abilitySources: {},
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
              modelId: 'gpt-4',
              providerId: 'openai',
            },
            operationId: 'op-123',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const result = await executors.call_llm!(
        {
          payload: { messages, model: 'gpt-4', provider: 'openai', tools: [] },
          type: 'call_llm' as const,
        },
        state,
      );

      expect(mockCreateCompressionGroup).toHaveBeenCalledWith(
        'topic-123',
        ['old-history'],
        expect.any(Object),
      );
      expect(mockFinalizeCompression).toHaveBeenCalledWith(
        'auto-group',
        'summary-or-answer',
        expect.any(Object),
      );
      const providerPayload = chat.mock.calls.at(-1)?.[0];
      expect(providerPayload.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining('[Conversation summary]') }),
        ]),
      );
      expect(result.newState.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'auto-group', role: 'compressedGroup' }),
          expect.objectContaining({ id: 'latest-user', role: 'user' }),
          expect.objectContaining({ id: 'msg-123', role: 'assistant' }),
        ]),
      );
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ groupId: 'auto-group', type: 'compression_complete' }),
        ]),
      );
      expect(mockCancelCompression).not.toHaveBeenCalled();
    });

    it('discards a partial provider attempt before context compression retry commits final output', async () => {
      const onContextWindowObserved = vi.fn();
      const staleToolCall = [
        {
          function: { arguments: '{"path":"stale"}', name: 'filesystem____write' },
          id: 'stale-tool',
          type: 'function',
        },
      ];
      let mainAttempt = 0;
      const chat = vi.fn().mockImplementation(async (payload: any, options: any) => {
        if (payload.model === 'summary-model') {
          await options.callback.onText?.('safe summary');
          return new Response('summary');
        }

        mainAttempt += 1;
        if (mainAttempt === 1) {
          await options.callback.onText?.('stale partial');
          await options.callback.onThinking?.('stale reasoning');
          await options.callback.onContentPart?.({
            content: 'stale-content-image',
            mimeType: 'image/png',
            partType: 'image',
          });
          await options.callback.onReasoningPart?.({
            content: 'stale-reasoning-image',
            mimeType: 'image/png',
            partType: 'image',
          });
          await options.callback.onGrounding?.({ query: 'stale grounding' });
          await options.callback.onToolsCalling?.({ toolsCalling: staleToolCall });
          await options.callback.onCompletion?.({
            usage: { totalInputTokens: 999, totalOutputTokens: 999, totalTokens: 1998 },
          });
          await options.callback.onError?.({
            contextWindowTokens: 16_000,
            message: 'maximum context length is 16000 tokens',
            type: 'ExceededContextWindow',
          });
          return new Response('rejected');
        }

        await options.callback.onText?.('final only');
        await options.callback.onCompletion?.({
          usage: { totalInputTokens: 10, totalOutputTokens: 2, totalTokens: 12 },
        });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);
      mockUploadBase64.mockResolvedValue({ url: 'https://files.example/stale.png' });
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'provider-recovery-group',
        messagesToSummarize: [{ content: 'x'.repeat(40_000), id: 'old-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [
          { content: 'safe summary', id: 'provider-recovery-group', role: 'compressedGroup' },
          { content: 'continue', id: 'latest-user', role: 'user' },
          { content: '', id: 'msg-123', role: 'assistant' },
        ],
        success: true,
      });
      const messages = [
        { content: 'x'.repeat(40_000), id: 'old-history', role: 'user' },
        { content: 'continue', id: 'latest-user', role: 'user' },
      ];
      const state = createMockState({
        messages: messages as any,
        metadata: {
          agentId: 'agent-123',
          modelCatalogSnapshot: {
            capturedAt: '2026-09-04T00:00:00.000Z',
            entry: {
              abilitySources: {},
              contextWindowSource: 'catalog',
              contextWindowTokens: 128_000,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'supported',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'catalog',
              modelId: 'gpt-4',
              providerId: 'openai',
            },
            operationId: 'op-123',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
        modelRuntimeConfig: {
          compressionModel: { model: 'summary-model', provider: 'openai' },
          model: 'gpt-4',
          provider: 'openai',
        },
      });

      const result = await createRuntimeExecutors({ ...ctx, onContextWindowObserved }).call_llm!(
        {
          payload: { messages, model: 'gpt-4', provider: 'openai', tools: [] },
          type: 'call_llm' as const,
        },
        state,
      );

      expect(mainAttempt).toBe(2);
      expect(onContextWindowObserved).toHaveBeenCalledWith({
        contextWindowRejectionTokens: 16_000,
        modelId: 'gpt-4',
        modelVersion: undefined,
        providerId: 'openai',
      });
      expect(result.nextContext?.payload).toMatchObject({
        hasToolsCalling: false,
        result: { content: 'final only', tool_calls: [] },
        toolsCalling: [],
      });
      expect(JSON.stringify(result.events)).not.toContain('stale');
      expect(result.events).toContainEqual(
        expect.objectContaining({
          result: expect.objectContaining({
            content: 'final only',
            reasoning: '',
            tool_calls: [],
            usage: { totalInputTokens: 10, totalOutputTokens: 2, totalTokens: 12 },
          }),
          type: 'llm_result',
        }),
      );
      expect(mockMessageModel.update).toHaveBeenCalledWith(
        'msg-123',
        expect.objectContaining({
          content: 'final only',
          reasoning: undefined,
          tools: undefined,
        }),
      );
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'context_window', reset: true }),
          type: 'stream_retry',
        }),
      );
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          data: expect.objectContaining({
            finalContent: 'final only',
            grounding: null,
            reasoning: undefined,
            toolsCalling: [],
            usage: { totalInputTokens: 10, totalOutputTokens: 2, totalTokens: 12 },
          }),
          type: 'stream_end',
        }),
      );
    });

    it('retains a failed final-preflight compression group when summarization fails', async () => {
      const chat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
        await options?.callback?.onError?.({ message: 'summary failed' });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'auto-failed-group',
        messagesToSummarize: [],
        success: true,
      });
      const messages = [
        { content: 'x'.repeat(150_000), id: 'old-history', role: 'user' },
        { content: 'continue', id: 'latest-user', role: 'user' },
      ];
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: messages as any,
        metadata: {
          agentId: 'agent-123',
          modelCatalogSnapshot: {
            capturedAt: '2026-09-04T00:00:00.000Z',
            entry: {
              abilitySources: {},
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
              modelId: 'gpt-4',
              providerId: 'openai',
            },
            operationId: 'op-123',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      await expect(
        executors.call_llm!(
          {
            payload: { messages, model: 'gpt-4', provider: 'openai', tools: [] },
            type: 'call_llm' as const,
          },
          state,
        ),
      ).rejects.toMatchObject({ name: 'FinalContextWindowError' });

      expect(mockFinalizeCompression).not.toHaveBeenCalled();
      expect(mockFailCompression).toHaveBeenCalledWith(
        'auto-failed-group',
        expect.objectContaining({ topicId: 'topic-123' }),
      );
      expect(mockCancelCompression).not.toHaveBeenCalled();
    });

    it('passes workspaceId to model runtime initialization', async () => {
      const workspaceCtx = { ...ctx, workspaceId: 'ws-1' };
      const executors = createRuntimeExecutors(workspaceCtx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        workspaceCtx.serverDB,
        'user-123',
        'openai',
        'ws-1',
      );
    });

    it('should pass parentId from payload.parentMessageId to messageModel.create', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-456',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent-msg-456',
        }),
      );
    });

    it('should prefer parentId over parentMessageId when both are provided', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentId: 'parent-id-preferred',
          parentMessageId: 'parent-message-id-fallback',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent-id-preferred',
        }),
      );
    });

    it('should throw ConversationParentMissing if parent preflight misses ()', async () => {
      // parent existence preflight — if the parent row was deleted between
      // operation kickoff and call_llm, fail fast before spending LLM tokens
      // on a chain that would hit a FK violation anyway.
      mockMessageModel.findById.mockResolvedValueOnce(null);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentId: 'gone-msg',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toMatchObject({
        errorType: 'ConversationParentMissing',
        parentId: 'gone-msg',
      });
      // LLM never got invoked
      expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
      // No assistant message got created either
      expect(mockMessageModel.create).not.toHaveBeenCalled();
    });

    it('should pass undefined parentId when neither parentId nor parentMessageId is provided', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: undefined,
        }),
      );
    });

    it('should use model and provider from state.modelRuntimeConfig as fallback', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        modelRuntimeConfig: {
          model: 'gpt-3.5-turbo',
          provider: 'openai',
        },
      });

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          parentId: 'parent-123',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-3.5-turbo',
          provider: 'openai',
        }),
      );
    });

    // preserveThinking gates whether reasoning is replayed into the next LLM
    // payload (state.messages). The DB copy powers UI display after refresh and
    // is always persisted regardless of the gate.
    describe('reasoning replay gate', () => {
      it('should replay assistant reasoning with tool calls when preserveThinking is enabled on a supported model', async () => {
        const toolCallPayload = [
          {
            function: { arguments: '{}', name: 'search' },
            id: 'call_1',
            type: 'function',
          },
        ];

        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onThinking?.('Need to inspect the search results first.');
          await options?.callback?.onToolsCalling?.({ toolsCalling: toolCallPayload });
          await options?.callback?.onCompletion?.({
            usage: {
              totalInputTokens: 1,
              totalOutputTokens: 2,
              totalTokens: 3,
            },
          });
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            chatConfig: { preserveThinking: true },
            plugins: [],
            systemRole: 'test',
          },
        };

        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({
          modelRuntimeConfig: {
            model: 'qwen3.6-plus',
            provider: 'qwen',
          },
        });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'qwen3.6-plus',
            provider: 'qwen',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        const result = await executors.call_llm!(instruction, state);

        expect(result.newState.messages.at(-1)).toEqual(
          expect.objectContaining({
            reasoning: { content: 'Need to inspect the search results first.' },
            role: 'assistant',
            tool_calls: [expect.objectContaining({ id: 'call_1' })],
          }),
        );
        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ preserveThinking: true }),
          expect.anything(),
        );
      });

      it('should persist reasoning to DB but not replay it when preserveThinking is not enabled', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onThinking?.('hidden reasoning');
          await options?.callback?.onText?.('answer');
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        const result = await executors.call_llm!(instruction, state);
        const assistant = result.newState.messages.at(-1) as any;

        expect(assistant.reasoning).toBeUndefined();
        // DB persistence must NOT be gated — UI shows reasoning after refresh
        expect(mockMessageModel.update).toHaveBeenCalledWith(
          'msg-123',
          expect.objectContaining({ reasoning: { content: 'hidden reasoning' } }),
        );
      });

      it('should replay assistant reasoning when preserveThinking is enabled on a supported model', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onThinking?.('preserved reasoning');
          await options?.callback?.onText?.('answer');
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            chatConfig: { preserveThinking: true },
            plugins: [],
            systemRole: 'test',
          },
        };

        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({
          modelRuntimeConfig: {
            model: 'qwen3.6-plus',
            provider: 'qwen',
          },
        });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'qwen3.6-plus',
            provider: 'qwen',
          },
          type: 'call_llm' as const,
        };

        const result = await executors.call_llm!(instruction, state);
        const assistant = result.newState.messages.at(-1) as any;

        expect(assistant.reasoning).toEqual({
          content: 'preserved reasoning',
        });
        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ preserveThinking: true }),
          expect.anything(),
        );
      });

      it('should replay reasoning for unknown custom deployments on supported providers', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onThinking?.('custom deployment reasoning');
          await options?.callback?.onText?.('answer');
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            chatConfig: { preserveThinking: true },
            plugins: [],
            systemRole: 'test',
          },
        };

        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({
          modelRuntimeConfig: {
            model: 'my-qwen-custom-deployment',
            provider: 'qwen',
          },
        });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'my-qwen-custom-deployment',
            provider: 'qwen',
          },
          type: 'call_llm' as const,
        };

        const result = await executors.call_llm!(instruction, state);
        const assistant = result.newState.messages.at(-1) as any;

        expect(assistant.reasoning).toEqual({
          content: 'custom deployment reasoning',
        });
        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ preserveThinking: true }),
          expect.anything(),
        );
      });

      it('should persist reasoning to DB but not replay it when model does not declare preserveThinking capability', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onThinking?.('reasoning on an unsupported model');
          await options?.callback?.onText?.('answer');
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            chatConfig: { preserveThinking: true },
            plugins: [],
            systemRole: 'test',
          },
        };

        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({
          modelRuntimeConfig: {
            model: 'gpt-4',
            provider: 'openai',
          },
        });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        const result = await executors.call_llm!(instruction, state);
        const assistant = result.newState.messages.at(-1) as any;

        expect(assistant.reasoning).toBeUndefined();
        expect(mockChat).toHaveBeenCalledWith(
          expect.not.objectContaining({ preserveThinking: expect.any(Boolean) }),
          expect.anything(),
        );
        // DB persistence must NOT be gated — UI shows reasoning after refresh
        expect(mockMessageModel.update).toHaveBeenCalledWith(
          'msg-123',
          expect.objectContaining({
            reasoning: { content: 'reasoning on an unsupported model' },
          }),
        );
      });
    });

    it('retries empty completions on the branded provider then throws ModelEmptyError', async () => {
      // A "gave up" turn: no onText / onThinking / onToolsCalling and ~0 output
      // tokens — mirrors the empty completion repro (provider=lobehub, `out=1 token`).
      // The branded provider has 0 general retries, but empty completions get a
      // dedicated budget so the request is still re-issued before failing.
      vi.useFakeTimers();
      try {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onCompletion?.({
            usage: { totalInputTokens: 100, totalOutputTokens: 1, totalTokens: 101 },
          });
          return new Response('done');
        });
        // initModelRuntimeFromDB resolves once before the retry loop; the same
        // empty mockChat is then re-invoked on every attempt.
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const promise = executors.call_llm!(
          {
            payload: {
              messages: [{ content: 'Hello', role: 'user' }],
              model: 'deepseek-v4-pro',
              provider: BRANDING_PROVIDER,
              tools: [],
            },
            type: 'call_llm' as const,
          },
          state,
        );
        // Drive the retry backoff sleeps to completion.
        const settled = expect(promise).rejects.toBeInstanceOf(ModelEmptyError);
        await vi.runAllTimersAsync();
        // Must throw (so the harness records a readable error state) instead of
        // silently finalizing to a completion with a blank assistant message.
        await settled;
        // EMPTY_COMPLETION_MAX_RETRIES (2) retries → 3 total attempts.
        expect(mockChat).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT treat a content-bearing completion as empty', async () => {
      // Empty output-token usage but real text content — a legitimate reply,
      // must not trip the empty-completion guard.
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('Here is your answer.');
        await options?.callback?.onCompletion?.({
          usage: { totalInputTokens: 10, totalOutputTokens: 0, totalTokens: 10 },
        });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const result = await executors.call_llm!(
        {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'deepseek-v4-pro',
            provider: 'lobehub',
            tools: [],
          },
          type: 'call_llm' as const,
        },
        state,
      );

      expect(result.newState.messages.at(-1)).toEqual(
        expect.objectContaining({ content: 'Here is your answer.', role: 'assistant' }),
      );
    });

    // Gemini 2.5+/3 thinking streams deliver assistant text/reasoning as
    // content_part / reasoning_part events instead of plain text / reasoning.
    // These must be captured or the turn finalizes to a blank `done`.
    describe('multimodal content_part / reasoning_part', () => {
      const geminiInstruction = (overrides?: any) => ({
        payload: {
          messages: [{ content: 'Hi', role: 'user' }],
          model: 'gemini-3.1-flash-lite-preview',
          provider: 'google',
          tools: [],
          ...overrides,
        },
        type: 'call_llm' as const,
      });

      it('captures assistant text delivered via content_part', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onContentPart?.({
            content: 'Hello from Gemini.',
            partType: 'text',
          });
          await options?.callback?.onCompletion?.({
            finishReason: 'STOP',
            usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
          });
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const executors = createRuntimeExecutors(ctx);
        const result = await executors.call_llm!(geminiInstruction(), createMockState());

        // Previously the text was dropped → persisted/state content was '' (blank done).
        expect(mockMessageModel.update).toHaveBeenCalledWith(
          'msg-123',
          expect.objectContaining({ content: 'Hello from Gemini.' }),
        );
        expect(result.newState.messages.at(-1)).toEqual(
          expect.objectContaining({ content: 'Hello from Gemini.', role: 'assistant' }),
        );
      });

      it('captures reasoning delivered via reasoning_part', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onReasoningPart?.({
            content: 'Let me think about this.',
            partType: 'text',
          });
          await options?.callback?.onContentPart?.({ content: 'The answer.', partType: 'text' });
          await options?.callback?.onCompletion?.({
            usage: { totalInputTokens: 10, totalOutputTokens: 8, totalTokens: 18 },
          });
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        // Reasoning is only replayed into state.messages when preserveThinking is
        // enabled on a supported model. Enable it here so this asserts
        // reasoning_part capture via the state replay path.
        const ctxWithThinking: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { chatConfig: { preserveThinking: true }, plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithThinking);
        const result = await executors.call_llm!(geminiInstruction(), createMockState());

        expect(result.newState.messages.at(-1)).toEqual(
          expect.objectContaining({
            content: 'The answer.',
            reasoning: { content: 'Let me think about this.' },
            role: 'assistant',
          }),
        );
      });

      it('coalesces consecutive content_part text chunks', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onContentPart?.({ content: 'Hello ', partType: 'text' });
          await options?.callback?.onContentPart?.({ content: 'world.', partType: 'text' });
          await options?.callback?.onCompletion?.({
            usage: { totalInputTokens: 10, totalOutputTokens: 4, totalTokens: 14 },
          });
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const executors = createRuntimeExecutors(ctx);
        const result = await executors.call_llm!(geminiInstruction(), createMockState());

        expect(result.newState.messages.at(-1)).toEqual(
          expect.objectContaining({ content: 'Hello world.', role: 'assistant' }),
        );
      });

      it('uploads content_part images to object storage and serializes URLs, never base64', async () => {
        mockUploadBase64.mockResolvedValue({
          fileId: 'file-1',
          key: 'files/generations/2026/abc.png',
          url: 'https://files.example/generations/abc.png',
        });

        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onContentPart?.({
            content: 'Here is an image:',
            partType: 'text',
          });
          await options?.callback?.onContentPart?.({
            content: 'BASE64IMAGEDATA',
            mimeType: 'image/png',
            partType: 'image',
          });
          await options?.callback?.onCompletion?.({
            usage: { totalInputTokens: 10, totalOutputTokens: 6, totalTokens: 16 },
          });
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const executors = createRuntimeExecutors(ctx);
        await executors.call_llm!(geminiInstruction(), createMockState());

        // Raw base64 is uploaded to storage, pathname carries the right extension.
        expect(mockUploadBase64).toHaveBeenCalledWith(
          'BASE64IMAGEDATA',
          expect.stringMatching(/generations\/.+\.png$/),
        );

        // Persisted content is serialized multimodal parts referencing the S3
        // URL — text + image in order — and never contains the raw base64.
        const updateCall = mockMessageModel.update.mock.calls.find(
          (c: any[]) => c[0] === 'msg-123' && typeof c[1]?.content === 'string',
        );
        expect(updateCall).toBeTruthy();
        expect(updateCall![1].metadata).toEqual(expect.objectContaining({ isMultimodal: true }));
        expect(updateCall![1].content).not.toContain('BASE64IMAGEDATA');
        expect(JSON.parse(updateCall![1].content)).toEqual([
          { text: 'Here is an image:', type: 'text' },
          { image: 'https://files.example/generations/abc.png', type: 'image' },
        ]);
      });
    });

    it('should push assistant message with persisted DB id so request_human_approve can find parent', async () => {
      const toolCallPayload = [
        {
          function: { arguments: '{}', name: 'search' },
          id: 'call_sensitive',
          type: 'function',
        },
      ];

      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onToolsCalling?.({ toolsCalling: toolCallPayload });
        await options?.callback?.onCompletion?.({
          usage: { totalInputTokens: 1, totalOutputTokens: 2, totalTokens: 3 },
        });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.create.mockResolvedValueOnce({ id: 'persisted-assistant-id' });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const result = await executors.call_llm!(
        {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        },
        state,
      );

      const lastAssistant = result.newState.messages.at(-1);
      expect(lastAssistant).toMatchObject({
        id: 'persisted-assistant-id',
        role: 'assistant',
      });
      // The id must match the same message that nextContext exposes as
      // parentMessageId, so request_human_approve sees a single source of truth.
      expect((result.nextContext?.payload as any).parentMessageId).toBe('persisted-assistant-id');
    });

    it('should execute compress_context and return compression_result', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        await options?.callback?.onCompletion?.({
          usage: {
            completionTokens: 5,
            promptTokens: 10,
            totalTokens: 15,
          },
        });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [
          { content: 'summary', id: 'group-123', role: 'compressedGroup' },
          { content: 'loading', id: 'assistant-existing', role: 'assistant' },
        ],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'x '.repeat(70000), role: 'user' }],
      });

      const instruction = createCompressContextInstruction([
        { content: 'x '.repeat(70000), role: 'user' },
      ]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).toHaveBeenCalledTimes(1);
      expect(mockFinalizeCompression).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(result.nextContext?.phase).toBe('compression_result');
      expect((result.nextContext?.payload as any).compressedMessages[0]).toEqual({
        content: 'summary',
        id: 'group-123',
        role: 'compressedGroup',
      });
      expect((result.nextContext?.payload as any).parentMessageId).toBe('assistant-existing');
      expect(result.events).toContainEqual({
        groupId: 'group-123',
        parentMessageId: 'assistant-existing',
        type: 'compression_complete',
      });
      expect(result.newState.usage.llm.tokens.total).toBe(15);
    });

    it('should skip compress_context when topic metadata is missing', async () => {
      const executors = createRuntimeExecutors({
        ...ctx,
      });
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
        metadata: {
          agentId: 'agent-123',
        },
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).not.toHaveBeenCalled();
      expect((result.nextContext?.payload as any).skipped).toBe(true);
    });

    it('should skip compress_context when userId is missing', async () => {
      const executors = createRuntimeExecutors({
        ...ctx,
        userId: undefined,
      });
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).not.toHaveBeenCalled();
      expect((result.nextContext?.payload as any).skipped).toBe(true);
    });

    it('should skip compress_context when there are no compressible messages after preserving the trailing user message', async () => {
      mockMessageModel.query.mockResolvedValue([]);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'continue with this exact instruction', role: 'user' }],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).not.toHaveBeenCalled();
      expect(result.nextContext?.payload as any).toMatchObject({
        compressedMessages: state.messages,
        groupId: '',
        parentMessageId: undefined,
        skipped: true,
      });
    });

    it('should report failed compression when compression model config is missing', async () => {
      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
        modelRuntimeConfig: undefined,
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).toHaveBeenCalledTimes(1);
      expect(mockFinalizeCompression).not.toHaveBeenCalled();
      expect(mockFailCompression).toHaveBeenCalledWith(
        'group-123',
        expect.objectContaining({ topicId: 'topic-123' }),
      );
      expect(mockCancelCompression).not.toHaveBeenCalled();
      expect(result.nextContext?.payload as any).toMatchObject({
        code: 'SUMMARY_FAILED',
        compressedMessages: [{ content: 'history', role: 'user' }],
        outcome: 'failed',
        parentMessageId: 'assistant-existing',
      });
    });

    it('should continue when compress_context fails', async () => {
      mockCreateCompressionGroup.mockRejectedValueOnce(new Error('compression failed'));

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
      ]);
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(result.nextContext?.phase).toBe('compression_result');
      expect(result.nextContext?.payload as any).toMatchObject({
        code: 'SUMMARY_FAILED',
        outcome: 'failed',
      });
      expect(mockFinalizeCompression).not.toHaveBeenCalled();
      expect(mockCancelCompression).not.toHaveBeenCalled();
      expect(mockFailCompression).not.toHaveBeenCalled();
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({ type: 'compression_error' });
    });

    it('should preserve the trailing user message outside compression', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [{ content: 'summary', id: 'group-123', role: 'compressedGroup' }],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [
          { content: 'history', id: 'msg-history', role: 'user' },
          { content: 'continue with this exact instruction', role: 'user' },
        ],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).toHaveBeenCalledWith(
        'topic-123',
        ['msg-history', 'assistant-existing'],
        expect.any(Object),
      );
      expect((result.nextContext?.payload as any).compressedMessages).toEqual([
        { content: 'summary', id: 'group-123', role: 'compressedGroup' },
        { content: 'continue with this exact instruction', role: 'user' },
      ]);
    });

    it('should fallback to messagesToSummarize when finalizeCompression does not return messages', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: undefined,
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect((result.nextContext?.payload as any).compressedMessages).toEqual([
        { content: 'history', id: 'msg-history', role: 'user' },
      ]);
    });

    it('should not duplicate the preserved trailing user message when it is already present in finalized messages', async () => {
      const preservedMessage = {
        content: 'continue with this exact instruction',
        id: 'msg-follow-up',
        role: 'user',
      };

      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
        preservedMessage,
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [
          { content: 'summary', id: 'group-123', role: 'compressedGroup' },
          preservedMessage,
        ],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', id: 'msg-history', role: 'user' }, preservedMessage],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect((result.nextContext?.payload as any).compressedMessages).toEqual([
        { content: 'summary', id: 'group-123', role: 'compressedGroup' },
        preservedMessage,
      ]);
    });

    it('should report failed compression when the compression model reports a summary error', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onError?.({ message: 'summary failed' });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect(mockFinalizeCompression).not.toHaveBeenCalled();
      expect(mockFailCompression).toHaveBeenCalledWith(
        'group-123',
        expect.objectContaining({ topicId: 'topic-123' }),
      );
      expect(mockCancelCompression).not.toHaveBeenCalled();
      expect(result.nextContext?.payload as any).toMatchObject({
        code: 'SUMMARY_FAILED',
        outcome: 'failed',
      });
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'compression_error',
        }),
      );
    });

    describe('assistantMessageId reuse', () => {
      it('should reuse existing assistant message when assistantMessageId is provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const existingAssistantId = 'existing-assistant-msg-123';
        const instruction = {
          payload: {
            assistantMessageId: existingAssistantId,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            parentMessageId: 'parent-msg-123',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should NOT create a new assistant message
        expect(mockMessageModel.create).not.toHaveBeenCalled();

        // Should publish stream_start event with existing assistant message ID
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            data: expect.objectContaining({
              assistantMessage: { id: existingAssistantId },
            }),
            type: 'stream_start',
          }),
        );
      });

      it('should create new assistant message when assistantMessageId is not provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            parentMessageId: 'parent-msg-123',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should create a new assistant message
        expect(mockMessageModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: 'agent-123',
            content: '',
            model: 'gpt-4',
            parentId: 'parent-msg-123',
            provider: 'openai',
            role: 'assistant',
          }),
        );

        // Should publish stream_start event with newly created message ID
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            data: expect.objectContaining({
              assistantMessage: { id: 'msg-123' },
            }),
            type: 'stream_start',
          }),
        );
      });

      it('should use existing assistantMessageId even when parentMessageId is also provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const existingAssistantId = 'pre-created-assistant-456';
        const instruction = {
          payload: {
            assistantMessageId: existingAssistantId,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            parentId: 'parent-id-789',
            parentMessageId: 'parent-msg-789',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should NOT create a new message
        expect(mockMessageModel.create).not.toHaveBeenCalled();

        // Stream event should reference the existing message
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            data: expect.objectContaining({
              assistantMessage: { id: existingAssistantId },
            }),
            type: 'stream_start',
          }),
        );
      });

      it('should create new message when assistantMessageId is undefined', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            assistantMessageId: undefined,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should create a new assistant message
        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
      });

      it('should create new message when assistantMessageId is empty string', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            assistantMessageId: '',
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Empty string is falsy, so should create new message
        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('forceFinish behavior', () => {
      let mockChat: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        mockChat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
          await options?.callback?.onText?.('done');
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
      });

      it('should strip tools when state.forceFinish is true', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState({ forceFinish: true });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [{ description: 'Search the web', name: 'search' }],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools: undefined }),
          expect.anything(),
        );
      });

      it('should pass tools normally when state.forceFinish is not set', async () => {
        const executors = createRuntimeExecutors(ctx);
        const tools = [
          {
            function: { description: 'Search the web', name: 'search' },
            type: 'function' as const,
          },
        ];
        const state = createMockState({ tools: tools as any });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools }),
          expect.anything(),
        );
      });

      it('should fallback to state.tools when payload.tools is not provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const stateTools = [
          {
            function: { description: 'State tool', name: 'state-tool' },
            type: 'function' as const,
          },
        ];
        const state = createMockState({ tools: stateTools as any });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools: stateTools }),
          expect.anything(),
        );
      });

      it('should strip state.tools too when forceFinish is true', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState({
          forceFinish: true,
          tools: [
            {
              function: { description: 'State tool', name: 'state-tool' },
              type: 'function' as const,
            },
          ] as any,
        });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools: undefined }),
          expect.anything(),
        );
      });
    });

    describe('serverMessagesEngine integration', () => {
      let mockChat: ReturnType<typeof vi.fn>;

      let engineSpy: any;

      beforeEach(() => {
        mockChat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
          await options?.callback?.onText?.('done');
          return new Response('done');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
        engineSpy = vi.spyOn(ContextEngineering, 'serverMessagesEngine');
      });

      afterEach(() => {
        engineSpy.mockRestore();
      });

      it('should process messages through serverMessagesEngine when agentConfig is set', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            plugins: [],
            systemRole: 'You are a helpful assistant',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [
              { id: 'persisted-user', metadata: { pinned: true }, content: 'Hello', role: 'user' },
            ],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Real serverMessagesEngine should have been called
        expect(engineSpy).toHaveBeenCalledTimes(1);
        expect(engineSpy).toHaveBeenCalledWith(
          expect.objectContaining({ preserveMessageIdentity: true }),
        );

        // Verify the engine actually processed messages:
        // system role should be injected as the first message
        const chatMessages = mockChat.mock.calls[0][0].messages;
        for (const message of chatMessages) {
          expect(message).not.toHaveProperty('id');
          expect(message).not.toHaveProperty('metadata');
        }
        expect(chatMessages[0]).toEqual(
          expect.objectContaining({
            content: expect.stringContaining('You are a helpful assistant'),
            role: 'system',
          }),
        );
        // Original user message should be preserved
        expect(chatMessages.at(-1)).toEqual(
          expect.objectContaining({ content: 'Hello', role: 'user' }),
        );
      });

      it('should inline private file image URLs before provider call', async () => {
        mockFindFileById.mockResolvedValue({
          fileType: 'image/png',
          id: 'file-local',
          url: 'files/user-123/local.png',
        });
        mockGetFileByteArray.mockResolvedValue(new Uint8Array([1, 2, 3]));

        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            plugins: [],
            systemRole: 'test',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        await executors.call_llm!(
          {
            payload: {
              messages: [
                {
                  content: 'What is in this image?',
                  imageList: [
                    {
                      alt: 'local.png',
                      id: 'file-local',
                      url: 'http://localhost:3210/f/file-local',
                    },
                  ],
                  role: 'user',
                },
              ],
              model: 'gpt-4',
              provider: 'openai',
            },
            type: 'call_llm' as const,
          },
          state,
        );

        const engineInput = engineSpy.mock.calls[0][0];
        expect(engineInput.messages[0].imageList[0].url).toBe('http://localhost:3210/f/file-local');

        const chatMessages = mockChat.mock.calls[0][0].messages;
        const userMessage = chatMessages.find((message: any) => message.role === 'user');
        const imagePart = userMessage.content.find((part: any) => part.type === 'image_url');
        expect(imagePart.image_url.url).toBe('data:image/png;base64,AQID');
        expect(mockFindFileById).toHaveBeenCalledWith('file-local');
        expect(mockGetFileByteArray).toHaveBeenCalledWith('files/user-123/local.png');
      });

      it('should keep current turn when agent historyCount is 0', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            chatConfig: { enableHistoryCount: true, historyCount: 0 },
            plugins: [],
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [
              { content: 'History message', id: 'history-1', role: 'user' },
              { content: 'History response', id: 'history-2', role: 'assistant' },
              { content: 'Current message', id: 'current-1', role: 'user' },
            ],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledWith(expect.objectContaining({ historyCount: 1 }));

        const chatMessages = mockChat.mock.calls[0][0].messages;
        expect(chatMessages).toContainEqual(
          expect.objectContaining({ content: 'Current message', role: 'user' }),
        );
        expect(chatMessages).not.toContainEqual(
          expect.objectContaining({ content: 'History message', role: 'user' }),
        );
        expect(chatMessages).not.toContainEqual(
          expect.objectContaining({ content: 'History response', role: 'assistant' }),
        );
      });

      it('should strip stored assistant reasoning before context processing when replay gate is off', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            plugins: [],
            systemRole: 'test',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();
        const messages = [
          {
            content: 'Previous answer',
            reasoning: { content: 'stored reasoning should stay display-only' },
            role: 'assistant',
          },
          { content: 'Continue', role: 'user' },
        ];

        await executors.call_llm!(
          {
            payload: {
              messages,
              model: 'gpt-4',
              provider: 'openai',
            },
            type: 'call_llm' as const,
          },
          state,
        );

        const engineInput = engineSpy.mock.calls[0][0];
        expect(engineInput.messages[0]).toEqual({
          content: 'Previous answer',
          role: 'assistant',
        });
        expect(messages[0]).toEqual(
          expect.objectContaining({
            reasoning: { content: 'stored reasoning should stay display-only' },
          }),
        );
      });

      it('should strip stored reasoning from grouped assistant messages before context processing when replay gate is off', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            plugins: [],
            systemRole: 'test',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();
        const groupedChild = {
          content: 'Grouped answer',
          id: 'group-child-1',
          reasoning: { content: 'grouped child reasoning should stay display-only' },
          role: 'assistant',
        };
        const councilMember = {
          content: 'Council member answer',
          id: 'member-1',
          reasoning: { content: 'member reasoning should stay display-only' },
          role: 'assistant',
        };
        const nestedCouncilChild = {
          content: 'Nested council answer',
          id: 'member-child-1',
          reasoning: { content: 'nested member reasoning should stay display-only' },
          role: 'assistant',
        };
        const messages = [
          {
            children: [groupedChild],
            content: '',
            id: 'group-1',
            role: 'assistantGroup',
          },
          {
            content: '',
            id: 'council-1',
            members: [
              councilMember,
              {
                children: [nestedCouncilChild],
                content: '',
                id: 'member-group-1',
                role: 'assistantGroup',
              },
            ],
            role: 'agentCouncil',
          },
          { content: 'Continue', role: 'user' },
        ];

        await executors.call_llm!(
          {
            payload: {
              messages,
              model: 'gpt-4',
              provider: 'openai',
            },
            type: 'call_llm' as const,
          },
          state,
        );

        const engineInput = engineSpy.mock.calls[0][0];
        expect(engineInput.messages[0].children[0]).not.toHaveProperty('reasoning');
        expect(engineInput.messages[1].members[0]).not.toHaveProperty('reasoning');
        expect(engineInput.messages[1].members[1].children[0]).not.toHaveProperty('reasoning');
        expect(groupedChild).toHaveProperty('reasoning');
        expect(councilMember).toHaveProperty('reasoning');
        expect(nestedCouncilChild).toHaveProperty('reasoning');
      });

      it('should keep stored assistant reasoning before context processing when replay gate is enabled', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            chatConfig: { preserveThinking: true },
            plugins: [],
            systemRole: 'test',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({
          modelRuntimeConfig: {
            model: 'qwen3.6-plus',
            provider: 'qwen',
          },
        });

        await executors.call_llm!(
          {
            payload: {
              messages: [
                {
                  content: 'Previous answer',
                  reasoning: { content: 'reasoning to replay' },
                  role: 'assistant',
                },
                { content: 'Continue', role: 'user' },
              ],
              model: 'qwen3.6-plus',
              provider: 'qwen',
            },
            type: 'call_llm' as const,
          },
          state,
        );

        const engineInput = engineSpy.mock.calls[0][0];
        expect(engineInput.messages[0]).toEqual(
          expect.objectContaining({
            content: 'Previous answer',
            reasoning: { content: 'reasoning to replay' },
            role: 'assistant',
          }),
        );
      });

      it('should not call serverMessagesEngine when agentConfig is not set', async () => {
        const executors = createRuntimeExecutors(ctx); // ctx without agentConfig
        const state = createMockState();

        const rawMessages = [{ content: 'Hello', role: 'user' }];
        const instruction = {
          payload: {
            messages: rawMessages,
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).not.toHaveBeenCalled();

        // Raw messages should be passed directly to chat
        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ messages: rawMessages }),
          expect.anything(),
        );
      });

      it('should pass forceFinish flag to serverMessagesEngine and inject summary', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({ forceFinish: true });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // forceFinish should be passed to the engine
        expect(engineSpy).toHaveBeenCalledWith(expect.objectContaining({ forceFinish: true }));

        // The engine's ForceFinishSummaryInjector should inject a summary system message
        const chatMessages = mockChat.mock.calls[0][0].messages;
        const hasForceFinishMessage = chatMessages.some(
          (m: any) =>
            m.role === 'system' &&
            m.content.includes('maximum step limit') &&
            m.content.includes('Do not attempt to use any tools'),
        );
        expect(hasForceFinishMessage).toBe(true);
      });

      it('should pass evalContext to serverMessagesEngine', async () => {
        const evalContext = { expectedOutput: 'test answer', evalMode: true };
        const ctxWithEval: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
          evalContext: evalContext as any,
        };
        const executors = createRuntimeExecutors(ctxWithEval);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledWith(expect.objectContaining({ evalContext }));
      });

      it('should inject current agent identity for bot-originated runs', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            description: 'Answers customer support questions.',
            plugins: [],
            systemRole: 'test',
            title: 'Support Bot',
          },
          botContext: {
            applicationId: 'discord-app',
            isOwner: true,
            platform: 'discord',
            platformThreadId: 'discord:channel-1',
            senderExternalUserId: 'user-platform-id',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({
          metadata: {
            agentId: 'agent-support',
            botContext: ctxWithConfig.botContext,
            topicId: 'topic-123',
          },
        });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            agentGroup: {
              agentMap: {
                'agent-support': {
                  name: 'Support Bot',
                  role: 'participant',
                },
              },
              currentAgentId: 'agent-support',
              currentAgentName: 'Support Bot',
              currentAgentRole: 'participant',
              members: [
                {
                  id: 'agent-support',
                  name: 'Support Bot',
                  role: 'participant',
                },
              ],
              systemPrompt: 'Answers customer support questions.',
            },
          }),
        );
      });

      it('should build capabilities from LOBE_DEFAULT_MODEL_LIST', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        const callArgs = engineSpy.mock.calls[0][0];

        // gpt-4/openai is in mock list with functionCall: true, vision: true, video: false
        expect(callArgs.capabilities.isCanUseFC('gpt-4', 'openai')).toBe(true);
        expect(callArgs.capabilities.isCanUseVision('gpt-4', 'openai')).toBe(true);
        expect(callArgs.capabilities.isCanUseVideo('gpt-4', 'openai')).toBe(false);

        // no-tools-model has all abilities set to false
        expect(callArgs.capabilities.isCanUseFC('no-tools-model', 'test-provider')).toBe(false);
        expect(callArgs.capabilities.isCanUseVision('no-tools-model', 'test-provider')).toBe(false);
        expect(callArgs.capabilities.isCanUseVideo('no-tools-model', 'test-provider')).toBe(false);

        // Unknown model defaults: functionCall=true, vision=false, video=false
        expect(callArgs.capabilities.isCanUseFC('unknown', 'unknown')).toBe(true);
        expect(callArgs.capabilities.isCanUseVision('unknown', 'unknown')).toBe(false);
        expect(callArgs.capabilities.isCanUseVideo('unknown', 'unknown')).toBe(false);

        // Aggregator (e.g. lobehub) routes a known model id under a different
        // provider — visual capability flags fall back to the upstream model card.
        expect(callArgs.capabilities.isCanUseVision('gpt-4', 'lobehub')).toBe(true);
        expect(
          callArgs.capabilities.isCanUseVideo('gemini-3.1-flash-lite-preview', 'lobehub'),
        ).toBe(true);
        expect(callArgs.capabilities.isCanUseVision('no-tools-model', 'lobehub')).toBe(false);
      });

      it('should filter disabled files and knowledgeBases from agentConfig', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            files: [
              { content: 'yes', enabled: true, id: 'f1', name: 'enabled.pdf' },
              { content: 'no', enabled: false, id: 'f2', name: 'disabled.pdf' },
              { content: 'maybe', enabled: null, id: 'f3', name: 'null.pdf' },
            ],
            knowledgeBases: [
              { enabled: true, id: 'kb1', name: 'Enabled KB' },
              { enabled: false, id: 'kb2', name: 'Disabled KB' },
            ],
            plugins: [],
            systemRole: 'test',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        const callArgs = engineSpy.mock.calls[0][0];

        // Only enabled files should be included (enabled === true)
        expect(callArgs.knowledge.fileContents).toHaveLength(1);
        expect(callArgs.knowledge.fileContents[0]).toEqual({
          content: 'yes',
          fileId: 'f1',
          filename: 'enabled.pdf',
        });

        // Only enabled knowledge bases
        expect(callArgs.knowledge.knowledgeBases).toHaveLength(1);
        expect(callArgs.knowledge.knowledgeBases[0]).toEqual({
          id: 'kb1',
          name: 'Enabled KB',
        });
      });

      it('should skip topic reference resolution when messages already contain topic_reference_context', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [
              {
                content:
                  '<refer_topic name="Old topic" id="topic-abc" />\nHello\n<system_context>\n<context type="topic_reference_context">\n<referred_topics>...</referred_topics>\n</context>\n</system_context>',
                role: 'user',
              },
            ],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledTimes(1);
        const callArgs = engineSpy.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('topicReferences');
      });

      it('should resolve topic references when messages do not contain topic_reference_context', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Just a normal message without any topic refs', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledTimes(1);
        // resolveTopicReferences ran but found no <refer_topic> tags → topicReferences is undefined
        const callArgs = engineSpy.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('topicReferences');
      });

      it('should skip rebuilding onboarding context when messages already contain onboarding injection', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            plugins: ['lobe-web-onboarding'],
            slug: 'web-onboarding',
            systemRole: 'test',
          } as any,
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [
              {
                content:
                  '<onboarding_context>\n<phase>existing</phase>\n</onboarding_context>\nHello',
                role: 'user',
              },
            ],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledTimes(1);
        const callArgs = engineSpy.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('onboardingContext');
      });
    });

    // Cancel/interrupt mid-stream — the model-runtime call is
    // aborted before the post-stream finalize at line 1078, so the DB row
    // would normally stay at LOADING_FLAT placeholder. The executor's
    // inner catch must persist whatever partial content the streaming
    // callbacks already accumulated so (a) reload doesn't lose the user's
    // streamed answer and (b) any later uiMessages snapshot reflects real
    // content instead of placeholder.
    describe('interrupted mid-stream partial finalize', () => {
      it('persists accumulated content + reasoning when stream throws and operation is interrupted', async () => {
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onText?.('Hello, this is a partial ');
          await options?.callback?.onText?.('streamed answer.');
          await options?.callback?.onThinking?.('Let me think step by step. ');
          await options?.callback?.onThinking?.('First, consider the context.');
          throw new Error('AbortError: stream aborted');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        // Make isOperationInterrupted return true so the catch hits the
        // partial-finalize branch instead of the retry path.
        const interruptedCtx: RuntimeExecutorContext = {
          ...ctx,
          loadAgentState: vi.fn().mockResolvedValue({ status: 'interrupted' }),
        };
        mockMessageModel.create.mockResolvedValueOnce({ id: 'asst-interrupted' });

        const executors = createRuntimeExecutors(interruptedCtx);
        const state = createMockState();

        await expect(
          executors.call_llm!(
            {
              payload: {
                messages: [{ content: 'Hi', role: 'user' }],
                model: 'gpt-4',
                provider: 'openai',
                tools: [],
              },
              type: 'call_llm' as const,
            },
            state,
          ),
        ).rejects.toThrow();

        // The success-path update at line 1078 is unreachable when the
        // stream throws — only the cancel-path partial-finalize remains.
        expect(mockMessageModel.update).toHaveBeenCalledWith(
          'asst-interrupted',
          expect.objectContaining({
            content: 'Hello, this is a partial streamed answer.',
            reasoning: { content: 'Let me think step by step. First, consider the context.' },
            metadata: expect.objectContaining({ interruptedMidStream: true }),
          }),
        );
      });

      it('does NOT persist when interrupted but no content was streamed (avoid empty-content noise)', async () => {
        const mockChat = vi.fn().mockImplementation(async () => {
          throw new Error('AbortError: stream aborted before any chunks');
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

        const interruptedCtx: RuntimeExecutorContext = {
          ...ctx,
          loadAgentState: vi.fn().mockResolvedValue({ status: 'interrupted' }),
        };
        mockMessageModel.create.mockResolvedValueOnce({ id: 'asst-empty-interrupt' });

        const executors = createRuntimeExecutors(interruptedCtx);
        const state = createMockState();

        await expect(
          executors.call_llm!(
            {
              payload: {
                messages: [{ content: 'Hi', role: 'user' }],
                model: 'gpt-4',
                provider: 'openai',
                tools: [],
              },
              type: 'call_llm' as const,
            },
            state,
          ),
        ).rejects.toThrow();

        // No content / reasoning / tools accumulated — skip the update so
        // we don't overwrite the placeholder with another empty record
        // (and don't bump `updated_at` for no functional reason).
        expect(mockMessageModel.update).not.toHaveBeenCalled();
      });

      it('does NOT persist partial content on non-interrupt errors (preserves existing retry/error flow)', async () => {
        // Use a stop-classified error (status 400) so the retry loop exits
        // immediately and the test doesn't burn the timeout on backoff sleeps.
        const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onText?.('Partial before crash');
          const err: any = new Error('invalid_request_error: bad input');
          err.errorType = 'ProviderBizError';
          err.status = 400;
          throw err;
        });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

        // loadAgentState returns running — not interrupted — so the partial-
        // finalize branch should be skipped even with accumulated content.
        const runningCtx: RuntimeExecutorContext = {
          ...ctx,
          loadAgentState: vi.fn().mockResolvedValue({ status: 'running' }),
        };
        mockMessageModel.create.mockResolvedValueOnce({ id: 'asst-error' });

        const executors = createRuntimeExecutors(runningCtx);
        const state = createMockState();

        await expect(
          executors.call_llm!(
            {
              payload: {
                messages: [{ content: 'Hi', role: 'user' }],
                model: 'gpt-4',
                provider: 'openai',
                tools: [],
              },
              type: 'call_llm' as const,
            },
            state,
          ),
        ).rejects.toThrow();

        expect(mockMessageModel.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('call_tool executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    it('should pass parentId (parentMessageId) to messageModel.create for tool message', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'assistant-msg-123',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        }),
      );
    });

    it('creates and binds scratch only when an unbound tool first needs cwd', async () => {
      const ensureScratchWorkspace = vi
        .fn()
        .mockResolvedValue({ root: '/tmp/masterino/topic-123' });
      const bindScratchAfterToolSuccess = vi.fn().mockResolvedValue({
        snapshot: {
          boundDeviceId: 'device-a',
          target: 'local',
          targetCapturedAt: '2026-09-04T00:00:00.000Z',
          version: 1,
          workspaceBoundAt: '2026-09-04T00:00:01.000Z',
          workspaceId: 'scratch-workspace',
          workspaceKind: 'scratch',
        },
        workspace: {
          deviceId: 'device-a',
          id: 'scratch-workspace',
          kind: 'scratch',
          rootPath: '/tmp/masterino/topic-123',
        },
      });
      const executors = createRuntimeExecutors({
        ...ctx,
        bindScratchAfterToolSuccess,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });
      const state = createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [],
            plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            unresolvedReason: 'no-workspace',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const result = await executors.call_tool!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolCalling: {
              apiName: 'listFiles',
              arguments: '{}',
              id: 'tool-call-scratch',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          },
          type: 'call_tool' as const,
        },
        state,
      );

      expect(ensureScratchWorkspace).toHaveBeenCalledOnce();
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          executionContext: expect.objectContaining({
            cwd: '/tmp/masterino/topic-123',
            workspace: expect.objectContaining({ kind: 'scratch' }),
          }),
        }),
      );
      expect(bindScratchAfterToolSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPath: '/tmp/masterino/topic-123',
          toolSucceeded: true,
          topicId: 'topic-123',
        }),
      );
      expect(result.newState.metadata?.executionContext).toMatchObject({
        cwd: '/tmp/masterino/topic-123',
        snapshot: { workspaceId: 'scratch-workspace' },
        workspace: { id: 'scratch-workspace', kind: 'scratch' },
      });
    });

    it.each(['call_tool', 'call_tools_batch'] as const)(
      'records activated Skill keys from operation metadata in %s',
      async (mode) => {
        const key = 'project:workspace-a:report';
        const state = createMockState({
          metadata: {
            operationSkillSet: {
              enabledPluginIds: [],
              skills: [
                {
                  key,
                  identifier: 'report',
                  name: 'report',
                  description: 'Report',
                  source: 'project',
                },
              ],
            },
          },
        });
        mockToolExecutionService.executeTool.mockResolvedValue({
          content: 'Pinned instructions',
          state: { id: key },
          success: true,
          executionTime: 1,
        });
        const executors = createRuntimeExecutors(ctx);
        const tool = {
          apiName: 'activateSkill',
          arguments: '{"name":"report"}',
          id: 'activate-report',
          identifier: 'lobe-skills',
          type: 'builtin' as const,
        };
        const result =
          mode === 'call_tool'
            ? await executors.call_tool!(
                {
                  type: mode,
                  payload: { parentMessageId: 'assistant-msg-123', toolCalling: tool },
                },
                state,
              )
            : await executors.call_tools_batch!(
                {
                  type: mode,
                  payload: { parentMessageId: 'assistant-msg-123', toolsCalling: [tool] },
                },
                state,
              );
        expect(result.newState.activatedStepSkills).toEqual([
          {
            key,
            identifier: 'report',
            content: 'Pinned instructions',
            activatedAtStep: state.stepCount,
          },
        ]);
      },
    );

    it.each(['call_tool', 'call_tools_batch'] as const)(
      'does not bind a late successful scratch result after cancellation in %s',
      async (mode) => {
        const bindScratchAfterToolSuccess = vi.fn();
        const executors = createRuntimeExecutors({
          ...ctx,
          bindScratchAfterToolSuccess,
          ensureScratchWorkspace: vi.fn().mockResolvedValue({ root: '/scratch/topic-123' }),
          loadAgentState: vi.fn().mockResolvedValue({ status: 'interrupted' }),
          topicId: 'topic-123',
        });
        const state = createMockState({
          metadata: {
            agentId: 'agent-123',
            topicId: 'topic-123',
            activeDeviceId: 'device-a',
            executionContext: {
              accessRoots: [],
              version: 1,
              unresolvedReason: 'no-workspace',
              plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            },
          },
        });
        const tool = {
          apiName: 'listFiles',
          arguments: '{}',
          id: 'cancelled-tool',
          identifier: 'lobe-local-system',
          type: 'builtin' as const,
        };
        const instruction =
          mode === 'call_tool'
            ? { type: mode, payload: { parentMessageId: 'assistant-msg-123', toolCalling: tool } }
            : {
                type: mode,
                payload: { parentMessageId: 'assistant-msg-123', toolsCalling: [tool] },
              };
        const result = await executors[mode]!(instruction as any, state);
        expect(mockToolExecutionService.executeTool).toHaveBeenCalledOnce();
        expect(bindScratchAfterToolSuccess).not.toHaveBeenCalled();
        expect(result.newState.metadata?.executionContext?.workspace).toBeUndefined();
      },
    );

    it('keeps a successful scratch tool result when a concurrent formal bind wins the CAS', async () => {
      const ensureScratchWorkspace = vi
        .fn()
        .mockResolvedValue({ root: '/tmp/masterino/topic-123' });
      const bindScratchAfterToolSuccess = vi.fn().mockResolvedValue({
        snapshot: {
          boundDeviceId: 'device-a',
          target: 'local',
          targetCapturedAt: '2026-09-04T00:00:00.000Z',
          version: 1,
          workspaceBoundAt: '2026-09-04T00:00:01.000Z',
          workspaceId: 'formal-workspace',
          workspaceKind: 'device',
        },
        workspace: {
          deviceId: 'device-a',
          id: 'formal-workspace',
          kind: 'device',
          rootPath: '/Users/me/formal-project',
        },
      });
      const executors = createRuntimeExecutors({
        ...ctx,
        bindScratchAfterToolSuccess,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });
      const state = createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [],
            plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            unresolvedReason: 'no-workspace',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const result = await executors.call_tool!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolCalling: {
              apiName: 'listFiles',
              arguments: '{}',
              id: 'tool-call-cas-race',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          },
          type: 'call_tool' as const,
        },
        state,
      );

      expect(bindScratchAfterToolSuccess).toHaveBeenCalledOnce();
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledOnce();
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Tool result', tool_call_id: 'tool-call-cas-race' }),
      );
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            result: expect.objectContaining({ content: 'Tool result', success: true }),
            type: 'tool_result',
          }),
        ]),
      );
      // The delegate resolved the winner and handed it back, so this is a
      // recoverable race: adopt the authoritative workspace and keep running.
      expect(result.newState.metadata?.executionContext).toMatchObject({
        cwd: '/Users/me/formal-project',
        plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
        snapshot: { workspaceId: 'formal-workspace', workspaceKind: 'device' },
        workspace: { id: 'formal-workspace', kind: 'device' },
      });
      expect(result.newState.status).not.toBe('interrupted');
      expect(result.nextContext).toBeDefined();
    });

    const unboundExecutionContext = {
      accessRoots: [],
      plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
      unresolvedReason: 'no-workspace',
      version: 1,
    };
    const createUnboundScratchState = () =>
      createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          executionContext: unboundExecutionContext,
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

    // The production delegate already absorbs a lost race itself: it catches
    // WorkspaceAlreadyBoundError, resolves the winning binding and returns it
    // (see AiAgentService#bindScratchAfterToolSuccess, exercised by the CAS
    // test above). A rejection therefore always means no authoritative
    // workspace could be resolved — including one that still carries
    // WORKSPACE_ALREADY_BOUND, which must not be read as a harmless race.
    it.each<[string, Error]>([
      ['the concurrent winner cannot be resolved', new Error('WORKSPACE_ALREADY_BOUND')],
      ['the bind query fails', new Error('Failed query: update "topics" set "metadata" = $1')],
    ])('keeps the successful tool result and interrupts when %s', async (_case, bindError) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ensureScratchWorkspace = vi
        .fn()
        .mockResolvedValue({ root: '/tmp/masterino/topic-123' });
      const bindScratchAfterToolSuccess = vi.fn().mockRejectedValue(bindError);
      const executors = createRuntimeExecutors({
        ...ctx,
        bindScratchAfterToolSuccess,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });

      const result = await executors.call_tool!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolCalling: {
              apiName: 'listFiles',
              arguments: '{}',
              id: 'tool-call-bind-failure',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          },
          type: 'call_tool' as const,
        },
        createUnboundScratchState(),
      );

      // The tool ran exactly once and its result is persisted and reported.
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledOnce();
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Tool result', tool_call_id: 'tool-call-bind-failure' }),
      );
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            result: expect.objectContaining({ content: 'Tool result', success: true }),
            type: 'tool_result',
          }),
        ]),
      );

      // The run stops in a resumable interruption carrying a stable code, so
      // nothing else is queued against a topic that nothing ever bound.
      expect(result.newState.status).toBe('interrupted');
      expect(result.newState.interruption).toMatchObject({
        canResume: true,
        reason: 'WORKSPACE_BIND_FAILED',
      });
      expect(result.nextContext).toBeUndefined();
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'WORKSPACE_BIND_FAILED', type: 'interrupted' }),
        ]),
      );

      // Never reported as an error: clients read `error` events as a failed
      // tool call, and this tool did not fail.
      expect(result.events.some((event: any) => event.type === 'error')).toBe(false);
      expect(
        mockStreamManager.publishStreamEvent.mock.calls.filter(
          ([, event]: [string, any]) => event.type === 'error',
        ),
      ).toHaveLength(0);

      // Nothing bound the scratch root, so the execution context stays the last
      // persisted one instead of claiming a workspace the topic is not bound to.
      expect(result.newState.metadata?.executionContext).toEqual(unboundExecutionContext);

      // The raw failure reaches the server log only — never the persisted state
      // or the events, neither as a driver message nor as a scratch path.
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), bindError);
      const exposed = serializeForSecretScan({ events: result.events, state: result.newState });
      expect(exposed).not.toContain(bindError.message);
      expect(exposed).not.toContain('/tmp/masterino/topic-123');

      consoleError.mockRestore();
    });

    it('uses the server-to-device transport for frozen local-system env authority', async () => {
      mockStreamManager.sendToolExecute = vi.fn();
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          activeDeviceId: 'stale-device',
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [
              {
                deviceId: 'device-a',
                modes: ['exec'],
                rootPath: '/Users/me/project',
                scope: 'primary',
                source: 'workspace',
              },
            ],
            cwd: '/Users/me/project',
            env: {
              secretKeys: ['TOKEN'],
              sources: { TOKEN: 'workspace' },
              values: { TOKEN: 'server-resolved-secret' },
            },
            envFiles: ['.env'],
            plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            version: 1,
            workspace: {
              deviceId: 'device-a',
              id: 'workspace-a',
              kind: 'device',
              rootPath: '/Users/me/project',
            },
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      await executors.call_tool!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolCalling: {
              apiName: 'runCommand',
              arguments: '{"command":"printenv TOKEN"}',
              executor: 'client',
              id: 'tool-call-env',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          },
          type: 'call_tool' as const,
        },
        state,
      );

      expect(mockStreamManager.sendToolExecute).not.toHaveBeenCalled();
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tool-call-env' }),
        expect.objectContaining({
          activeDeviceId: 'device-a',
          executionContext: expect.objectContaining({
            env: expect.objectContaining({ values: { TOKEN: 'server-resolved-secret' } }),
            envFiles: ['.env'],
          }),
        }),
      );
    });

    it('does not use the renderer tool channel when a local device is unrouted', async () => {
      mockStreamManager.sendToolExecute = vi.fn();
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [
              {
                modes: ['read'],
                operationId: 'op-123',
                rootPath: '/outside/docs',
                scope: 'operation',
                source: 'direct-user-message',
                topicId: 'topic-123',
              },
            ],
            plan: { kind: 'device-unrouted', target: 'local' },
            unresolvedReason: 'device-offline',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      await executors.call_tool!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolCalling: {
              apiName: 'readFile',
              arguments: '{"path":"/outside/docs/report.md"}',
              executor: 'client',
              id: 'tool-call-unrouted',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          },
          type: 'call_tool' as const,
        },
        state,
      );

      expect(mockStreamManager.sendToolExecute).not.toHaveBeenCalled();
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tool-call-unrouted' }),
        expect.objectContaining({ activeDeviceId: undefined }),
      );
    });

    it('does not create scratch for an explicit absolute-path operation', async () => {
      const ensureScratchWorkspace = vi.fn();
      const executors = createRuntimeExecutors({
        ...ctx,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });
      const state = createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [
              {
                deviceId: 'device-a',
                modes: ['read'],
                operationId: 'op-123',
                rootPath: '/outside/docs',
                scope: 'operation',
                source: 'user-approval',
              },
            ],
            plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            unresolvedReason: 'no-workspace',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      await executors.call_tool!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolCalling: {
              apiName: 'readFile',
              arguments: '{"path":"/outside/docs/report.md"}',
              id: 'tool-call-absolute',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          },
          type: 'call_tool' as const,
        },
        state,
      );

      expect(ensureScratchWorkspace).not.toHaveBeenCalled();
    });

    it('parks a device-authored path intervention instead of feeding it back to the LLM', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'INTERVENTION_REQUIRED',
        error: { kind: 'stop', message: 'INTERVENTION_REQUIRED' },
        executionTime: 10,
        state: {
          code: 'INTERVENTION_REQUIRED',
          workspacePathConsent: {
            actualCwd: '/workspace',
            deviceId: 'device-a',
            modes: ['read'],
            operationId: 'op-123',
            primaryCwd: '/workspace',
            requestedPath: '/outside/docs',
            topicId: 'topic-123',
            version: 1,
          },
        },
        success: false,
      });
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
        userInterventionConfig: { approvalMode: 'manual' },
      });

      const result = await executors.call_tool!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolCalling: {
              apiName: 'readFile',
              arguments: '{"path":"/outside/docs"}',
              id: 'tool-call-path',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          },
          type: 'call_tool' as const,
        },
        state,
      );

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '',
          pluginIntervention: { status: 'pending' },
          pluginState: expect.objectContaining({
            workspacePathConsent: expect.objectContaining({
              operationId: 'op-123',
              requestedPath: '/outside/docs',
            }),
          }),
          tool_call_id: 'tool-call-path',
        }),
      );
      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.nextContext).toBeUndefined();
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'human_approve_required' }),
      );
      expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'tool_result' }));
    });

    it('interrupts after the same deterministic tool failure occurs twice', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'invalid arguments',
        error: { kind: 'stop', message: 'invalid arguments' },
        executionTime: 10,
        state: {},
        success: false,
      });
      const executors = createRuntimeExecutors(ctx);
      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const first = await executors.call_tool!(instruction, createMockState());
      const second = await executors.call_tool!(
        {
          ...instruction,
          payload: {
            ...instruction.payload,
            toolCalling: { ...instruction.payload.toolCalling, id: 'tool-call-2' },
          },
        },
        { ...first.newState, stepCount: 1 },
      );

      expect(second.newState.status).toBe('interrupted');
      expect(second.newState.metadata?.executionBudgetCompletionReason).toBe('repeated_error');
    });

    it('should include all required fields when creating tool message', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-456',
          toolCalling: {
            apiName: 'crawl',
            arguments: '{"url": "https://example.com"}',
            id: 'tool-call-2',
            identifier: 'web-browsing',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          content: 'Tool result',
          parentId: 'assistant-msg-456',
          role: 'tool',
          threadId: 'thread-123',
          tool_call_id: 'tool-call-2',
          topicId: 'topic-123',
        }),
      );
    });

    it('should persist tool execution time in metadata when creating tool message', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-456',
          toolCalling: {
            apiName: 'crawl',
            arguments: '{"url": "https://example.com"}',
            id: 'tool-call-2',
            identifier: 'web-browsing',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            toolExecutionTimeMs: 100,
          },
        }),
      );
    });

    it('should return tool message ID as parentMessageId in nextContext for parentId chain', async () => {
      // Setup: mock messageModel.create to return a specific tool message ID
      const toolMessageId = 'tool-msg-789';
      mockMessageModel.create.mockResolvedValue({ id: toolMessageId });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{"query": "test"}',
            id: 'tool-call-1',
            identifier: 'lobe-web-browsing',
            type: 'builtin' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      // Verify nextContext.payload.parentMessageId is the tool message ID
      // This is crucial for the parentId chain: user -> assistant -> tool -> assistant2
      const payload = result.nextContext!.payload as { parentMessageId?: string };
      expect(payload.parentMessageId).toBe(toolMessageId);
      expect(result.nextContext!.phase).toBe('tool_result');
    });

    it('should re-throw when messageModel.create fails (no silent swallow)', async () => {
      // Before we silently swallowed this error and returned
      // `parentMessageId: undefined`, which let the operation continue into
      // the next step and re-hit the same failure without context. The fix
      // requires the executor to propagate so the whole step fails.
      mockMessageModel.create.mockRejectedValue(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await expect(executors.call_tool!(instruction, state)).rejects.toThrow('Database error');
    });

    it('should throw ConversationParentMissing on a parent_id FK violation ()', async () => {
      // Simulate the drizzle + postgres-js wrapped error shape.
      const fkError: any = new Error(
        'Failed query: insert into "messages" ... violates foreign key constraint',
      );
      fkError.cause = {
        code: '23503',
        constraint: 'messages_parent_id_messages_id_fk',
      };
      mockMessageModel.create.mockRejectedValue(fkError);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'deleted-parent',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await expect(executors.call_tool!(instruction, state)).rejects.toMatchObject({
        errorType: 'ConversationParentMissing',
        parentId: 'deleted-parent',
      });

      // Stream event must carry the normalized error, not raw SQL text —
      // clients treat `error` events as terminal and surface data.error
      // directly, so leaking driver output here would show up to users.
      const errorEventPublishes = mockStreamManager.publishStreamEvent.mock.calls.filter(
        ([, event]: [string, any]) => event.type === 'error',
      );
      expect(errorEventPublishes.length).toBeGreaterThan(0);
      for (const [, event] of errorEventPublishes) {
        expect(event.data.errorType).toBe('ConversationParentMissing');
        expect(event.data.error).not.toMatch(/Failed query/);
      }
    });

    it('should retry tool execution when kind is retry and eventually succeed', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'timeout-1',
          error: { kind: 'retry', message: 'timeout' },
          executionTime: 50,
          state: {},
          success: false,
        })
        .mockResolvedValueOnce({
          content: 'timeout-2',
          error: { kind: 'retry', message: 'timeout' },
          executionTime: 50,
          state: {},
          success: false,
        })
        .mockResolvedValueOnce({
          content: 'Tool result success',
          error: null,
          executionTime: 80,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-retry-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(3);
      expect((result.nextContext!.payload as any).isSuccess).toBe(true);
    });

    it('should stop retrying tool execution after operation is interrupted', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'timeout',
        error: { kind: 'retry', message: 'timeout' },
        executionTime: 50,
        state: {},
        success: false,
      });
      const loadAgentState = vi.fn().mockResolvedValue({ status: 'interrupted' });

      const executors = createRuntimeExecutors({
        ...ctx,
        loadAgentState,
      });
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-retry-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(1);
      expect(loadAgentState).toHaveBeenCalledWith('op-123');
      expect((result.nextContext!.payload as any).isSuccess).toBe(false);
    });

    it('should materialize failed tool result after retry exhaustion', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'still failing',
        error: { kind: 'retry', message: 'timeout' },
        executionTime: 50,
        state: {},
        success: false,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-retry-2',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(3);
      expect((result.nextContext!.payload as any).isSuccess).toBe(false);
    });

    it('should not retry for replan or stop kinds', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'invalid args',
          error: { kind: 'replan', message: 'invalid schema' },
          executionTime: 30,
          state: {},
          success: false,
        })
        .mockResolvedValueOnce({
          content: 'permission denied',
          error: { kind: 'stop', message: 'forbidden' },
          executionTime: 30,
          state: {},
          success: false,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const replanInstruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-replan-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const stopInstruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-stop-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(replanInstruction, state);
      await executors.call_tool!(stopInstruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);
    });

    describe('skipCreateToolMessage (resumption after human approval)', () => {
      it('should update existing tool message instead of creating a new one', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();
        state.messages.push({
          id: 'pending-tool-msg-1',
          role: 'tool',
          content: '',
          tool_call_id: 'tool-call-1',
        });

        const instruction = {
          payload: {
            parentMessageId: 'pending-tool-msg-1',
            skipCreateToolMessage: true,
            toolCalling: {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          },
          type: 'call_tool' as const,
        };

        const result = await executors.call_tool!(instruction, state);
        const modelResults = result.newState.messages.filter(
          (message) => message.role === 'tool' && message.tool_call_id === 'tool-call-1',
        );
        expect(modelResults).toHaveLength(1);
        expect(modelResults[0].content).toBe('Tool result');

        expect(mockMessageModel.create).not.toHaveBeenCalled();
        expect(mockMessageModel.updateToolMessage).toHaveBeenCalledWith(
          'pending-tool-msg-1',
          expect.objectContaining({
            content: 'Tool result',
            metadata: { toolExecutionTimeMs: 100 },
          }),
        );
      });

      it('should return the existing toolMessageId as parentMessageId for the next LLM step', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            parentMessageId: 'pending-tool-msg-42',
            skipCreateToolMessage: true,
            toolCalling: {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-42',
              identifier: 'web-search',
              type: 'default' as const,
            },
          },
          type: 'call_tool' as const,
        };

        const result = await executors.call_tool!(instruction, state);

        const nextPayload = result.nextContext?.payload as { parentMessageId?: string } | undefined;
        expect(nextPayload?.parentMessageId).toBe('pending-tool-msg-42');
      });

      it('should fall back to creating a new tool message when skipCreateToolMessage is false', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            parentMessageId: 'assistant-msg-7',
            skipCreateToolMessage: false,
            toolCalling: {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-7',
              identifier: 'web-search',
              type: 'default' as const,
            },
          },
          type: 'call_tool' as const,
        };

        await executors.call_tool!(instruction, state);

        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
        expect(mockMessageModel.updateToolMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe('request_human_approve executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [
        {
          content: 'assistant response',
          id: 'assistant-msg-1',
          role: 'assistant',
        } as any,
      ],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    const makePendingTools = () => [
      {
        apiName: 'search',
        arguments: '{"q":"test"}',
        id: 'tool-call-1',
        identifier: 'web-search',
        type: 'default' as const,
      },
      {
        apiName: 'write',
        arguments: '{"file":"a.md"}',
        id: 'tool-call-2',
        identifier: 'local-system',
        type: 'default' as const,
      },
    ];

    it('should create a pending tool message for each pendingToolsCalling', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      const instruction = {
        pendingToolsCalling: makePendingTools(),
        type: 'request_human_approve' as const,
      };

      await executors.request_human_approve!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledTimes(2);
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          agentId: 'agent-123',
          content: '',
          parentId: 'assistant-msg-1',
          pluginIntervention: { status: 'pending' },
          role: 'tool',
          tool_call_id: 'tool-call-1',
          topicId: 'topic-123',
        }),
      );
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          parentId: 'assistant-msg-1',
          pluginIntervention: { status: 'pending' },
          tool_call_id: 'tool-call-2',
        }),
      );
    });

    it('persists runtime-authored path metadata for a pre-dispatch local path approval', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [
              {
                modes: ['read', 'write', 'exec'],
                rootPath: '/workspace',
                scope: 'primary',
                source: 'workspace',
              },
            ],
            cwd: '/workspace',
            operationId: 'op-123',
            plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });
      mockMessageModel.create.mockResolvedValue({ id: 'tool-msg-path' });

      await executors.request_human_approve!(
        {
          pendingToolsCalling: [
            {
              apiName: 'writeFile',
              arguments: '{"path":"/outside/note.txt","content":"x"}',
              id: 'tool-call-path',
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            },
          ],
          type: 'request_human_approve' as const,
        },
        state,
      );

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginIntervention: { status: 'pending' },
          pluginState: {
            workspacePathConsent: expect.objectContaining({
              modes: ['write'],
              operationId: 'op-123',
              requestedPath: '/outside',
            }),
          },
          tool_call_id: 'tool-call-path',
        }),
      );
    });

    it('should set state to waiting_for_human and copy pendingToolsCalling', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });
      const pending = makePendingTools();

      const result = await executors.request_human_approve!(
        { pendingToolsCalling: pending, type: 'request_human_approve' as const },
        state,
      );

      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.newState.pendingToolsCalling).toEqual(pending);
    });

    it('should publish tools_calling chunk with toolMessageIds mapping', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          type: 'request_human_approve' as const,
        },
        state,
      );

      const chunkCall = mockStreamManager.publishStreamChunk.mock.calls.find(
        (call: any[]) => call[2]?.chunkType === 'tools_calling',
      );
      expect(chunkCall).toBeTruthy();
      expect(chunkCall![2].toolMessageIds).toEqual({
        'tool-call-1': 'tool-msg-1',
        'tool-call-2': 'tool-msg-2',
      });
    });

    it('should skip message creation when skipCreateToolMessage is true', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.query.mockResolvedValueOnce([
        { id: 'existing-tool-1', role: 'tool', tool_call_id: 'tool-call-1' },
        { id: 'existing-tool-2', role: 'tool', tool_call_id: 'tool-call-2' },
      ]);

      await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          skipCreateToolMessage: true,
          type: 'request_human_approve' as const,
        },
        state,
      );

      expect(mockMessageModel.create).not.toHaveBeenCalled();
      const chunkCall = mockStreamManager.publishStreamChunk.mock.calls.find(
        (call: any[]) => call[2]?.chunkType === 'tools_calling',
      );
      expect(chunkCall![2].toolMessageIds).toEqual({
        'tool-call-1': 'existing-tool-1',
        'tool-call-2': 'existing-tool-2',
      });
    });

    it('should throw if no parent assistant message can be found', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ messages: [] });
      mockMessageModel.query.mockResolvedValueOnce([]);

      await expect(
        executors.request_human_approve!(
          {
            pendingToolsCalling: makePendingTools(),
            type: 'request_human_approve' as const,
          },
          state,
        ),
      ).rejects.toThrow(/No assistant message found/);
    });

    it('should emit human_approve_required and tool_pending events', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      const result = await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          type: 'request_human_approve' as const,
        },
        state,
      );

      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'human_approve_required' }),
      );
      expect(result.events).toContainEqual(expect.objectContaining({ type: 'tool_pending' }));
    });

    it('should NOT return a nextContext (operation pauses)', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      const result = await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          type: 'request_human_approve' as const,
        },
        state,
      );

      expect(result.nextContext).toBeUndefined();
    });
  });

  describe('call_tools_batch executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    beforeEach(() => {
      // Reset mock to return unique IDs for each call
      let callCount = 0;
      mockMessageModel.create.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ id: `tool-msg-${callCount}` });
      });

      // Mock query to return messages from database
      mockMessageModel.query = vi.fn().mockResolvedValue([
        { id: 'msg-1', content: 'Hello', role: 'user' },
        { id: 'msg-2', content: 'Response', role: 'assistant', tool_calls: [] },
        { id: 'tool-msg-1', content: 'Tool result 1', role: 'tool', tool_call_id: 'tool-call-1' },
        { id: 'tool-msg-2', content: 'Tool result 2', role: 'tool', tool_call_id: 'tool-call-2' },
      ]);
    });

    it('should execute multiple tools concurrently and create tool messages', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test1"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      // Should execute both tools
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);

      // Should create two tool messages
      expect(mockMessageModel.create).toHaveBeenCalledTimes(2);

      // Verify first tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          parentId: 'assistant-msg-123',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        }),
      );

      // Verify second tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          parentId: 'assistant-msg-123',
          role: 'tool',
          tool_call_id: 'tool-call-2',
        }),
      );
    });

    it('shares one scratch creation and one bind across concurrent cwd-dependent tools', async () => {
      const ensureScratchWorkspace = vi
        .fn()
        .mockResolvedValue({ root: '/tmp/masterino/topic-123' });
      const bindScratchAfterToolSuccess = vi.fn().mockResolvedValue({
        snapshot: {
          boundDeviceId: 'device-a',
          target: 'local',
          targetCapturedAt: '2026-09-04T00:00:00.000Z',
          version: 1,
          workspaceBoundAt: '2026-09-04T00:00:01.000Z',
          workspaceId: 'scratch-workspace',
          workspaceKind: 'scratch',
        },
        workspace: {
          deviceId: 'device-a',
          id: 'scratch-workspace',
          kind: 'scratch',
          rootPath: '/tmp/masterino/topic-123',
        },
      });
      const executors = createRuntimeExecutors({
        ...ctx,
        bindScratchAfterToolSuccess,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });
      const state = createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [],
            plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            unresolvedReason: 'no-workspace',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const result = await executors.call_tools_batch!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolsCalling: [
              {
                apiName: 'listFiles',
                arguments: '{}',
                id: 'tool-call-scratch-1',
                identifier: 'lobe-local-system',
                type: 'builtin' as const,
              },
              {
                apiName: 'searchFiles',
                arguments: '{"query":"TODO"}',
                id: 'tool-call-scratch-2',
                identifier: 'lobe-local-system',
                type: 'builtin' as const,
              },
            ],
          },
          type: 'call_tools_batch' as const,
        },
        state,
      );

      expect(ensureScratchWorkspace).toHaveBeenCalledOnce();
      expect(bindScratchAfterToolSuccess).toHaveBeenCalledOnce();
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);
      for (const [, executionOptions] of mockToolExecutionService.executeTool.mock.calls) {
        expect(executionOptions.executionContext.cwd).toBe('/tmp/masterino/topic-123');
      }
      expect(result.newState.metadata?.executionContext).toMatchObject({
        cwd: '/tmp/masterino/topic-123',
        workspace: { id: 'scratch-workspace', kind: 'scratch' },
      });
    });

    const createScratchBatchState = () =>
      createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          executionContext: {
            accessRoots: [],
            plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
            unresolvedReason: 'no-workspace',
            version: 1,
          },
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

    const scratchBatchInstruction = {
      payload: {
        parentMessageId: 'assistant-msg-123',
        toolsCalling: [
          {
            apiName: 'listFiles',
            arguments: '{}',
            id: 'tool-call-scratch-1',
            identifier: 'lobe-local-system',
            type: 'builtin' as const,
          },
          {
            apiName: 'searchFiles',
            arguments: '{"query":"TODO"}',
            id: 'tool-call-scratch-2',
            identifier: 'lobe-local-system',
            type: 'builtin' as const,
          },
        ],
      },
      type: 'call_tools_batch' as const,
    };

    const expectEveryBatchResultKept = (result: any) => {
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);
      // The bug this guards: a bind outcome used to escape into the per-tool
      // catch and skip persisting the result of a tool that already succeeded.
      expect(mockMessageModel.create).toHaveBeenCalledTimes(2);
      for (const toolCallId of ['tool-call-scratch-1', 'tool-call-scratch-2']) {
        expect(mockMessageModel.create).toHaveBeenCalledWith(
          expect.objectContaining({ content: 'Tool result', tool_call_id: toolCallId }),
        );
        expect(result.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: toolCallId, type: 'tool_result' }),
          ]),
        );
      }
    };

    it('adopts the concurrent winner the shared batch bind resolves', async () => {
      const ensureScratchWorkspace = vi
        .fn()
        .mockResolvedValue({ root: '/tmp/masterino/topic-123' });
      const bindScratchAfterToolSuccess = vi.fn().mockResolvedValue({
        snapshot: {
          boundDeviceId: 'device-a',
          target: 'local',
          targetCapturedAt: '2026-09-04T00:00:00.000Z',
          version: 1,
          workspaceBoundAt: '2026-09-04T00:00:01.000Z',
          workspaceId: 'formal-workspace',
          workspaceKind: 'device',
        },
        workspace: {
          deviceId: 'device-a',
          id: 'formal-workspace',
          kind: 'device',
          rootPath: '/Users/me/formal-project',
        },
      });
      const executors = createRuntimeExecutors({
        ...ctx,
        bindScratchAfterToolSuccess,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });

      const result = await executors.call_tools_batch!(
        scratchBatchInstruction,
        createScratchBatchState(),
      );

      expect(bindScratchAfterToolSuccess).toHaveBeenCalledOnce();
      expectEveryBatchResultKept(result);
      expect(result.newState.metadata?.executionContext).toMatchObject({
        cwd: '/Users/me/formal-project',
        snapshot: { workspaceId: 'formal-workspace', workspaceKind: 'device' },
        workspace: { id: 'formal-workspace', kind: 'device' },
      });
      expect(result.newState.status).not.toBe('interrupted');
      expect(result.nextContext).toBeDefined();
    });

    // Same semantics as call_tool: a rejected bind — WORKSPACE_ALREADY_BOUND
    // included — means no workspace could be resolved, so the batch keeps every
    // successful result and stops instead of running on unbound.
    it.each<[string, Error]>([
      ['the concurrent winner cannot be resolved', new Error('WORKSPACE_ALREADY_BOUND')],
      ['the bind query fails', new Error('Failed query: update "topics" set "metadata" = $1')],
    ])('keeps every successful batch result and interrupts when %s', async (_case, bindError) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ensureScratchWorkspace = vi
        .fn()
        .mockResolvedValue({ root: '/tmp/masterino/topic-123' });
      const bindScratchAfterToolSuccess = vi.fn().mockRejectedValue(bindError);
      const executors = createRuntimeExecutors({
        ...ctx,
        bindScratchAfterToolSuccess,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });
      const state = createScratchBatchState();

      const result = await executors.call_tools_batch!(scratchBatchInstruction, state);

      expect(bindScratchAfterToolSuccess).toHaveBeenCalledOnce();
      expectEveryBatchResultKept(result);

      expect(result.newState.status).toBe('interrupted');
      expect(result.newState.interruption).toMatchObject({
        canResume: true,
        reason: 'WORKSPACE_BIND_FAILED',
      });
      expect(result.nextContext).toBeUndefined();
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'WORKSPACE_BIND_FAILED', type: 'interrupted' }),
        ]),
      );
      expect(result.events.some((event: any) => event.type === 'error')).toBe(false);
      expect(result.newState.metadata?.executionContext).toEqual(state.metadata!.executionContext);

      // Server log only — the raw failure never reaches state or events.
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), bindError);
      const exposed = serializeForSecretScan({ events: result.events, state: result.newState });
      expect(exposed).not.toContain(bindError.message);
      expect(exposed).not.toContain('/tmp/masterino/topic-123');

      consoleError.mockRestore();
    });

    it('persists a bind-failure debt while a mixed batch waits for its client tool', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const bindError = new Error('Failed query: update workspace binding');
      const ensureScratchWorkspace = vi
        .fn()
        .mockResolvedValue({ root: '/tmp/masterino/topic-123' });
      const bindScratchAfterToolSuccess = vi.fn().mockRejectedValue(bindError);
      const executors = createRuntimeExecutors({
        ...ctx,
        bindScratchAfterToolSuccess,
        ensureScratchWorkspace,
        topicId: 'topic-123',
      });
      const state = createScratchBatchState();
      state.toolSourceMap = { 'client-extension': 'client' };

      const result = await executors.call_tools_batch!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolsCalling: [
              {
                apiName: 'listFiles',
                arguments: '{}',
                id: 'tool-call-server',
                identifier: 'lobe-local-system',
                type: 'builtin' as const,
              },
              {
                apiName: 'pickFile',
                arguments: '{}',
                id: 'tool-call-client',
                identifier: 'client-extension',
                type: 'default' as const,
              },
            ],
          },
          type: 'call_tools_batch' as const,
        },
        state,
      );

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledOnce();
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ tool_call_id: 'tool-call-server' }),
      );
      expect(result.newState.status).toBe('waiting_for_async_tool');
      expect(result.newState.pendingToolsCalling).toEqual([
        expect.objectContaining({ id: 'tool-call-client' }),
      ]);
      expect(result.newState.interruption).toMatchObject({ reason: 'client_tool_execution' });
      expect(hasPendingWorkspaceBindFailure(result.newState)).toBe(true);
      expect(result.nextContext).toBeUndefined();

      const exposed = serializeForSecretScan({ events: result.events, state: result.newState });
      expect(exposed).not.toContain(bindError.message);
      expect(exposed).not.toContain('/tmp/masterino/topic-123');
      consoleError.mockRestore();
    });

    it('parks a device-authored path intervention from a batch instead of returning it to the LLM', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'INTERVENTION_REQUIRED',
        error: { kind: 'stop', message: 'INTERVENTION_REQUIRED' },
        executionTime: 10,
        state: {
          code: 'INTERVENTION_REQUIRED',
          workspacePathConsent: {
            actualCwd: '/workspace',
            deviceId: 'device-a',
            modes: ['read'],
            operationId: 'op-123',
            primaryCwd: '/workspace',
            requestedPath: '/outside/real-target',
            topicId: 'topic-123',
            version: 1,
          },
        },
        success: false,
      });
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          activeDeviceId: 'device-a',
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
        userInterventionConfig: { approvalMode: 'manual' },
      });

      const result = await executors.call_tools_batch!(
        {
          payload: {
            parentMessageId: 'assistant-msg-123',
            toolsCalling: [
              {
                apiName: 'readFile',
                arguments: '{"path":"/outside/link"}',
                id: 'tool-call-path',
                identifier: 'lobe-local-system',
                type: 'builtin' as const,
              },
            ],
          },
          type: 'call_tools_batch' as const,
        },
        state,
      );

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '',
          pluginIntervention: { status: 'pending' },
          pluginState: expect.objectContaining({
            workspacePathConsent: expect.objectContaining({
              requestedPath: '/outside/real-target',
            }),
          }),
          tool_call_id: 'tool-call-path',
        }),
      );
      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.newState.pendingToolsCalling).toEqual([
        expect.objectContaining({ id: 'tool-call-path' }),
      ]);
      expect(result.nextContext).toBeUndefined();
      expect(result.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'human_approve_required' })]),
      );
    });

    it('should apply retry policy per tool in batch mode', async () => {
      const attemptsByTool: Record<string, number> = {};

      mockToolExecutionService.executeTool.mockImplementation((payload: any) => {
        const toolId = payload.id as string;
        const nextAttempt = (attemptsByTool[toolId] || 0) + 1;
        attemptsByTool[toolId] = nextAttempt;

        if (toolId === 'tool-call-retry-batch' && nextAttempt < 3) {
          return Promise.resolve({
            content: 'timeout',
            error: { kind: 'retry', message: 'timeout' },
            executionTime: 40,
            state: {},
            success: false,
          });
        }

        if (toolId === 'tool-call-stop-batch') {
          return Promise.resolve({
            content: 'permission denied',
            error: { kind: 'stop', message: 'forbidden' },
            executionTime: 40,
            state: {},
            success: false,
          });
        }

        return Promise.resolve({
          content: 'ok',
          error: null,
          executionTime: 60,
          state: {},
          success: true,
        });
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-retry-batch',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-stop-batch',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(4);
      expect((result.nextContext!.payload as any).toolResults).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ isSuccess: true }),
          expect.objectContaining({ isSuccess: false }),
        ]),
      );
    });

    it('should refresh messages from database after batch execution', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ messages: [{ content: 'old', role: 'user' }] });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Should query messages from database with agentId, threadId, and topicId
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
        expect.any(Object),
      );

      // Messages should be refreshed from database (4 messages from mock)
      expect(result.newState.messages).toHaveLength(4);
    });

    it('should include id in refreshed messages', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Each message should have an id
      result.newState.messages.forEach((msg: any) => {
        expect(msg.id).toBeDefined();
        expect(typeof msg.id).toBe('string');
      });

      // Verify specific message ids
      expect(result.newState.messages[0].id).toBe('msg-1');
      expect(result.newState.messages[2].id).toBe('tool-msg-1');
    });

    it('should return last tool message ID as parentMessageId in nextContext', async () => {
      let callCount = 0;
      mockMessageModel.create.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ id: `created-tool-msg-${callCount}` });
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // parentMessageId should be the last created tool message ID
      const payload = result.nextContext!.payload as { parentMessageId?: string };
      expect(payload.parentMessageId).toBe('created-tool-msg-2');
      expect(result.nextContext!.phase).toBe('tools_batch_result');
    });

    it('should propagate persist failures instead of silently falling back ()', async () => {
      // Before we fell back to the original parentMessageId here,
      // which was itself the deleted parent that caused the failure — so the
      // next step would hit the same FK violation with no context. The fix
      // requires the batch to short-circuit on persist failure.
      mockMessageModel.create.mockRejectedValue(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'original-parent-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await expect(executors.call_tools_batch!(instruction, state)).rejects.toThrow(
        'Database error',
      );
    });

    it('should throw ConversationParentMissing on a parent_id FK violation ()', async () => {
      const fkError: any = new Error(
        'Failed query: insert into "messages" ... violates foreign key constraint',
      );
      fkError.cause = {
        code: '23503',
        constraint: 'messages_parent_id_messages_id_fk',
      };
      mockMessageModel.create.mockRejectedValue(fkError);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'deleted-parent',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await expect(executors.call_tools_batch!(instruction, state)).rejects.toMatchObject({
        errorType: 'ConversationParentMissing',
        parentId: 'deleted-parent',
      });
    });

    it('should continue processing other tools if one tool execution fails', async () => {
      // First tool fails, second succeeds
      mockToolExecutionService.executeTool
        .mockRejectedValueOnce(new Error('Tool execution error'))
        .mockResolvedValueOnce({
          content: 'Tool result 2',
          error: null,
          executionTime: 100,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Both tools should be attempted
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);

      // Only one tool message should be created (for the successful tool)
      expect(mockMessageModel.create).toHaveBeenCalledTimes(1);

      // Should still return result (not throw)
      expect(result.nextContext).toBeDefined();
      expect(result.nextContext!.phase).toBe('tools_batch_result');
    });

    it('should fail the batch if tool message creation fails for any tool ()', async () => {
      // Before we swallowed per-tool persist failures and kept
      // going. The fix requires the batch to abort — a FK violation on one
      // tool means every concurrent tool has the same doomed parent.
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockRejectedValueOnce(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await expect(executors.call_tools_batch!(instruction, state)).rejects.toThrow(
        'Database error',
      );
    });

    it('should publish tool_start and tool_end events for each tool', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      // Should publish tool_start for each tool
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({ type: 'tool_start' }),
      );

      // Should publish tool_end for each tool
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({ type: 'tool_end' }),
      );

      // At least 4 events (2 tool_start + 2 tool_end)
      expect(mockStreamManager.publishStreamEvent.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should include toolCount and toolResults in nextContext payload', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      const payload = result.nextContext!.payload as {
        toolCount: number;
        toolResults: any[];
      };

      expect(payload.toolCount).toBe(2);
      expect(payload.toolResults).toHaveLength(2);
      expect(payload.toolResults[0]).toEqual(
        expect.objectContaining({
          toolCallId: 'tool-call-1',
          isSuccess: true,
        }),
      );
    });

    it('should query messages with correct metadata fields when state.metadata is defined', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-abc',
          threadId: 'thread-xyz',
          topicId: 'topic-abc-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      // Should query messages with agentId, threadId, and topicId from state.metadata
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-abc',
          threadId: 'thread-xyz',
          topicId: 'topic-abc-123',
        },
        expect.any(Object),
      );
    });

    // After DB refresh, state.messages stores raw UIChatMessage[]
    // and call_llm re-injects context via serverMessagesEngine on each invocation
    it('should store raw UIChatMessage[] from DB after refresh (context re-injected by call_llm)', async () => {
      // DB only stores raw user/assistant/tool messages, NOT MessagesEngine injections
      const dbMessages = [
        { id: 'msg-1', content: 'What is quantum computing?', role: 'user' },
        {
          id: 'msg-2',
          content: '',
          role: 'assistant',
          tool_calls: [{ id: 'tool-call-1', function: { name: 'search', arguments: '{}' } }],
        },
        {
          id: 'tool-msg-1',
          content: 'Search results...',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        },
      ];
      mockMessageModel.query = vi.fn().mockResolvedValue(dbMessages);

      const executors = createRuntimeExecutors(ctx);

      // State before tool execution: messages are raw UIChatMessage[]
      const state = createMockState({
        messages: [
          { id: 'msg-1', content: 'What is quantum computing?', role: 'user' },
          {
            id: 'msg-2',
            content: '',
            role: 'assistant',
            tool_calls: [{ id: 'tool-call-1', function: { name: 'search', arguments: '{}' } }],
          },
        ],
      });

      const instruction = {
        payload: {
          parentMessageId: 'msg-2',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // After DB refresh, messages should be full UIChatMessage[] (via parse),
      // preserving all fields (id, content, role, tool_calls, tool_call_id)
      expect(result.newState.messages).toHaveLength(3);
      expect(result.newState.messages[0]).toEqual(
        expect.objectContaining({
          id: 'msg-1',
          role: 'user',
          content: 'What is quantum computing?',
        }),
      );
      expect(result.newState.messages[2]).toEqual(
        expect.objectContaining({
          id: 'tool-msg-1',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        }),
      );
    });

    it('should preserve messages in newState even when state.metadata.topicId is undefined', async () => {
      // Regression test: When state.metadata.topicId is undefined, previously the query
      // only passed topicId, which caused isNull(topicId) condition and returned 0 messages.
      // This led to "messages: at least one message is required" error in the next call_llm step.
      //
      // Fix: Now we also pass agentId and threadId, so even when topicId is undefined,
      // the query can still find messages by agentId scope.

      // Mock: query returns messages when agentId is provided (regardless of topicId)
      mockMessageModel.query = vi
        .fn()
        .mockImplementation((params: { agentId?: string; topicId?: string }) => {
          // With the fix, agentId is always passed, so we can find messages
          if (params.agentId) {
            return Promise.resolve([
              { id: 'msg-1', content: 'Hello', role: 'user' },
              { id: 'msg-2', content: 'Response', role: 'assistant', tool_calls: [] },
            ]);
          }
          // Without agentId (old buggy behavior), return empty
          return Promise.resolve([]);
        });

      const executors = createRuntimeExecutors(ctx);
      // State with undefined topicId but has agentId
      const state = createMockState({
        messages: [
          { content: 'Hello', role: 'user' },
          { content: 'Response', role: 'assistant', tool_calls: [] },
        ],
        metadata: {
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: undefined, // topicId is undefined
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Verify agentId is passed in the query
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: undefined,
        },
        expect.any(Object),
      );

      // Expected: newState.messages should NOT be empty
      // The next call_llm step needs messages to work properly
      expect(result.newState.messages.length).toBeGreaterThan(0);
    });

    it('should accumulate tool usage in newState after batch execution', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'Search result',
          error: null,
          executionTime: 150,
          state: {},
          success: true,
        })
        .mockResolvedValueOnce({
          content: 'Crawl result',
          error: null,
          executionTime: 250,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Tool usage must be accumulated in newState
      expect(result.newState.usage.tools.totalCalls).toBe(2);
      expect(result.newState.usage.tools.totalTimeMs).toBe(400);
      expect(result.newState.usage.tools.byTool).toHaveLength(2);

      // Verify per-tool breakdown
      const searchTool = result.newState.usage.tools.byTool.find(
        (t: any) => t.name === 'web-search/search',
      );
      const crawlTool = result.newState.usage.tools.byTool.find(
        (t: any) => t.name === 'web-browsing/crawl',
      );
      expect(searchTool).toEqual(
        expect.objectContaining({ calls: 1, errors: 0, totalTimeMs: 150 }),
      );
      expect(crawlTool).toEqual(expect.objectContaining({ calls: 1, errors: 0, totalTimeMs: 250 }));

      // Original state must not be mutated
      expect(state.usage.tools.totalCalls).toBe(0);
    });

    it('should persist execution time metadata for each tool message in batch execution', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'Search result',
          error: null,
          executionTime: 150,
          state: {},
          success: true,
        })
        .mockResolvedValueOnce({
          content: 'Crawl result',
          error: null,
          executionTime: 250,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          metadata: {
            toolExecutionTimeMs: 150,
          },
        }),
      );
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          metadata: {
            toolExecutionTimeMs: 250,
          },
        }),
      );
    });

    it('should pass toolResultMaxLength from agentConfig to executeTool', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentConfig: {
            chatConfig: {
              toolResultMaxLength: 5000,
            },
          },
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          skipResultTruncation: true,
          toolResultMaxLength: 5000,
        }),
      );
    });

    it('should pass agentId from runtime metadata to executeTool', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-docs-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'createDocument',
              arguments: '{"title":"Test","content":"Hello"}',
              id: 'tool-call-1',
              identifier: 'lobe-agent-documents',
              type: 'builtin' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          agentId: 'agent-docs-123',
        }),
      );
    });

    it('should pass Agent Signal procedure identity fields to executeTool', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-docs-123',
          sourceMessageId: 'user-msg-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'createDocument',
              arguments: '{"title":"Test","content":"Hello"}',
              id: 'tool-call-1',
              identifier: 'lobe-agent-documents',
              type: 'builtin' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          messageId: 'user-msg-123',
          operationId: 'op-123',
          toolCallId: 'tool-call-1',
        }),
      );
    });
  });

  describe('resolve_blocked_tools executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    it('should create rejected tool messages and continue execution', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'bash',
              arguments: '{"command":"rm -rf /"}',
              id: 'tool-call-1',
              identifier: 'bash',
              type: 'builtin' as const,
            },
          ],
        },
        type: 'resolve_blocked_tools' as const,
      };

      const result = await executors.resolve_blocked_tools!(instruction, state);

      expect(mockToolExecutionService.executeTool).not.toHaveBeenCalled();
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          content: 'Blocked by security/privacy.',
          parentId: 'assistant-msg-123',
          pluginError: 'blocked_by_security_privacy',
          pluginIntervention: {
            rejectedReason: 'blocked_by_security_privacy',
            status: 'rejected',
          },
          role: 'tool',
          threadId: 'thread-123',
          tool_call_id: 'tool-call-1',
          topicId: 'topic-123',
        }),
      );
      expect(result.newState.status).toBe('running');
      expect(result.nextContext?.phase).toBe('tools_batch_result');
      expect(result.nextContext?.payload).toMatchObject({
        parentMessageId: 'msg-123',
        toolCount: 1,
      });
    });
  });

  describe('resolve_aborted_tools executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    it('should create aborted tool messages for all pending tool calls', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      await executors.resolve_aborted_tools!(instruction, state);

      // Should create two aborted tool messages
      expect(mockMessageModel.create).toHaveBeenCalledTimes(2);

      // First tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          content: 'Tool execution was aborted by user.',
          parentId: 'assistant-msg-123',
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: 'thread-123',
          tool_call_id: 'tool-call-1',
          topicId: 'topic-123',
        }),
      );

      // Second tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          content: 'Tool execution was aborted by user.',
          parentId: 'assistant-msg-123',
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: 'thread-123',
          tool_call_id: 'tool-call-2',
          topicId: 'topic-123',
        }),
      );
    });

    it('should update state status to done after resolving aborted tools', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ status: 'running' });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      const result = await executors.resolve_aborted_tools!(instruction, state);

      expect(result.newState.status).toBe('done');
    });

    it('should emit done event with user_aborted reason', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      const result = await executors.resolve_aborted_tools!(instruction, state);

      expect(result.events).toContainEqual(
        expect.objectContaining({
          reason: 'user_aborted',
          reasonDetail: 'User aborted operation with pending tool calls',
          type: 'done',
        }),
      );
    });

    it('should publish stream events for abort process', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      await executors.resolve_aborted_tools!(instruction, state);

      // Should publish step_start event for tools_aborted phase
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          data: expect.objectContaining({
            phase: 'tools_aborted',
          }),
          type: 'step_start',
        }),
      );

      // Should publish step_complete event
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          data: expect.objectContaining({
            phase: 'execution_complete',
            reason: 'user_aborted',
          }),
          type: 'step_complete',
        }),
      );
    });

    it('should add tool messages to state.messages', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ messages: [] });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      const result = await executors.resolve_aborted_tools!(instruction, state);

      expect(result.newState.messages).toHaveLength(2);
      expect(result.newState.messages[0]).toEqual({
        content: 'Tool execution was aborted by user.',
        role: 'tool',
        tool_call_id: 'tool-call-1',
      });
      expect(result.newState.messages[1]).toEqual({
        content: 'Tool execution was aborted by user.',
        role: 'tool',
        tool_call_id: 'tool-call-2',
      });
    });

    it('should propagate persist failures instead of silently swallowing ()', async () => {
      // The pre-behavior logged the error and kept walking the
      // aborted-tool list. That left a half-persisted state and hid the real
      // cause from ops. Now we fail fast.
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockRejectedValueOnce(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      await expect(executors.resolve_aborted_tools!(instruction, state)).rejects.toThrow(
        'Database error',
      );
    });
  });

  // Regression: stream errors silently produce empty llm_result
  // Uses real consumeStreamUntilDone + createCallbacksTransformer to test the full stream pipeline.
  // Only the lowest-level chat() return is mocked to simulate provider error responses.
  describe('stream error detection in call_llm', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      modelRuntimeConfig: {
        model: 'gpt-4',
        provider: 'openai',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    afterEach(() => {
      // Restore default mock for other tests
      vi.mocked(consumeStreamUntilDone).mockResolvedValue(undefined);
    });

    it('should retry and eventually throw when LLM stream contains error events from provider', async () => {
      vi.useFakeTimers();

      // Import real implementations directly from source (bypassing the @lobechat/model-runtime mock)
      const { consumeStreamUntilDone: realConsume } =
        await import('../../../../../../packages/model-runtime/src/utils/consumeStream');
      const { createCallbacksTransformer } =
        await import('../../../../../../packages/model-runtime/src/core/streams/protocol');

      // Use real consumeStreamUntilDone so the stream is actually consumed
      vi.mocked(consumeStreamUntilDone).mockImplementation(realConsume);

      const errorPayload = {
        body: { message: 'rate limit exceeded' },
        message: 'rate limit exceeded',
        type: 'ProviderBizError',
      };

      // Mock chat() at the lowest level: return a Response with SSE error stream
      // piped through the real createCallbacksTransformer (just like the OpenAI factory does)
      const mockChat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
        const callbacks = options?.callback;
        const sseLines = ['event: error\n', `data: ${JSON.stringify(errorPayload)}\n\n`];
        const source = new ReadableStream<string>({
          start(controller) {
            for (const line of sseLines) controller.enqueue(line);
            controller.close();
          },
        });
        return new Response(source.pipeThrough(createCallbacksTransformer(callbacks)));
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);
        const rejectionExpectation = expect(resultPromise).rejects.toThrow(/LLM stream error/);

        await Promise.resolve();
        await vi.runAllTimersAsync();

        await rejectionExpectation;

        expect(mockChat).toHaveBeenCalledTimes(6);

        const retryEvents = mockStreamManager.publishStreamEvent.mock.calls.filter(
          ([, event]: [string, { type: string }]) => event.type === 'stream_retry',
        );

        expect(retryEvents).toHaveLength(5);

        // Error event should be published to stream manager after retries are exhausted
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'error',
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw and not produce llm_result when modelRuntime.chat rejects', async () => {
      // When chat() throws (pre-stream error like auth failure), it SHOULD propagate
      const mockChat = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toThrow('401 Unauthorized');

      // Error event should be published to stream
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          type: 'error',
          data: expect.objectContaining({
            error: '401 Unauthorized',
            errorType: 'Error',
            phase: 'llm_execution',
          }),
        }),
      );
    });

    it('should disable llm execution retry for the branding provider', async () => {
      const mockChat = vi
        .fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValueOnce(new Response('done'));

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: BRANDING_PROVIDER,
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toThrow('network timeout');

      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(
        mockStreamManager.publishStreamEvent.mock.calls.some(
          ([, event]: [string, { type: string }]) => event.type === 'stream_retry',
        ),
      ).toBe(false);
    });

    it('should retry llm execution, emit stream_retry, and commit only the successful attempt', async () => {
      vi.useFakeTimers();

      const toolCallPayload = [
        {
          function: { arguments: '{}', name: 'search' },
          id: 'tool-call-1',
          type: 'function',
        },
      ];

      const mockChat = vi
        .fn()
        .mockImplementationOnce(async (_payload: any, options: any) => {
          await options.callback.onGrounding?.({ query: 'draft' });
          await options.callback.onToolsCalling?.({ toolsCalling: toolCallPayload });
          throw new Error('network timeout');
        })
        .mockImplementationOnce(async (_payload: any, options: any) => {
          await options.callback.onText?.('final');
          await options.callback.onCompletion?.({
            usage: { totalInputTokens: 1, totalOutputTokens: 2, totalTokens: 3 },
          });
          return new Response('done');
        });

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);

        await vi.runOnlyPendingTimersAsync();

        await resultPromise;

        expect(mockChat).toHaveBeenCalledTimes(2);
        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
        expect(mockMessageModel.update).toHaveBeenCalledWith(
          'msg-123',
          expect.objectContaining({ content: 'final' }),
        );
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 2, delayMs: 1000, maxAttempts: 6 },
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should honor a structured retryAfterMs hint from the readiness gate', async () => {
      vi.useFakeTimers();

      const readinessError = Object.assign(new Error('Aihub provisioning is still pending'), {
        errorType: 'AihubReadinessUnavailable',
        retryAfterMs: 2000,
        retryable: true,
      });
      const mockChat = vi
        .fn()
        .mockRejectedValueOnce(readinessError)
        .mockImplementationOnce(async (_payload: any, options: any) => {
          await options.callback.onText?.('ready');
          await options.callback.onCompletion?.({
            usage: { totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 2 },
          });
          return new Response('done');
        });

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);

        await vi.runOnlyPendingTimersAsync();
        await resultPromise;

        expect(mockChat).toHaveBeenCalledTimes(2);
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 2, delayMs: 2000, maxAttempts: 6 },
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not retry llm execution after operation is interrupted', async () => {
      const mockChat = vi.fn().mockRejectedValue(new Error('network timeout'));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
      const loadAgentState = vi.fn().mockResolvedValue({ status: 'interrupted' });

      const executors = createRuntimeExecutors({
        ...ctx,
        loadAgentState,
      });
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toThrow('network timeout');

      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(loadAgentState).toHaveBeenCalledWith('op-123');
      expect(
        mockStreamManager.publishStreamEvent.mock.calls.some(
          ([, event]: [string, { type: string }]) => event.type === 'stream_retry',
        ),
      ).toBe(false);
    });

    it('should not retry llm execution if operation is interrupted during backoff', async () => {
      vi.useFakeTimers();

      const mockChat = vi.fn().mockRejectedValue(new Error('network timeout'));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
      const loadAgentState = vi
        .fn()
        .mockResolvedValueOnce({ status: 'running' })
        .mockResolvedValueOnce({ status: 'interrupted' });

      const executors = createRuntimeExecutors({
        ...ctx,
        loadAgentState,
      });
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);
        const rejectionExpectation = expect(resultPromise).rejects.toThrow('network timeout');

        await Promise.resolve();
        await vi.runOnlyPendingTimersAsync();

        await rejectionExpectation;

        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(loadAgentState).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should apply exponential backoff across multiple llm retries', async () => {
      vi.useFakeTimers();

      const mockChat = vi
        .fn()
        .mockRejectedValueOnce(new Error('network timeout-1'))
        .mockRejectedValueOnce(new Error('network timeout-2'))
        .mockRejectedValueOnce(new Error('network timeout-3'))
        .mockImplementationOnce(async (_payload: any, options: any) => {
          await options.callback.onText?.('final');
          await options.callback.onCompletion?.({
            usage: { totalInputTokens: 1, totalOutputTokens: 2, totalTokens: 3 },
          });
          return new Response('done');
        });

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);

        await vi.runOnlyPendingTimersAsync();
        await Promise.resolve();
        await vi.runOnlyPendingTimersAsync();
        await Promise.resolve();
        await vi.runOnlyPendingTimersAsync();

        const result = await resultPromise;

        expect(mockChat).toHaveBeenCalledTimes(4);
        expect(result.nextContext?.phase).toBe('llm_result');

        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 2, delayMs: 1000, maxAttempts: 6 },
          }),
        );
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 3, delayMs: 2000, maxAttempts: 6 },
          }),
        );
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 4, delayMs: 4000, maxAttempts: 6 },
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('hooks integration', () => {
    const createToolState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: { agentId: 'agent-123', topicId: 'topic-123' },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    const createToolInstruction = (overrides?: any) => ({
      payload: {
        parentMessageId: 'parent-msg',
        toolCalling: {
          apiName: 'search_tweets',
          arguments: '{"query":"test"}',
          id: 'tc-1',
          identifier: 'twitter',
          type: 'default' as const,
        },
        ...overrides,
      },
      type: 'call_tool' as const,
    });

    describe('call_tool hooks', () => {
      it('should dispatch beforeToolCall and afterToolCall hooks', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        await executors.call_tool!(createToolInstruction(), createToolState());

        expect(mockDispatcher.dispatchBeforeToolCall).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            apiName: 'search_tweets',
            callIndex: 1,
            identifier: 'twitter',
          }),
        );

        // afterToolCall dispatched via dispatch()
        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'afterToolCall',
          expect.objectContaining({
            apiName: 'search_tweets',
            identifier: 'twitter',
            mocked: false,
            success: true,
          }),
          undefined,
        );
      });

      it('should skip real execution when beforeToolCall returns mock', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi
            .fn()
            .mockResolvedValue({ content: '{"mocked":true}', isMocked: true }),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        await executors.call_tool!(createToolInstruction(), createToolState());

        // Real tool should NOT have been called
        expect(mockToolExecutionService.executeTool).not.toHaveBeenCalled();

        // afterToolCall should report mocked: true
        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'afterToolCall',
          expect.objectContaining({ mocked: true, success: true }),
          undefined,
        );

        // Tool message should be persisted with mock content
        expect(mockMessageModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            content: '{"mocked":true}',
            role: 'tool',
          }),
        );
      });

      it('should dispatch onToolCallError when tool throws', async () => {
        mockToolExecutionService.executeTool.mockRejectedValue(new Error('Connection refused'));

        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        await executors.call_tool!(createToolInstruction(), createToolState());

        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'onToolCallError',
          expect.objectContaining({
            apiName: 'search_tweets',
            error: 'Connection refused',
            identifier: 'twitter',
          }),
          undefined,
        );
      });

      it('should derive callIndex from state.usage.tools.byTool', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        // First call: no prior usage → callIndex = 1
        const state1 = createToolState();
        await executors.call_tool!(createToolInstruction(), state1);

        expect(mockDispatcher.dispatchBeforeToolCall).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({ callIndex: 1 }),
        );

        // Second call: state reflects 1 prior call → callIndex = 2
        const state2 = createToolState({
          usage: {
            ...createMockUsage(),
            tools: {
              ...createMockUsage().tools,
              byTool: [{ calls: 1, errors: 0, name: 'twitter/search_tweets', totalTimeMs: 100 }],
              totalCalls: 1,
            },
          },
        });
        await executors.call_tool!(createToolInstruction(), state2);

        expect(mockDispatcher.dispatchBeforeToolCall).toHaveBeenLastCalledWith(
          'op-123',
          expect.objectContaining({ callIndex: 2 }),
        );
      });

      it('should work without hookDispatcher (backward compat)', async () => {
        const executors = createRuntimeExecutors(ctx); // no hookDispatcher
        const result = await executors.call_tool!(createToolInstruction(), createToolState());

        expect(result).toBeDefined();
        expect(mockToolExecutionService.executeTool).toHaveBeenCalled();
      });
    });

    describe('compress_context hooks', () => {
      it('should dispatch beforeCompact and afterCompact hooks', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = {
          ...ctx,
          hookDispatcher: mockDispatcher as any,
          topicId: 'topic-123',
        };
        const executors = createRuntimeExecutors(ctxWithHooks);

        const state = createToolState({ metadata: { agentId: 'agent-123', topicId: 'topic-123' } });

        const instruction = {
          payload: {
            currentTokenCount: 5000,
            messages: [
              { content: 'hello', id: 'msg-1', role: 'user' },
              { content: 'hi there', id: 'msg-2', role: 'assistant' },
            ],
          },
          type: 'compress_context' as const,
        };

        await executors.compress_context!(instruction, state);

        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'beforeCompact',
          expect.objectContaining({ tokenCount: 5000 }),
          undefined,
        );
      });
    });

    describe('request_human_approve hooks', () => {
      it('should dispatch beforeHumanIntervention hook', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        const state = createToolState({
          messages: [{ content: '', id: 'asst-1', role: 'assistant' }],
          status: 'running',
        });

        const instruction = {
          pendingToolsCalling: [
            {
              apiName: 'post_tweet',
              arguments: '{}',
              id: 'tc-1',
              identifier: 'twitter',
              type: 'default' as const,
            },
          ],
          type: 'request_human_approve' as const,
        };

        await executors.request_human_approve!(instruction, state);

        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'beforeHumanIntervention',
          expect.objectContaining({
            pendingTools: [{ apiName: 'post_tweet', identifier: 'twitter' }],
          }),
          undefined, // serializedHooks from state.metadata._hooks
        );
      });
    });
  });

  // ─── callAgent server-side exec_sub_agent fix ──────────────────────────────
  describe('call_tool → exec_sub_agent (callAgent async mode)', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'parent-agent-id',
        topicId: 'topic-123',
      },
      modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    it('call_tool preserves stop:true for legacy execSubAgent state', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'Legacy async task result',
        executionTime: 10,
        state: {
          parentMessageId: 'tool-msg-id',
          task: {
            description: 'Call agent target-agent',
            instruction: 'Do something',
            targetAgentId: 'target-agent-id',
            timeout: 1_800_000,
          },
          type: 'execSubAgent',
        },
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-id',
          toolCalling: {
            apiName: 'callAgent',
            arguments: JSON.stringify({
              agentId: 'target-agent-id',
              instruction: 'Do something',
              runAsTask: true,
            }),
            id: 'tool-call-1',
            identifier: 'lobe-agent-management',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(result.nextContext?.phase).toBe('tool_result');
      expect((result.nextContext?.payload as any).stop).toBe(true);
    });

    it('call_tool lets server callAgent run as a deferred tool via the subAgent runner', async () => {
      const mockExecVirtualSubAgent = vi
        .fn()
        .mockResolvedValue({ success: true, operationId: 'child-op', threadId: 'thread-child' });
      const ctxWithCallback = {
        ...ctx,
        execVirtualSubAgent: mockExecVirtualSubAgent,
        topicId: 'topic-123',
      };

      mockMessageModel.create.mockResolvedValueOnce({ id: 'tool-msg-id' });
      mockToolExecutionService.executeTool.mockImplementation(
        async (_payload: any, context: any) => {
          const subAgent = await context.subAgent.run({
            agentId: 'target-agent-id',
            description: 'Call agent target-agent',
            instruction: 'Do something useful',
            timeout: 1_800_000,
          });

          return {
            content: '',
            deferred: true,
            executionTime: 10,
            state: {
              status: 'pending',
              subOperationId: subAgent.subOperationId,
              targetAgentId: 'target-agent-id',
              threadId: subAgent.threadId,
            },
            success: subAgent.started,
          };
        },
      );

      const executors = createRuntimeExecutors(ctxWithCallback);
      const state = createMockState();
      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-id',
          toolCalling: {
            apiName: 'callAgent',
            arguments: JSON.stringify({
              agentId: 'target-agent-id',
              instruction: 'Do something useful',
              runAsTask: true,
            }),
            id: 'tool-call-1',
            identifier: 'lobe-agent-management',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'parent-agent-id',
          plugin: expect.objectContaining({
            apiName: 'callAgent',
            identifier: 'lobe-agent-management',
          }),
          pluginState: { status: 'pending' },
          parentId: 'assistant-msg-id',
          role: 'tool',
          tool_call_id: 'tool-call-1',
          topicId: 'topic-123',
        }),
      );
      expect(mockExecVirtualSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'target-agent-id',
          instruction: 'Do something useful',
          parentMessageId: 'tool-msg-id',
          parentOperationId: 'op-123',
          title: 'Call agent target-agent',
          topicId: 'topic-123',
        }),
      );
      expect(result.newState.status).toBe('waiting_for_async_tool');
      expect(result.newState.pendingToolsCalling).toEqual([
        expect.objectContaining({
          apiName: 'callAgent',
          id: 'tool-call-1',
          identifier: 'lobe-agent-management',
        }),
      ]);
      expect(result.events).toEqual([
        expect.objectContaining({
          canResume: true,
          reason: 'async_tool',
          type: 'interrupted',
        }),
      ]);
      expect(result.nextContext).toBeUndefined();
    });

    it('exec_sub_agent executor creates task message and calls execSubAgent callback', async () => {
      const mockExecSubAgent = vi
        .fn()
        .mockResolvedValue({ success: true, operationId: 'child-op', threadId: 'thread-child' });
      const ctxWithCallback = {
        ...ctx,
        execSubAgent: mockExecSubAgent,
        topicId: 'topic-123',
      };

      const executors = createRuntimeExecutors(ctxWithCallback);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'tool-msg-id',
          task: {
            description: 'Call agent target-agent',
            instruction: 'Do something useful',
            targetAgentId: 'target-agent-id',
            timeout: 1_800_000,
          },
        },
        type: 'exec_sub_agent' as const,
      };

      const result = await executors.exec_sub_agent!(instruction as any, state);

      // Task message created with role:'task'
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'parent-agent-id',
          metadata: expect.objectContaining({
            targetAgentId: 'target-agent-id',
          }),
          role: 'task',
          parentId: 'tool-msg-id',
          topicId: 'topic-123',
        }),
      );

      // execSubAgent callback fired with targetAgentId
      expect(mockExecSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'target-agent-id',
          instruction: 'Do something useful',
          topicId: 'topic-123',
          parentOperationId: 'op-123',
        }),
      );

      // Returns sub_agent_result so GeneralChatAgent continues with LLM call
      expect(result.nextContext?.phase).toBe('sub_agent_result');
    });

    it('exec_sub_agent blocks nested dispatch when current state is already a sub-agent', async () => {
      const mockExecSubAgent = vi.fn();
      const ctxWithCallback = {
        ...ctx,
        execSubAgent: mockExecSubAgent,
        topicId: 'topic-123',
      };

      const executors = createRuntimeExecutors(ctxWithCallback);
      const state = createMockState({
        metadata: {
          agentId: 'parent-agent-id',
          isSubAgent: true,
          topicId: 'topic-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'tool-msg-id',
          task: {
            description: 'Nested call',
            instruction: 'Do nested work',
            targetAgentId: 'target-agent-id',
          },
        },
        type: 'exec_sub_agent' as const,
      };

      const result = await executors.exec_sub_agent!(instruction as any, state);

      expect(result.nextContext?.phase).toBe('sub_agent_result');
      expect((result.nextContext?.payload as any).result).toMatchObject({
        error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
        success: false,
      });
      expect(mockMessageModel.create).not.toHaveBeenCalled();
      expect(mockExecSubAgent).not.toHaveBeenCalled();
    });

    it('exec_sub_agent gracefully skips dispatch when execSubAgent not injected', async () => {
      // No callback injected (e.g. in tests that don't set it up)
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'tool-msg-id',
          task: {
            description: 'Call agent target-agent',
            instruction: 'Do something',
            targetAgentId: 'target-agent-id',
          },
        },
        type: 'exec_sub_agent' as const,
      };

      const result = await executors.exec_sub_agent!(instruction as any, state);

      // Should still return sub_agent_result (not crash)
      expect(result.nextContext?.phase).toBe('sub_agent_result');
      // Task message still created for UI
      expect(mockMessageModel.create).toHaveBeenCalled();
    });
  });
});
