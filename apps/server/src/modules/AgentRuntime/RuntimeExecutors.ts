import {
  type AgentEvent,
  type AgentInstruction,
  type AgentInstructionCompressContext,
  type AgentInstructionExecSubAgent,
  type AgentInstructionExecSubAgents,
  type AgentRuntimeContext,
  type AgentState,
  type CallLLMPayload,
  compressContextHierarchically,
  type ContextBudgetEvaluation,
  type GeneralAgentCallLLMResultPayload,
  type GeneralAgentCompressionResultPayload,
  type InstructionExecutor,
  runContextBudgetedCall,
  UsageCounter,
} from '@lobechat/agent-runtime';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import {
  type ComposioServiceSummary,
  type CredSummary,
  generateComposioServicesList,
  generateCredsList,
} from '@lobechat/builtin-tool-creds';
import { LocalSystemIdentifier, LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import {
  type AgentContextDocument,
  type AgentGroupConfig,
  type BotPlatformContext,
  buildStepSkillDelta,
  buildStepToolDelta,
  countContextTokens,
  type LobeToolManifest,
  type OnboardingContext,
  type OperationToolSet,
  type ResolvedToolSet,
  resolveTopicReferences,
  type SkillMeta,
  SkillResolver,
  stripContextMessageIdentity,
  ToolNameResolver,
  ToolResolver,
} from '@lobechat/context-engine';
import { parse } from '@lobechat/conversation-flow';
import {
  applyModelExtendParams,
  type ChatStreamPayload,
  consumeStreamUntilDone,
  type ModelExtendParams,
} from '@lobechat/model-runtime';
import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
} from '@lobechat/observability-otel/api';
import {
  buildChatRequestAttributes,
  buildChatResponseAttributes,
  buildContextEngineeringAttributes,
  buildExecuteToolAttributes,
  buildExecuteToolResultAttributes,
  chatSpanName,
  CONTEXT_ENGINEERING_SPAN_NAME,
  executeToolSpanName,
  type ToolType,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { chainCompressContext } from '@lobechat/prompts';
import {
  type ChatToolPayload,
  type ExecSubAgentParams,
  type ExecVirtualSubAgentParams,
  type MessageToolCall,
  TraceNameMap,
  type UIChatMessage,
} from '@lobechat/types';
import type { ContextCompressionOutcome } from '@lobechat/types/src/contextBudget';
import type {
  ExecutionContext,
  ToolCallExecutionContext,
} from '@lobechat/types/src/executionContext';
import type {
  ContextWindowRejectionObservation,
  ModelCatalogSnapshot,
} from '@lobechat/types/src/modelCatalog';
import type { TopicExecutionSnapshot, WorkspaceRef } from '@lobechat/types/src/projectWorkspace';
import {
  isLocalOrPrivateUrl,
  sanitizeToolCallArguments,
  serializePartsForStorage,
} from '@lobechat/utils';
import debug from 'debug';
import type { ExtendParamsType } from 'model-bank';

import { composioEnv } from '@/config/composio';
import { FileModel } from '@/database/models/file';
import { type MessageModel, MessageModel as MessageModelClass } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { type LobeChatDatabase } from '@/database/type';
import { fileEnv } from '@/envs/file';
import { isAbsoluteFilesystemPath } from '@/helpers/executionContext';
import { type ExecutionPlan, isDeviceCapablePlan } from '@/helpers/executionTarget';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { type EvalContext } from '@/server/modules/Mecha/ContextEngineering/types';
import type {
  createTraceOptions as CreateTraceOptionsFn,
  initModelRuntimeFromDB as InitModelRuntimeFromDBFn,
} from '@/server/modules/ModelRuntime';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import type { HookDispatcher } from '@/server/services/agentRuntime/hooks/HookDispatcher';
import type {
  ExecGroupMemberParams,
  ExecGroupMemberResult,
} from '@/server/services/agentRuntime/types';
import {
  type DeviceAccessReason,
  isDeviceToolIdentifier,
  logDeviceToolAudit,
} from '@/server/services/aiAgent/deviceToolAudit';
import { FileService } from '@/server/services/file';
import { MessageService } from '@/server/services/message';
import { OnboardingService } from '@/server/services/onboarding';
import {
  type ServerAgentMemberRunner,
  type ServerSubAgentRunner,
  type ToolExecutionResultResponse,
  type ToolExecutionService,
} from '@/server/services/toolExecution';
import { archiveToolResultIfNeeded } from '@/server/services/toolExecution/archiveToolResult';
import { validateSkillActivationResult } from '@/server/services/toolExecution/skillActivationResult';
import { toAgentContextDocuments } from '@/utils/agentDocumentContextMapping';
import { nanoid } from '@/utils/uuid';

import { FinalContextWindowError } from './contextWindowPreflight';
import { dispatchClientTool } from './dispatchClientTool';
import { formatErrorEventData } from './formatErrorEventData';
import { classifyLLMError, type LLMErrorKind } from './llmErrorClassification';
import {
  createConversationParentMissingError,
  isMidOperationReferenceMissingError,
  isPersistFatal,
  markPersistFatal,
} from './messagePersistErrors';
import { ModelEmptyError } from './ModelEmptyError';
import { resolveToolTimeoutMs } from './resolveToolTimeout';
import { type IStreamEventManager } from './types';
import {
  buildPendingWorkspacePathConsent,
  getPostDispatchWorkspacePathConsent,
  requiresPrimaryCwdForTool,
} from './workspacePathConsent';

const log = debug('lobe-server:agent-runtime:streaming-executors');
const timing = debug('lobe-server:agent-runtime:timing');
const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

const recordActivatedSkill = (
  state: AgentState,
  skill: Pick<SkillMeta, 'key' | 'identifier'>,
  content: string,
) => {
  const key = skill.key;
  state.activatedStepSkills = [
    ...(state.activatedStepSkills ?? []).filter((entry) => entry.key !== key),
    { key, identifier: skill.identifier, content, activatedAtStep: state.stepCount },
  ];
};

// Tool pricing configuration (USD per call)
const TOOL_PRICING: Record<string, number> = {
  'lobe-web-browsing/craw': 0,
  'lobe-web-browsing/search': 0,
};

const TOOL_MAX_RETRIES = 2;
const LLM_MAX_RETRIES = 5;
const LLM_RETRY_BASE_DELAY_MS = 1000;
const LLM_RETRY_MAX_DELAY_MS = 30_000;

/**
 * Retry budget for empty completions, applied independently of
 * `resolveLLMMaxRetries`. The branded provider gets 0 general retries because
 * its own fallback chain already re-routes failed requests — but an
 * HTTP-200-but-empty turn never triggered that chain, so it must still be
 * re-issued. A small budget is enough: empty turns almost always self-heal on
 * the first retry.
 */
const EMPTY_COMPLETION_MAX_RETRIES = 2;

const buildBotAgentGroupContext = (params: {
  agentConfig?: any;
  agentId?: string;
  botContext?: unknown;
}): AgentGroupConfig | undefined => {
  if (!params.botContext || !params.agentId) return undefined;

  const title = params.agentConfig?.title;
  const description = params.agentConfig?.description;
  const name = typeof title === 'string' && title.trim() ? title.trim() : 'Current Agent';

  return {
    agentMap: {
      [params.agentId]: {
        name,
        role: 'participant',
      },
    },
    currentAgentId: params.agentId,
    currentAgentName: name,
    currentAgentRole: 'participant',
    members: [
      {
        id: params.agentId,
        name,
        role: 'participant',
      },
    ],
    systemPrompt: typeof description === 'string' ? description : undefined,
  };
};

/**
 * Output-token count at or below this — combined with no content, reasoning,
 * tool calls, or images — marks a turn as an empty completion.
 * The observed failure case reported `out=1 token`.
 */
const EMPTY_COMPLETION_MAX_OUTPUT_TOKENS = 1;

/**
 * Detect the "empty completion" failure mode: the model returns a
 * turn with no text, no reasoning, no tool calls, no images, and ~0 output
 * tokens — typically after a stalled tool loop where it effectively gives up.
 * Callers throw `ModelEmptyError` on a hit so the LLM retry loop re-attempts
 * instead of silently finalizing to `done` with a blank assistant message.
 */
const isEmptyModelCompletion = (params: {
  content: string;
  imageCount: number;
  outputTokens: number | undefined;
  reasoning: string;
  toolCallCount: number;
}): boolean => {
  const { content, reasoning, toolCallCount, imageCount, outputTokens } = params;

  if (content.trim().length > 0) return false;
  if (reasoning.trim().length > 0) return false;
  if (toolCallCount > 0) return false;
  if (imageCount > 0) return false;

  // When the provider reports output tokens, only treat as empty if it's ~0.
  // Guards against rare cases where structured output we don't accumulate into
  // `content`/`reasoning` here (e.g. grounding) still consumed real tokens.
  if (typeof outputTokens === 'number' && outputTokens > EMPTY_COMPLETION_MAX_OUTPUT_TOKENS) {
    return false;
  }

  return true;
};

type ReasoningReplayNode = {
  children?: ReasoningReplayNode[];
  members?: ReasoningReplayNode[];
  reasoning?: unknown;
};

const stripAssistantReasoningForReplay = (messages: UIChatMessage[]): UIChatMessage[] => {
  const stripMessage = <T extends ReasoningReplayNode>(message: T): T => {
    let changed = false;

    const children = message.children?.map((child) => {
      const strippedChild = stripMessage(child);
      if (strippedChild !== child) changed = true;
      return strippedChild;
    });

    const members = message.members?.map((member) => {
      const strippedMember = stripMessage(member);
      if (strippedMember !== member) changed = true;
      return strippedMember;
    });

    if ('reasoning' in message) changed = true;
    if (!changed) return message;

    const { reasoning: _reasoning, ...messageWithoutReasoning } = message;

    return {
      ...messageWithoutReasoning,
      ...(children ? { children } : {}),
      ...(members ? { members } : {}),
    } as T;
  };

  let changed = false;

  const strippedMessages = messages.map((message) => {
    const strippedMessage = stripMessage(message);
    if (strippedMessage !== message) changed = true;
    return strippedMessage;
  });

  return changed ? strippedMessages : messages;
};

const GEN_AI_FUNCTION_TOOL_TYPE: ToolType = 'function';

type ToolFailureKind = 'replan' | 'retry' | 'stop';

const getToolFailureKind = (result: ToolExecutionResultResponse): ToolFailureKind | undefined => {
  if (!result.error || typeof result.error !== 'object') return;

  const { kind } = result.error as { kind?: unknown };
  return kind === 'replan' || kind === 'retry' || kind === 'stop' ? kind : undefined;
};

const shouldRetryTool = (kind: ToolFailureKind | undefined, attempt: number, maxRetries: number) =>
  kind === 'retry' && attempt <= maxRetries;

const getDeterministicToolFailureKey = (
  toolName: string,
  result: ToolExecutionResultResponse,
): string | undefined => {
  if (result.success || getToolFailureKind(result) === 'retry') return;

  try {
    return `${toolName}:${JSON.stringify(result.error ?? result.content)}`;
  } catch {
    return `${toolName}:${String(result.error ?? result.content)}`;
  }
};

const archiveRuntimeToolResult = async (
  result: ToolExecutionResultResponse,
  {
    agentId,
    identifier,
    limit,
    serverDB,
    toolCallId,
    topicId,
    userId,
    workspaceId,
  }: {
    agentId?: string | null;
    identifier?: string;
    limit?: number;
    serverDB: LobeChatDatabase;
    toolCallId?: string;
    topicId?: string | null;
    userId?: string;
    workspaceId?: string;
  },
): Promise<ToolExecutionResultResponse> => {
  const archive = await archiveToolResultIfNeeded({
    agentId,
    content: result.content,
    identifier,
    limit,
    serverDB,
    toolCallId,
    topicId,
    userId,
    workspaceId,
  });

  return archive.content === result.content ? result : { ...result, content: archive.content };
};

// Builds a postProcessUrl callback that resolves keys in file-backed fields
// (imageList, videoList, fileList) to externally accessible URLs. Must be
// passed to every messageModel.query() call whose output is later fed to the
// LLM — otherwise the provider layer receives raw keys like
// `files/user_xxx/icon.png` and rejects them.
//
// FileService is constructed lazily so environments without S3 config (unit
// tests) don't fail at context-build time; failure returns undefined, which
// leaves URLs as raw keys — same behavior as before this helper existed.
const buildPostProcessUrl = (
  ctx: Pick<RuntimeExecutorContext, 'serverDB' | 'userId' | 'workspaceId'>,
) => {
  const userId = ctx.userId;
  if (!userId || !ctx.serverDB) return undefined;
  let fileService: FileService | undefined;
  try {
    fileService = new FileService(ctx.serverDB, userId, ctx.workspaceId);
  } catch {
    return undefined;
  }
  return (path: string | null, file: { id?: string | null }) =>
    fileService!.getFileAccessUrl({ id: file.id, url: path });
};

const extractFileProxyId = (url?: string | null) => {
  if (!url) return undefined;

  try {
    const { pathname } = new URL(url);
    return pathname.startsWith('/f/') ? decodeURIComponent(pathname.slice(3)) : undefined;
  } catch {
    return url.startsWith('/f/') ? decodeURIComponent(url.slice(3)) : undefined;
  }
};

const shouldInlineProviderImageUrl = (url?: string | null) => {
  if (!url || url.startsWith('data:')) return false;

  return !!extractFileProxyId(url) || isLocalOrPrivateUrl(url);
};

const buildProviderImageDataUrlResolver = (
  ctx: Pick<RuntimeExecutorContext, 'serverDB' | 'userId' | 'workspaceId'>,
  workspaceId?: string,
) => {
  const userId = ctx.userId;
  if (!userId || !ctx.serverDB) return undefined;

  let fileModel: FileModel | undefined;
  let fileService: FileService | undefined;
  const cache = new Map<string, Promise<string | undefined>>();

  return (fileId: string) => {
    if (!cache.has(fileId)) {
      cache.set(
        fileId,
        (async () => {
          fileModel ??= new FileModel(ctx.serverDB, userId, workspaceId ?? ctx.workspaceId);
          fileService ??= new FileService(ctx.serverDB, userId, workspaceId ?? ctx.workspaceId);
          const file = await fileModel.findById(fileId);
          if (!file?.url || !file.fileType?.startsWith('image')) return undefined;

          const bytes = await fileService.getFileByteArray(file.url);
          return `data:${file.fileType};base64,${Buffer.from(bytes).toString('base64')}`;
        })().catch((error) => {
          log('Failed to inline image attachment %s for provider payload: %O', fileId, error);
          return undefined;
        }),
      );
    }

    return cache.get(fileId)!;
  };
};

const buildProviderImageFileIdLookup = (messages: UIChatMessage[]) => {
  const lookup = new Map<string, string>();

  for (const message of messages) {
    for (const image of message.imageList ?? []) {
      const fileId = extractFileProxyId(image.url) || image.id;
      if (fileId && image.url) lookup.set(image.url, fileId);
    }
  }

  return lookup;
};

const inlineProviderImageContentParts = async (
  messages: ChatStreamPayload['messages'],
  sourceMessages: UIChatMessage[],
  resolveImageDataUrl?: (fileId: string) => Promise<string | undefined>,
) => {
  if (!resolveImageDataUrl) return messages;

  let changed = false;
  const forceImageBase64 = process.env.LLM_VISION_IMAGE_USE_BASE64 === '1';
  const imageFileIdLookup = buildProviderImageFileIdLookup(sourceMessages);

  const nextMessages = await Promise.all(
    messages.map(async (message) => {
      if (!Array.isArray(message.content)) return message;

      let messageChanged = false;
      const content = await Promise.all(
        message.content.map(async (part: any) => {
          if (part?.type !== 'image_url') return part;

          const url = part.image_url?.url;
          if (!url || url.startsWith('data:')) return part;

          const fileId = extractFileProxyId(url) || imageFileIdLookup.get(url);
          if (!fileId) return part;

          if (!forceImageBase64 && !shouldInlineProviderImageUrl(url)) return part;

          const dataUrl = await resolveImageDataUrl(fileId);
          if (!dataUrl) return part;

          messageChanged = true;
          return { ...part, image_url: { ...part.image_url, url: dataUrl } };
        }),
      );

      if (!messageChanged) return message;

      changed = true;
      return { ...message, content };
    }),
  );

  return changed ? nextMessages : messages;
};

const PROVIDER_VISUAL_INPUT_TOKEN_ESTIMATE = 1000;

/**
 * Build redacted accounting records from the exact provider message shape.
 * URLs and base64 bytes deliberately never leave this function.
 */
export const collectProviderMediaTokenEstimates = (
  messages: Readonly<ChatStreamPayload['messages']>,
  sourceMessages: UIChatMessage[] = [],
) => {
  const fileIdLookup = buildProviderImageFileIdLookup(sourceMessages);
  const estimates: Array<{ estimatedTokens: number; id: string; messageId?: string }> = [];

  messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.content)) return;

    message.content.forEach((part: any, partIndex) => {
      if (part?.type !== 'image_url' && part?.type !== 'video_url') return;

      const url = part.image_url?.url ?? part.video_url?.url;
      const messageId = typeof (message as any).id === 'string' ? (message as any).id : undefined;
      estimates.push({
        estimatedTokens: PROVIDER_VISUAL_INPUT_TOKEN_ESTIMATE,
        id:
          (typeof url === 'string' && fileIdLookup.get(url)) ||
          `${messageId ?? `message-${messageIndex}`}:media-${partIndex}`,
        messageId,
      });
    });
  });

  return estimates;
};

export const resolveCompressionSummaryBudgetTokens = (params: {
  compressionModel: { model: string; provider: string };
  compressionModelCatalogSnapshot?: ModelCatalogSnapshot;
  mainModelCatalogSnapshot?: ModelCatalogSnapshot;
}) => {
  const { compressionModel, compressionModelCatalogSnapshot, mainModelCatalogSnapshot } = params;
  const matchingSnapshot = [compressionModelCatalogSnapshot, mainModelCatalogSnapshot].find(
    (snapshot) =>
      snapshot?.entry.modelId === compressionModel.model &&
      snapshot.entry.providerId === compressionModel.provider,
  );

  // Keep room for the summary output even on unusually small catalog windows.
  // A fixed 2k floor could make the request budget larger than the model's
  // actual prompt capacity and recreate the context error during recovery.
  return Math.max(1, (matchingSnapshot?.entry.contextWindowTokens ?? 32_000) - 1024);
};

const renderMessageForCompression = (message: UIChatMessage) => {
  const content = Array.isArray(message.content)
    ? message.content.map((part: any) => {
        if (part?.type === 'image_url') return '[image attachment]';
        if (part?.type === 'video_url') return '[video attachment]';
        return part?.text ?? part;
      })
    : message.content;

  return `${message.role}: ${typeof content === 'string' ? content : JSON.stringify(content)}`;
};

/**
 * Build the per-tool-call server virtual sub-agent runner injected into the tool
 * execution context. Closes over the current tool payload + parent message so
 * the `callSubAgent` server tool can fork a child op without re-deriving the
 * message anchor (which it cannot do correctly from its own context).
 *
 * The runner creates the pending placeholder tool message that anchors the
 * isolation thread (so the UI shows a loading state and the completion bridge
 * has a message to backfill), then kicks off the child op asynchronously and
 * returns immediately. Returns `undefined` when virtual sub-agent execution is
 * not available (no `execVirtualSubAgent` callback, or missing agent/topic
 * context).
 */
const buildServerVirtualSubAgentRunner = (
  ctx: RuntimeExecutorContext,
  state: AgentState,
  chatToolPayload: ChatToolPayload,
  parentMessageId: string,
): ServerSubAgentRunner | undefined => {
  const execVirtualSubAgent = ctx.execVirtualSubAgent;
  if (!execVirtualSubAgent) return undefined;

  const agentId = state.metadata?.agentId;
  const topicId = ctx.topicId ?? state.metadata?.topicId;
  if (!agentId || !topicId) return undefined;

  return {
    run: async ({ agentId: targetAgentId, description, instruction, timeout }) => {
      // 1. Create the pending placeholder tool message (mirrors the normal
      //    tool-message shape in call_tool) that anchors the isolation thread
      //    and renders a loading state until the bridge backfills it.
      const placeholder = await ctx.messageModel.create({
        agentId,
        content: '',
        parentId: parentMessageId,
        plugin: chatToolPayload as any,
        pluginState: { status: 'pending' },
        role: 'tool',
        threadId: state.metadata?.threadId,
        tool_call_id: chatToolPayload.id,
        topicId,
      });

      // 2. Fork the virtual child op anchored to the placeholder. The virtual
      //    entry marks the child as `isSubAgent` and registers the completion
      //    bridge that backfills this tool message and resumes the parent op.
      const result = (await execVirtualSubAgent({
        agentId: targetAgentId ?? agentId,
        groupId: state.metadata?.groupId ?? undefined,
        instruction,
        parentMessageId: placeholder.id,
        parentOperationId: ctx.operationId,
        timeout,
        title: description,
        topicId,
      })) as { operationId?: string; success?: boolean; threadId?: string } | undefined;

      // 3. If the child op never started, no completion bridge will fire — parking
      //    the parent on it would hang forever. Drop the placeholder and signal
      //    `started: false` so callSubAgent surfaces an inline tool error instead.
      if (!result?.success) {
        try {
          await ctx.messageModel.deleteMessage(placeholder.id);
        } catch (error) {
          log(
            'buildServerVirtualSubAgentRunner: failed to clean up placeholder %s: %O',
            placeholder.id,
            error,
          );
        }
        return { started: false, subOperationId: result?.operationId, threadId: '' };
      }

      return {
        started: true,
        subOperationId: result?.operationId,
        threadId: result?.threadId ?? '',
      };
    },
  };
};

/**
 * Build the per-tool "call agent member" runner for the group orchestration
 * server tool (`lobe-group-management`). Mirrors {@link buildServerVirtualSubAgentRunner}
 * but for group members: it owns the group tool message (the parked tool call)
 * and the per-member anchors that drive the K=N member barrier.
 *
 * For each `agentMember.run(...)` it:
 *   1. creates the group tool placeholder (`tool_call_id` = the group-management
 *      call id) stamped with the barrier target + finish disposition;
 *   2. for a single member uses that placeholder as the member anchor; for
 *      multiple members creates one child anchor per member under it;
 *   3. forks each member via `ctx.execGroupMember` (in-group or isolated);
 *   4. backfills anchors for members that failed to start so the barrier can
 *      still complete, and tears everything down when none started.
 *
 * Returns `undefined` when group-member execution is unavailable (no
 * `execGroupMember` callback, or missing agent/topic/group context).
 */
const buildServerAgentMemberRunner = (
  ctx: RuntimeExecutorContext,
  state: AgentState,
  chatToolPayload: ChatToolPayload,
  parentMessageId: string,
): ServerAgentMemberRunner | undefined => {
  const execGroupMember = ctx.execGroupMember;
  if (!execGroupMember) return undefined;

  const agentId = state.metadata?.agentId;
  const topicId = ctx.topicId ?? state.metadata?.topicId;
  const groupId = state.metadata?.groupId ?? undefined;
  if (!agentId || !topicId || !groupId) return undefined;

  return {
    run: async ({ members, mode, onComplete, disableTools, timeout }) => {
      const expectedMembers = members.length;
      if (expectedMembers === 0) return { started: false, startedCount: 0 };

      // 1. Group tool placeholder — the parked tool call the supervisor op waits
      //    on. Stamped with the barrier target + finish disposition so the resume
      //    path (and verify watchdog) resolve resume-vs-finish on their own.
      const groupTool = await ctx.messageModel.create({
        agentId,
        content: '',
        parentId: parentMessageId,
        plugin: chatToolPayload as any,
        pluginState: { expectedMembers, onComplete, status: 'pending' },
        role: 'tool',
        threadId: state.metadata?.threadId,
        tool_call_id: chatToolPayload.id,
        topicId,
      });

      // 2. Per-member anchors. A single member collapses onto the group tool
      //    message; multiple members each get a child anchor under it.
      const anchorIds: string[] = [];
      if (expectedMembers === 1) {
        anchorIds.push(groupTool.id);
      } else {
        for (let i = 0; i < expectedMembers; i += 1) {
          const memberToolCallId = `${chatToolPayload.id}::m${i}`;
          const anchor = await ctx.messageModel.create({
            agentId,
            content: '',
            parentId: groupTool.id,
            plugin: { ...(chatToolPayload as any), id: memberToolCallId },
            pluginState: { status: 'pending' },
            role: 'tool',
            threadId: state.metadata?.threadId,
            tool_call_id: memberToolCallId,
            topicId,
          });
          anchorIds.push(anchor.id);
        }
      }

      // 3. Fork members.
      let startedCount = 0;
      await Promise.all(
        members.map(async (member, i) => {
          const anchorMessageId = anchorIds[i];
          try {
            const result = await execGroupMember({
              agentId: member.agentId,
              anchorMessageId,
              disableTools,
              expectedMembers,
              groupId,
              groupToolMessageId: groupTool.id,
              instruction: member.instruction,
              mode,
              onComplete,
              parentOperationId: ctx.operationId,
              timeout,
              topicId,
            });
            if (result?.started) {
              startedCount += 1;
              return;
            }
          } catch (error) {
            log(
              'buildServerAgentMemberRunner: member %s failed to start: %O',
              member.agentId,
              error,
            );
          }
          // Member failed to start — its completion bridge will never fire, so
          // backfill the anchor as errored to keep the K=N barrier reachable.
          try {
            await ctx.messageModel.updateToolMessage(anchorMessageId, {
              content: `Agent member "${member.agentId}" failed to start.`,
              pluginState: { status: 'error' },
            });
          } catch (error) {
            log(
              'buildServerAgentMemberRunner: failed to mark anchor %s as errored: %O',
              anchorMessageId,
              error,
            );
          }
        }),
      );

      // None started — no bridge will ever fire, so tear down the placeholders
      // and let the caller surface an inline tool error instead of parking.
      if (startedCount === 0) {
        for (const id of new Set([...anchorIds, groupTool.id])) {
          try {
            await ctx.messageModel.deleteMessage(id);
          } catch (error) {
            log('buildServerAgentMemberRunner: cleanup failed for %s: %O', id, error);
          }
        }
        return { started: false, startedCount: 0 };
      }

      return { started: true, startedCount };
    },
  };
};

const shouldRetryLLM = (kind: LLMErrorKind, attempt: number, maxRetries: number) =>
  kind === 'retry' && attempt <= maxRetries;

const resolveLLMMaxRetries = (provider: string) =>
  // The branded provider already routes through its own fallback chain. Retrying
  // again here multiplies the same failed routed request across every channel.
  provider === BRANDING_PROVIDER ? 0 : LLM_MAX_RETRIES;

/**
 * Retry budget for a *specific* failed attempt. This is provider policy +
 * error-type override, so it can only be resolved once the error exists (in the
 * catch) — unlike {@link resolveLLMMaxRetries}, which runs before the request.
 *
 * Empty completions bypass the per-provider policy: the branded
 * provider's 0-retry rule exists to avoid re-routing its own already-failed
 * requests, but an HTTP-200-but-empty turn never hit that fallback chain, so it
 * must still be re-issued. Folding this into `resolveLLMMaxRetries` would wrongly
 * grant the floor to *every* branded error.
 */
const resolveLLMRetryBudget = (provider: string, error: unknown) =>
  error instanceof ModelEmptyError ? EMPTY_COMPLETION_MAX_RETRIES : resolveLLMMaxRetries(provider);

/** Loop bound — must accommodate the largest budget any error kind can request. */
const resolveLLMMaxAttempts = (provider: string) =>
  Math.max(resolveLLMMaxRetries(provider), EMPTY_COMPLETION_MAX_RETRIES) + 1;

const resolveRuntimeHistoryCount = (historyCount?: number) => {
  if (historyCount === undefined) return undefined;

  // Agent config stores historical message count, excluding the current turn.
  // Runtime executors already pass the current user/tool turn in `llmPayload.messages`;
  // without this +1, `historyCount: 0` truncates the current message too and sends
  // `messages: []` to providers.
  return historyCount + 1;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getStructuredRetryAfterMs = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return;

  const payload = error as { error?: unknown; retryAfterMs?: unknown };
  const direct = payload.retryAfterMs;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return direct;

  if (!payload.error || typeof payload.error !== 'object') return;
  const nested = (payload.error as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof nested === 'number' && Number.isFinite(nested) && nested >= 0) return nested;
};

const getLLMRetryDelayMs = (attempt: number, error?: unknown) => {
  const retryAfterMs = getStructuredRetryAfterMs(error);
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, LLM_RETRY_MAX_DELAY_MS);

  return Math.min(LLM_RETRY_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0), LLM_RETRY_MAX_DELAY_MS);
};

const isOperationInterrupted = async (ctx: RuntimeExecutorContext) => {
  if (!ctx.loadAgentState) return false;

  try {
    const latestState = await ctx.loadAgentState(ctx.operationId);
    return latestState?.status === 'interrupted';
  } catch (error) {
    console.error('[RuntimeExecutors] Failed to load operation state for retry guard:', error);
    return false;
  }
};

type ExecutionBudgetReason = 'max_steps' | 'time_limit' | 'token_limit';
type ExecutionStopReason = ExecutionBudgetReason | 'repeated_error';

class ExecutionBudgetExceededError extends Error {
  constructor(public readonly reason: ExecutionBudgetReason) {
    super(`Execution budget exceeded: ${reason}`);
    this.name = 'ExecutionBudgetExceededError';
  }
}

const getExecutionBudgetReason = (
  state: AgentState,
  projectedInputTokens = 0,
): ExecutionBudgetReason | undefined => {
  const budget = state.executionBudget ?? state.metadata?.executionBudget;
  if (!budget) return;

  if (state.stepCount >= budget.maxSteps) return 'max_steps';

  const createdAt = new Date(state.createdAt).getTime();
  if (Number.isFinite(createdAt) && Date.now() - createdAt >= budget.maxDurationMs) {
    return 'time_limit';
  }

  const consumedTokens = state.usage?.llm?.tokens?.total ?? 0;
  if (consumedTokens + projectedInputTokens > budget.maxTotalTokens) return 'token_limit';
};

const getRemainingExecutionTimeMs = (state: AgentState): number | undefined => {
  const budget = state.executionBudget ?? state.metadata?.executionBudget;
  if (!budget) return;

  const createdAt = new Date(state.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return budget.maxDurationMs;

  return Math.max(0, budget.maxDurationMs - (Date.now() - createdAt));
};

const clampToolTimeoutToExecutionBudget = (state: AgentState, timeoutMs: number) => {
  const remainingMs = getRemainingExecutionTimeMs(state);
  return remainingMs === undefined ? timeoutMs : Math.max(1, Math.min(timeoutMs, remainingMs));
};

const interruptForExecutionGuard = (
  state: AgentState,
  reason: ExecutionStopReason,
  interruptedInstruction?: AgentInstruction,
) => {
  const interruptedAt = new Date().toISOString();
  const interruptionReason =
    reason === 'repeated_error'
      ? 'Repeated deterministic tool error'
      : `Execution budget exceeded: ${reason}`;
  const newState = structuredClone(state);
  newState.status = 'interrupted';
  newState.lastModified = interruptedAt;
  newState.interruption = {
    canResume: true,
    interruptedAt,
    interruptedInstruction,
    reason: interruptionReason,
  };
  newState.metadata = { ...newState.metadata, executionBudgetCompletionReason: reason };

  return {
    events: [
      {
        canResume: true,
        interruptedAt,
        reason: interruptionReason,
        type: 'interrupted' as const,
      },
    ],
    newState,
  };
};

const executeToolWithRetry = async (
  execute: () => Promise<ToolExecutionResultResponse>,
  params: {
    isInterrupted?: () => Promise<boolean>;
    maxRetries: number;
    operationLogId: string;
    toolName: string;
  },
): Promise<{ attempts: number; result: ToolExecutionResultResponse }> => {
  const maxAttempts = params.maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await execute();

    if (result.success) return { attempts: attempt, result };

    const kind = getToolFailureKind(result);

    if (shouldRetryTool(kind, attempt, params.maxRetries)) {
      if (await params.isInterrupted?.()) {
        return { attempts: attempt, result };
      }

      log(
        '[%s] Tool %s failed with kind=%s (attempt %d/%d), retrying ...',
        params.operationLogId,
        params.toolName,
        kind,
        attempt,
        maxAttempts,
      );
      continue;
    }

    return { attempts: attempt, result };
  }

  throw new Error('Tool execution retry loop exited unexpectedly');
};

const buildToolDiscoveryConfig = (operationToolSet: OperationToolSet, enabledToolIds: string[]) => {
  const enabledToolSet = new Set(enabledToolIds);

  if (!enabledToolSet.has(LobeActivatorIdentifier)) return undefined;

  const availableTools = Object.entries(operationToolSet.manifestMap)
    .filter(([identifier]) => !enabledToolSet.has(identifier))
    .map(([identifier, manifest]) => ({
      description: manifest.meta?.description || '',
      identifier,
      name: manifest.meta?.title || identifier,
    }));

  if (availableTools.length === 0) return undefined;

  return { availableTools };
};

type InitModelRuntime = typeof InitModelRuntimeFromDBFn;
type CreateTraceOptions = typeof CreateTraceOptionsFn;

export interface RuntimeExecutorContext {
  agentConfig?: any;
  bindScratchAfterToolSuccess?: (params: {
    deviceId: string;
    rootPath: string;
    target?: 'device' | 'local';
    toolSucceeded: true;
    topicId: string;
  }) => Promise<{ snapshot: TopicExecutionSnapshot; workspace: WorkspaceRef }>;
  botContext?: unknown;
  botPlatformContext?: BotPlatformContext;
  /** Persist the operation-scoped terminal topic state. */
  completeTopicOperation?: (params: {
    operationId: string;
    status: 'active' | 'failed';
    topicId: string;
  }) => Promise<unknown>;
  /** External trace-export boundary, wired by AgentRuntimeService in production. */
  createTraceOptions?: CreateTraceOptions;
  discordContext?: any;
  ensureScratchWorkspace?: (params: {
    deviceId: string;
    topicId: string;
  }) => Promise<{ root: string }>;
  evalContext?: EvalContext;
  /**
   * Callback to fork a group member ("call agent member") under a
   * `lobe-group-management` tool call. Injected by AiAgentService; powers the
   * per-tool `agentMember` runner (in-group + isolated members, K=N barrier).
   */
  execGroupMember?: (params: ExecGroupMemberParams) => Promise<ExecGroupMemberResult>;
  /**
   * Callback to run a legacy agent invocation server-side.
   * Injected by AiAgentService so exec_sub_agent / exec_sub_agents executors
   * can dispatch callAgent-triggered runs without a circular import.
   */
  execSubAgent?: (params: ExecSubAgentParams) => Promise<unknown>;
  /**
   * Callback to fork a `lobe-agent.callSubAgent` virtual child run. Unlike
   * execSubAgent, this path installs the async completion bridge and marks the
   * child operation as a sub-agent.
   */
  execVirtualSubAgent?: (params: ExecVirtualSubAgentParams) => Promise<unknown>;
  hookDispatcher?: HookDispatcher;
  /** External model-provider boundary, wired by AgentRuntimeService in production. */
  initModelRuntime?: InitModelRuntime;
  loadAgentState?: (operationId: string) => Promise<AgentState | null>;
  messageModel: MessageModel;
  onContextWindowObserved?: (input: ContextWindowRejectionObservation) => Promise<void> | void;
  operationId: string;
  serverDB: LobeChatDatabase;
  stepIndex: number;
  stream?: boolean;
  streamManager: IStreamEventManager;
  toolExecutionService: ToolExecutionService;
  topicId?: string;
  /**
   * Trace-pipeline sink for context engine input/output. Wired by
   * AgentRuntimeService so the trace recorder can pick CE data up
   * out-of-band, keeping the heavy CE payload (agentDocuments, systemRole, …)
   * out of the `events` array and therefore out of the Redis state pipeline.
   *
   * Context: agent-runtime state blob was hitting Upstash Redis 10MB limit
   * because contextEngine.input (agentDocuments full inline) accounted for
   * ~83% of each step. Routing CE through this callback keeps the heavy
   * payload in trace only, reducing per-step Redis state from ~3.4MB to ~6KB.
   */
  tracingContextEngine?: (input: unknown, output: unknown) => void;
  userId?: string;
  userTimezone?: string;
  /**
   * Workspace scoping for ownership filters on models/services constructed
   * inside the agent runtime. Threaded down from the originating request
   * (chat/task router) and forwarded to tool executions via
   * `ToolExecutionContext.workspaceId`.
   */
  workspaceId?: string;
}

const requireRuntimeBoundary = <T>(boundary: T | undefined, name: string): T => {
  if (boundary) return boundary;
  throw new Error(`Runtime executor boundary "${name}" is not configured`);
};

const getFrozenExecutionContext = (state: AgentState): ExecutionContext | undefined =>
  state.metadata?.executionContext as ExecutionContext | undefined;

const resolveExecutionApprovalMode = (state: AgentState) =>
  state.userInterventionConfig?.approvalMode ?? getFrozenExecutionContext(state)?.approvalMode;

const requiresInteractivePathConsent = (state: AgentState): boolean =>
  !['auto-run', 'headless'].includes(resolveExecutionApprovalMode(state) ?? 'manual');

interface PreparedToolExecutionContext {
  executionContext?: ExecutionContext;
  scratchRoot?: string;
}

const withPrimaryScratchRoot = (
  executionContext: ExecutionContext,
  deviceId: string,
  rootPath: string,
): ExecutionContext => ({
  ...executionContext,
  accessRoots: [
    ...(executionContext.accessRoots ?? []).filter((root) => root.scope !== 'primary'),
    {
      deviceId,
      modes: ['exec', 'read', 'write'],
      rootPath,
      scope: 'primary',
      source: 'workspace',
    },
  ],
  cwd: rootPath,
  unresolvedReason: undefined,
  workspace: { deviceId, kind: 'scratch', rootPath },
});

/**
 * Lazily materialize a deterministic topic scratch root only for a tool that
 * actually needs a default cwd. Explicit absolute-path operations use their
 * grants directly and pure chat never reaches this seam.
 */
const prepareToolExecutionContext = async (
  ctx: RuntimeExecutorContext,
  state: AgentState,
  tool: ChatToolPayload,
): Promise<PreparedToolExecutionContext> => {
  const frozenExecutionContext = getFrozenExecutionContext(state);
  const executionContext = frozenExecutionContext
    ? {
        ...frozenExecutionContext,
        approvalMode: resolveExecutionApprovalMode(state),
      }
    : undefined;
  if (!requiresPrimaryCwdForTool({ executionContext, tool })) return { executionContext };
  if (!executionContext) throw new Error('WORKSPACE_REQUIRED');

  const topicId = ctx.topicId ?? state.metadata?.topicId;
  const deviceId =
    executionContext.plan.kind === 'device' ? executionContext.plan.deviceId : undefined;
  if (!topicId || !deviceId || !ctx.ensureScratchWorkspace) throw new Error('WORKSPACE_REQUIRED');

  const { root } = await ctx.ensureScratchWorkspace({ deviceId, topicId });
  if (!root || !isAbsoluteFilesystemPath(root)) throw new Error('WORKSPACE_REQUIRED');

  return {
    executionContext: withPrimaryScratchRoot(executionContext, deviceId, root),
    scratchRoot: root,
  };
};

const bindPreparedScratchContext = async (
  ctx: RuntimeExecutorContext,
  state: AgentState,
  prepared: PreparedToolExecutionContext,
): Promise<ExecutionContext | undefined> => {
  if (!prepared.scratchRoot || !prepared.executionContext) return prepared.executionContext;

  const topicId = ctx.topicId ?? state.metadata?.topicId;
  const plan = prepared.executionContext.plan;
  const deviceId = plan.kind === 'device' ? plan.deviceId : undefined;
  if (!topicId || !deviceId || !ctx.bindScratchAfterToolSuccess) {
    throw new Error('WORKSPACE_REQUIRED');
  }

  const bound = await ctx.bindScratchAfterToolSuccess({
    deviceId,
    rootPath: prepared.scratchRoot,
    target: plan.target === 'local' ? 'local' : 'device',
    toolSucceeded: true,
    topicId,
  });
  const authoritativePlan: ExecutionContext['plan'] =
    bound.workspace.kind === 'sandbox'
      ? { kind: 'sandbox', target: 'sandbox' }
      : {
          deviceId: bound.workspace.deviceId!,
          kind: 'device',
          target: bound.snapshot.target === 'local' ? 'local' : 'device',
        };
  return {
    ...prepared.executionContext,
    accessRoots: [
      ...(prepared.executionContext.accessRoots ?? []).filter((root) => root.scope !== 'primary'),
      {
        ...(bound.workspace.deviceId ? { deviceId: bound.workspace.deviceId } : {}),
        modes: ['exec', 'read', 'write'],
        rootPath: bound.workspace.rootPath,
        scope: 'primary',
        source: 'workspace',
      },
    ],
    cwd: bound.workspace.rootPath,
    plan: authoritativePlan,
    snapshot: bound.snapshot,
    unresolvedReason: undefined,
    workspace: bound.workspace,
  };
};

/**
 * Stable, secret-free reason for a scratch bind that never committed. The bind
 * delegate already absorbs a concurrent formal bind: it catches
 * `WorkspaceAlreadyBoundError`, resolves the winning topic binding, and returns
 * it as its own result. A rejection is therefore never a harmless lost race —
 * it means no authoritative workspace could be resolved at all. The raw error
 * stays in the server log; persisted state and client events carry only this
 * code, never a driver message, stack, or filesystem path.
 */
export const WORKSPACE_BIND_FAILED = 'WORKSPACE_BIND_FAILED';

/**
 * A batch may have to park for a client/deferred/human tool after a server tool
 * has already succeeded but its scratch workspace failed to bind. Keep that
 * debt separate from the ordinary parking interruption: the pending tool still
 * owns its result, but no later LLM turn may start until the bind failure has
 * been surfaced. The value is deliberately just a boolean — no driver error or
 * filesystem detail crosses the persistence boundary.
 */
const PENDING_WORKSPACE_BIND_FAILURE_KEY = '_pendingWorkspaceBindFailure';

export const hasPendingWorkspaceBindFailure = (state: AgentState): boolean =>
  state.metadata?.[PENDING_WORKSPACE_BIND_FAILURE_KEY] === true;

const clearPendingWorkspaceBindFailure = (state: AgentState): void => {
  if (!state.metadata || !(PENDING_WORKSPACE_BIND_FAILURE_KEY in state.metadata)) return;

  const metadata = { ...state.metadata };
  delete metadata[PENDING_WORKSPACE_BIND_FAILURE_KEY];
  state.metadata = metadata;
};

/**
 * Outcome of the post-success workspace coordination shared by `call_tool` and
 * `call_tools_batch`. The tool has already run and owns its result, so settling
 * a bind never rejects and never rewrites that result; `executionContext` is
 * always safe to freeze onto the next state.
 */
interface ScratchBindSettlement {
  /** A proposed scratch root was committed as the authoritative workspace. */
  committed?: boolean;
  /** Context the next step may run in: a committed bind, or the last persisted one. */
  executionContext?: ExecutionContext;
  /** A bind was owed but never committed; the step must interrupt rather than continue. */
  failed?: boolean;
}

/**
 * Bind the lazily created scratch root now that the tool that needed it has
 * succeeded, without ever letting the binding decide the fate of that success.
 */
const settleScratchBindAfterToolSuccess = async (params: {
  ctx: RuntimeExecutorContext;
  operationLogId: string;
  prepared: PreparedToolExecutionContext;
  state: AgentState;
  toolName: string;
}): Promise<ScratchBindSettlement> => {
  const { ctx, operationLogId, prepared, state, toolName } = params;
  if (!prepared.scratchRoot) return { executionContext: prepared.executionContext };
  // Device RPC can return success after the user stopped the server operation.
  // Its late completion must not change the topic's workspace binding.
  if (await isOperationInterrupted(ctx)) {
    return { executionContext: getFrozenExecutionContext(state) };
  }

  try {
    return {
      committed: true,
      executionContext: await bindPreparedScratchContext(ctx, state, prepared),
    };
  } catch (error) {
    // The tool succeeded before this bind ran, so its result stands whatever
    // happened here. What must NOT stand is `prepared.executionContext`: its
    // scratch primary root was only ever a local proposal, and with no
    // committed binding behind it, freezing it would make later steps act on a
    // workspace this topic is not bound to. Fall back to the last persisted
    // context, which still carries whatever binding/snapshot the topic has.
    console.error(
      `[StreamingToolExecutor] ${WORKSPACE_BIND_FAILED} after successful tool ${toolName} for operation ${operationLogId}; keeping the tool result and interrupting the run:`,
      error,
    );
    return { executionContext: getFrozenExecutionContext(state), failed: true };
  }
};

/** Freeze the settled execution context onto the next state. */
const applyScratchBindSettlement = (state: AgentState, settlement: ScratchBindSettlement) => {
  if (settlement.executionContext) {
    state.metadata = {
      ...state.metadata,
      executionContext: settlement.executionContext,
      executionPlan: settlement.executionContext.plan,
    };
  }

  if (settlement.failed) {
    state.metadata = {
      ...state.metadata,
      [PENDING_WORKSPACE_BIND_FAILURE_KEY]: true,
    };
  } else if (settlement.committed) {
    // A later approved cwd tool may repair the debt while a human-consent batch
    // is being resumed. Only an authoritative scratch commit can clear it.
    clearPendingWorkspaceBindFailure(state);
  }
};

/**
 * Stop the run after a bind that never committed, keeping every already
 * persisted tool result. The step must not fail — that would re-run a tool
 * whose side effects already happened — and must not report an `error` event,
 * which clients read as a failed tool call. Returning no `nextContext` leaves
 * nothing queued: no further LLM step and no further cwd-dependent tool runs
 * against an unbound topic until a resume (or a user-picked workspace) can
 * supply one.
 */
export const interruptForPendingWorkspaceBindFailure = (
  state: AgentState,
  events: AgentEvent[],
) => {
  const interruptedAt = new Date().toISOString();
  clearPendingWorkspaceBindFailure(state);
  state.status = 'interrupted';
  state.lastModified = interruptedAt;
  state.interruption = { canResume: true, interruptedAt, reason: WORKSPACE_BIND_FAILED };

  return {
    events: [
      ...events,
      {
        canResume: true,
        interruptedAt,
        reason: WORKSPACE_BIND_FAILED,
        type: 'interrupted' as const,
      },
    ],
    newState: state,
    nextContext: undefined,
  };
};

/** Never send resolved environment values to a renderer-facing gateway event. */
const projectExecutionContextForClient = (
  state: AgentState,
  override?: ExecutionContext,
): ToolCallExecutionContext | undefined => {
  const frozen = override ?? getFrozenExecutionContext(state);
  if (!frozen) return;

  return {
    accessRoots: frozen.accessRoots,
    approvalMode: resolveExecutionApprovalMode(state),
    cwd: frozen.cwd,
    envRef: state.metadata?.agentId
      ? {
          agentId: state.metadata.agentId,
          topicId: state.metadata?.topicId,
          workspaceId: frozen.workspace?.id,
        }
      : undefined,
    workspaceKind: frozen.workspace?.kind,
    workspaceRootPath: frozen.workspace?.rootPath,
  };
};

/**
 * Local-system calls with a frozen device plan must take the server-to-device
 * channel. That channel can carry the server-resolved operation env and
 * envFiles without exposing plaintext secrets to the renderer-facing
 * `tool_execute` event. Other client executors continue to use that event.
 */
const requiresServerDeviceTransport = (state: AgentState, tool: ChatToolPayload): boolean => {
  const frozen = getFrozenExecutionContext(state);
  return tool.identifier === LocalSystemIdentifier && !!frozen && isDeviceCapablePlan(frozen.plan);
};

const getExecutionDeviceId = (
  state: AgentState,
  executionContext?: ExecutionContext,
): string | undefined => {
  const frozen = executionContext ?? getFrozenExecutionContext(state);
  if (frozen) return frozen.plan.kind === 'device' ? frozen.plan.deviceId : undefined;
  return state.metadata?.activeDeviceId;
};

/**
 * Context budgeting only reads the common UI-message fields (content/id/role),
 * while the provider runtime consumes its narrower OpenAI-compatible shape.
 * Keep the one explicit boundary cast at the two adapters below.
 */
type BudgetedChatStreamPayload = Omit<ChatStreamPayload, 'messages'> & {
  messages: UIChatMessage[];
  providerMedia?: Array<{ estimatedTokens: number; id?: string; messageId?: string }>;
};

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => ({
  /**
   * Create streaming LLM executor
   * Integrates Agent Runtime and stream event publishing
   */
  call_llm: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    // Fallback to state's modelRuntimeConfig if not in payload
    const model = llmPayload.model || state.modelRuntimeConfig?.model;
    const provider = llmPayload.provider || state.modelRuntimeConfig?.provider;
    // Resolve tools via ToolResolver (unified tool injection).
    //
    // Single-track device gate: `buildStepToolDelta` treats activeDeviceId as
    // an independent activation signal (it only dedupes against already-
    // enabled tools), so any id that reaches it WILL inject local-system. The
    // execution plan is the only authority on whether this session may touch
    // a device — swallow the id for non-device-capable plans (`none`,
    // `sandbox`) and for denied senders, even if `state.metadata.activeDeviceId`
    // was populated by a bug or a mid-run side effect. Plans absent on old /
    // resumed operations fall back to the policy-only gate.
    const devicePolicy = state.metadata?.deviceAccessPolicy as
      | { canUseDevice: boolean; reason: DeviceAccessReason }
      | undefined;
    const executionPlan = state.metadata?.executionPlan as ExecutionPlan | undefined;
    const planAllowsDevice = !executionPlan || isDeviceCapablePlan(executionPlan);
    const activeDeviceId =
      devicePolicy?.canUseDevice === false || !planAllowsDevice
        ? undefined
        : state.metadata?.activeDeviceId;
    const operationToolSet: OperationToolSet = state.operationToolSet ?? {
      enabledToolIds: [],
      executorMap: state.toolExecutorMap ?? {},
      manifestMap: state.toolManifestMap ?? {},
      sourceMap: state.toolSourceMap ?? {},
      tools: state.tools ?? [],
    };

    const stepDelta = buildStepToolDelta({
      activeDeviceId,
      enabledToolIds: operationToolSet.enabledToolIds,
      forceFinish: state.forceFinish,
      localSystemManifest: LocalSystemManifest as unknown as LobeToolManifest,
      operationManifestMap: operationToolSet.manifestMap,
    });

    const toolResolver = new ToolResolver();
    const resolved: ResolvedToolSet = toolResolver.resolve(
      operationToolSet,
      stepDelta,
      state.activatedStepTools ?? [],
    );

    const tools = resolved.tools.length > 0 ? resolved.tools : undefined;
    const toolDiscoveryConfig = buildToolDiscoveryConfig(operationToolSet, resolved.enabledToolIds);

    if (stepDelta.activatedTools.length > 0) {
      log(
        `[${operationId}:${stepIndex}] ToolResolver injected %d step-level tools: %o`,
        stepDelta.activatedTools.length,
        stepDelta.activatedTools.map((t) => t.id),
      );
    }

    // Resolve skills via SkillResolver (unified skill injection)
    const skillResolver = new SkillResolver();
    const stepSkillDelta = buildStepSkillDelta();
    const resolvedSkills = state.metadata?.operationSkillSet
      ? skillResolver.resolve(
          state.metadata.operationSkillSet,
          stepSkillDelta,
          state.activatedStepSkills ?? [],
        )
      : undefined;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    // Type assertion to ensure payload correctness
    const operationLogId = `${operationId}:${stepIndex}`;

    const stagePrefix = `[${operationLogId}][call_llm]`;

    log(`${stagePrefix} Starting operation`);

    // Get parentId from payload (parentId or parentMessageId depending on payload type)
    const parentId = llmPayload.parentId || (llmPayload as any).parentMessageId;

    // Parent existence preflight ():
    // If the parent was deleted concurrently (e.g. user deleted topic mid-run),
    // assistant message creation below would hit a PG FK violation AFTER we've
    // already done the LLM call and spent tokens. Check first — fail fast,
    // save cost, and surface a typed error the frontend can act on instead of
    // a raw SQL error.
    if (parentId) {
      const parentExists = await ctx.messageModel.findById(parentId);
      if (!parentExists) {
        const error = createConversationParentMissingError(parentId);
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(error, 'parent_message_preflight'),
          stepIndex,
          type: 'error',
        });
        throw error;
      }
    }

    // Get or create assistant message
    // If assistantMessageId is provided in payload, use existing message instead of creating new one
    const existingAssistantMessageId = (llmPayload as any).assistantMessageId;
    let assistantMessageItem: { id: string };

    if (existingAssistantMessageId) {
      // Use existing assistant message (created by execAgent)
      assistantMessageItem = { id: existingAssistantMessageId };
      log(`${stagePrefix} Using existing assistant message: %s`, existingAssistantMessageId);
    } else {
      // Create new assistant message (legacy behavior)
      assistantMessageItem = await ctx.messageModel.create({
        agentId: state.metadata!.agentId!,
        content: '',
        model,
        parentId,
        provider,
        role: 'assistant',
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      });
      log(`${stagePrefix} Created new assistant message: %s`, assistantMessageItem.id);
    }

    // Publish stream start event
    const stepLabel = (instruction as any).stepLabel;
    await streamManager.publishStreamEvent(operationId, {
      data: {
        assistantMessage: assistantMessageItem,
        model,
        provider,
        ...(stepLabel && { stepLabel }),
      },
      stepIndex,
      type: 'stream_start',
    });

    try {
      type ContentPart = { text: string; type: 'text' } | { image: string; type: 'image' };
      let shouldReplayAssistantReasoning = false;
      let preserveThinkingForPayload: boolean | undefined;
      let resolvedExtendParams: ModelExtendParams | undefined;
      const operationModelCatalogSnapshot = state.metadata?.modelCatalogSnapshot as
        | ModelCatalogSnapshot
        | undefined;
      const operationCatalogEntry = operationModelCatalogSnapshot?.entry;
      let resolvedContextWindowTokens =
        operationCatalogEntry?.modelId === model && operationCatalogEntry.providerId === provider
          ? operationCatalogEntry.contextWindowTokens
          : undefined;
      let sourceMessagesForProviderImages = llmPayload.messages as UIChatMessage[];

      // Process messages through serverMessagesEngine to inject system role, knowledge, etc.
      // Rebuild params from agentConfig at execution time (capabilities built dynamically)
      const agentConfig = ctx.agentConfig;
      let processedMessages;
      if (agentConfig) {
        const { loadModels } = await import('@/business/client/model-bank/loadModels');
        const builtinModels = await loadModels();

        const preserveThinkingConfigured =
          typeof agentConfig.chatConfig?.preserveThinking === 'boolean'
            ? agentConfig.chatConfig.preserveThinking
            : undefined;
        const preserveThinkingRequested = preserveThinkingConfigured === true;

        const readExtendParams = (
          card: (typeof builtinModels)[number] | undefined,
        ): string[] | undefined =>
          card &&
          'settings' in card &&
          card.settings &&
          typeof card.settings === 'object' &&
          'extendParams' in card.settings
            ? (card.settings as { extendParams?: string[] }).extendParams
            : undefined;

        const modelCard = builtinModels.find(
          (item) =>
            item.providerId === provider &&
            (item.id === model || item.config?.deploymentName === model),
        );
        const frozenMatches =
          operationCatalogEntry?.modelId === model && operationCatalogEntry.providerId === provider;
        resolvedContextWindowTokens = frozenMatches
          ? operationCatalogEntry.contextWindowTokens
          : modelCard?.contextWindowTokens;

        let modelExtendParams = readExtendParams(modelCard);

        // Aggregation providers (e.g. `lobehub`) may serve a model without copying
        // its origin `settings.extendParams`. Fall back to the canonical model card
        // (matched by id across any provider) so reasoning/thinking params like
        // `thinkingLevel` still reach the model. Mirrors the client-side
        // `transformToAiModelList` re-namespacing behavior.
        if (!modelExtendParams || modelExtendParams.length === 0) {
          const canonicalCard = builtinModels.find(
            (item) => item.id === model || item.config?.deploymentName === model,
          );
          modelExtendParams = readExtendParams(canonicalCard);
        }

        const modelSupportsPreserveThinkingFromCard =
          Array.isArray(modelExtendParams) && modelExtendParams.includes('preserveThinking');
        const providerSupportsPreserveThinkingFallback =
          provider === 'qwen' || provider === 'zhipu';
        const modelSupportsPreserveThinking =
          modelSupportsPreserveThinkingFromCard ||
          (!modelCard && providerSupportsPreserveThinkingFallback);

        shouldReplayAssistantReasoning = preserveThinkingRequested && modelSupportsPreserveThinking;
        preserveThinkingForPayload =
          modelSupportsPreserveThinking && typeof preserveThinkingConfigured === 'boolean'
            ? preserveThinkingConfigured
            : undefined;

        // Resolve model extend params (thinkingLevel, reasoning effort, urlContext, …)
        // from the agent chat config so the server-side agent runtime forwards the same
        // runtime params the client chat service does. Without this, e.g. Gemini 3 Pro's
        // `thinkingLevel` never reaches the request and thought summaries come back empty.
        if (agentConfig.chatConfig) {
          resolvedExtendParams = applyModelExtendParams({
            chatConfig: agentConfig.chatConfig,
            extendParams: modelExtendParams as ExtendParamsType[] | undefined,
            model,
          });
        }

        const rawMessagesForContext = shouldReplayAssistantReasoning
          ? (llmPayload.messages as UIChatMessage[])
          : stripAssistantReasoningForReplay(llmPayload.messages as UIChatMessage[]);
        const messagesForContext = rawMessagesForContext;
        sourceMessagesForProviderImages = messagesForContext;

        // Extract <refer_topic> tags from messages and fetch summaries.
        // Skip if messages already contain injected topic_reference_context
        // (e.g., from client-side contextEngineering preprocessing) to avoid double injection.
        let topicReferences;
        const alreadyHasTopicRefs = (
          messagesForContext as Array<{ content: string | unknown }>
        ).some(
          (m) => typeof m.content === 'string' && m.content.includes('topic_reference_context'),
        );

        if (!alreadyHasTopicRefs && ctx.serverDB && ctx.userId) {
          const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
          const messageModel = new MessageModelClass(ctx.serverDB, ctx.userId, ctx.workspaceId);
          topicReferences = await resolveTopicReferences(
            messagesForContext as Array<{ content: string | unknown }>,
            async (topicId) => topicModel.findById(topicId),
            async (topicId) => {
              const topic = await topicModel.findById(topicId);
              return messageModel.query(
                {
                  agentId: topic?.agentId ?? undefined,
                  groupId: topic?.groupId ?? undefined,
                  topicId,
                },
                { postProcessUrl: buildPostProcessUrl(ctx) },
              );
            },
          );
        }

        // Fetch agent documents for context injection
        let agentDocuments: AgentContextDocument[] | undefined;
        const agentId = state.metadata?.agentId;
        if (agentId && ctx.serverDB && ctx.userId) {
          try {
            const agentDocService = new AgentDocumentsService(
              ctx.serverDB,
              ctx.userId,
              state.metadata?.workspaceId ?? ctx.workspaceId,
            );
            const docs = await agentDocService.getAgentContextDocuments(agentId);
            if (docs.length > 0) {
              agentDocuments = toAgentContextDocuments(docs);
              log('Resolved %d agent documents for agent %s', agentDocuments.length, agentId);
            }
          } catch (error) {
            log('Failed to resolve agent documents for agent %s: %O', agentId, error);
          }
        }

        // Detect onboarding agent and build context injection
        let onboardingContext: OnboardingContext | undefined;
        const isOnboardingAgent =
          agentConfig?.slug === 'web-onboarding' ||
          resolved.enabledToolIds.includes('lobe-web-onboarding');
        const alreadyHasOnboardingContext = (
          messagesForContext as Array<{ content: string | unknown }>
        ).some((message) => {
          if (typeof message.content !== 'string') return false;

          return (
            message.content.includes('<onboarding_context>') ||
            message.content.includes('<current_soul_document>') ||
            message.content.includes('<current_user_persona>')
          );
        });

        if (isOnboardingAgent && !alreadyHasOnboardingContext && ctx.serverDB && ctx.userId) {
          try {
            const { formatWebOnboardingStateMessage } =
              await import('@lobechat/builtin-tool-web-onboarding/utils');
            const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
            const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
            const docService = new AgentDocumentsService(
              ctx.serverDB,
              ctx.userId,
              state.metadata?.workspaceId ?? ctx.workspaceId,
            );
            const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);

            const [onboardingState, soulDoc, persona, userInfo] = await Promise.all([
              onboardingService.getState(),
              onboardingService
                .getInboxAgentId()
                .then((inboxAgentId) =>
                  inboxAgentId ? docService.getDocumentByFilename(inboxAgentId, 'SOUL.md') : null,
                )
                .catch((error) => {
                  log('Failed to fetch SOUL.md for onboarding context: %O', error);
                  return null;
                }),
              personaModel.getLatestPersonaDocument().catch((error) => {
                log('Failed to fetch user persona for onboarding context: %O', error);
                return null;
              }),
              onboardingService.getInitialUserInfo().catch((error) => {
                log('Failed to fetch initial user info for onboarding context: %O', error);
                return undefined;
              }),
            ]);

            onboardingContext = {
              discoveryUserMessageCount: onboardingState.discoveryUserMessageCount,
              personaContent: persona?.persona ?? null,
              phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
              remainingDiscoveryExchanges: onboardingState.remainingDiscoveryExchanges,
              soulContent: soulDoc?.content ?? null,
              userInfo,
            };
            log('Built onboarding context for agent %s, phase: %s', agentId, onboardingState.phase);
          } catch (error) {
            log('Failed to build onboarding context: %O', error);
          }
        }

        // Build additional placeholder variables for the lobehub builtin skill
        // (`packages/builtin-skills/src/lobehub/content.ts`) so it can render
        // `{{agent_id}}` / `{{agent_title}}` / `{{topic_id}}` etc. into the
        // model's prompt without needing a separate context injector.
        //
        // - agent_title / agent_description: read directly from agentConfig,
        //   which is the result of AgentModel.getAgentConfig() and already
        //   contains the full enriched agent record (title, description, ...).
        //   No extra query needed.
        // - topic_title: requires a single primary-key lookup against the
        //   topics table. Skipped when topicId is missing or the lookup fails
        //   (best-effort, falls back to empty string so the template still
        //   renders cleanly).
        const lobehubSkillAgentId = state.metadata?.agentId;
        const lobehubSkillTopicId = state.metadata?.topicId;
        const lobehubSkillAgentMeta = state.metadata?.agentConfig as
          | { description?: string | null; title?: string | null }
          | undefined;

        let lobehubSkillTopicTitle = '';
        if (lobehubSkillTopicId && ctx.serverDB && ctx.userId) {
          try {
            const topicModelForLobehub = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
            const topicRecord = await topicModelForLobehub.findById(lobehubSkillTopicId);
            lobehubSkillTopicTitle = topicRecord?.title ?? '';
          } catch (error) {
            log('Failed to load topic title for lobehub skill placeholders: %O', error);
          }
        }

        const lobehubSkillVariables: Record<string, string> = {
          agent_id: lobehubSkillAgentId ?? '',
          agent_title: lobehubSkillAgentMeta?.title ?? '',
          agent_description: lobehubSkillAgentMeta?.description ?? '',
          topic_id: lobehubSkillTopicId ?? '',
          topic_title: lobehubSkillTopicTitle,
        };

        // ── Tool-specific template variable resolution ────────────────────
        // The client-side contextEngineering.ts resolves these via Zustand stores
        // and lambdaClient. In execAgent (server/bot) mode we must fetch from DB
        // directly. Each block is gated on the relevant tool being enabled.

        // {{username}} / {{language}} — used by memory and creds system roles.
        // Single indexed DB lookup; cheap enough to run on each call_llm step.
        let serverUsername = '';
        let serverLanguage = '';
        if (ctx.serverDB && ctx.userId) {
          try {
            const userInfo = await UserModel.getInfoForAIGeneration(ctx.serverDB, ctx.userId);
            serverUsername = userInfo.userName;
            serverLanguage = userInfo.responseLanguage;
          } catch (error) {
            log('Failed to fetch user info for {{username}}/{{language}} substitution: %O', error);
          }
        }

        // {{sandbox_enabled}} — mirrors client-side check for lobe-cloud-sandbox.
        const sandboxEnabled = String(resolved.enabledToolIds.includes('lobe-cloud-sandbox'));

        // {{sandbox_uploaded_files}} — lists the topic/session files that are
        // synced into the sandbox upload dir, so the agent knows they exist.
        // Mirrors the bootstrap query in SandboxMiddlewareService.
        let sandboxUploadedFiles = '';
        if (sandboxEnabled === 'true' && ctx.serverDB && ctx.userId && lobehubSkillTopicId) {
          try {
            const { FileModel } = await import('@/database/models/file');
            const { formatUploadedFilesPrompt } =
              await import('@lobechat/builtin-tool-cloud-sandbox');
            const fileModel = new FileModel(ctx.serverDB, ctx.userId);
            const uploadedFiles = await fileModel.findFilesToInitInSandbox(lobehubSkillTopicId);
            sandboxUploadedFiles = formatUploadedFilesPrompt(uploadedFiles);
          } catch (error) {
            log('Failed to resolve files for {{sandbox_uploaded_files}} substitution: %O', error);
          }
        }

        // {{session_date}} — current date formatted for user's timezone.
        const sessionDate = new Intl.DateTimeFormat('en-US', {
          day: 'numeric',
          month: 'long',
          timeZone: ctx.userTimezone || 'UTC',
          weekday: 'long',
          year: 'numeric',
        }).format(new Date());

        // {{memory_effort}} — read from agentConfig chatConfig; no extra query needed.
        const memoryEffort = String(
          (state.metadata?.agentConfig as any)?.chatConfig?.memory?.effort ?? '',
        );

        // {{CREDS_LIST}} — used by lobe-creds system role.
        // Always fetched when userId is available so substitution works regardless of which
        // execution path (execAgent / client-side activator) injected the system role.
        let credsListStr = '';
        if (ctx.userId) {
          try {
            const { MarketService } = await import('@/server/services/market');
            const marketService = new MarketService({ userInfo: { userId: ctx.userId } });
            const credsResult = await marketService.market.creds.list();
            const userCreds = (credsResult as any)?.data ?? [];
            credsListStr = generateCredsList(
              userCreds.map(
                (cred: any): CredSummary => ({
                  description: cred.description,
                  key: cred.key,
                  name: cred.name,
                  type: cred.type,
                }),
              ),
            );
            log('Fetched %d creds for {{CREDS_LIST}} substitution', userCreds.length);
          } catch (error) {
            log('Failed to fetch creds for {{CREDS_LIST}} substitution: %O', error);
          }
        }

        // {{COMPOSIO_SERVICES_LIST}} — used by lobe-creds system role (Composio integrations section).
        let composioServicesListStr = '';
        if (ctx.serverDB && ctx.userId && !!composioEnv.COMPOSIO_API_KEY) {
          try {
            const { PluginModel } = await import('@/database/models/plugin');
            const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
            const allPlugins = await pluginModel.query();
            const validComposioIds = new Set(COMPOSIO_APP_TYPES.map((t) => t.identifier));
            const connectedIds = new Set(
              allPlugins
                .filter(
                  (p) =>
                    validComposioIds.has(p.identifier) &&
                    (p.customParams as any)?.composio?.status === 'ACTIVE',
                )
                .map((p) => p.identifier),
            );
            const connected: ComposioServiceSummary[] = COMPOSIO_APP_TYPES.filter((t) =>
              connectedIds.has(t.identifier),
            ).map((t) => ({ identifier: t.identifier, name: t.label }));
            const available: ComposioServiceSummary[] = COMPOSIO_APP_TYPES.filter(
              (t) => !connectedIds.has(t.identifier),
            ).map((t) => ({ identifier: t.identifier, name: t.label }));
            composioServicesListStr = generateComposioServicesList(connected, available);
            log(
              'Fetched Composio services for {{COMPOSIO_SERVICES_LIST}}: connected=%d, available=%d',
              connected.length,
              available.length,
            );
          } catch (error) {
            log(
              'Failed to fetch Composio services for {{COMPOSIO_SERVICES_LIST}} substitution: %O',
              error,
            );
          }
        }

        const contextEngineInput = {
          agentDocuments,
          agentGroup: buildBotAgentGroupContext({
            agentConfig,
            agentId: state.metadata?.agentId,
            botContext: state.metadata?.botContext ?? ctx.botContext,
          }),
          additionalVariables: {
            ...state.metadata?.deviceSystemInfo,
            ...lobehubSkillVariables,
            // User identity variables
            username: serverUsername,
            language: serverLanguage,
            session_date: sessionDate,
            // Creds tool variables
            sandbox_enabled: sandboxEnabled,
            sandbox_uploaded_files: sandboxUploadedFiles,
            CREDS_LIST: credsListStr,
            COMPOSIO_SERVICES_LIST: composioServicesListStr,
            // Memory tool variables
            memory_effort: memoryEffort,
          },
          userTimezone: ctx.userTimezone,
          capabilities: {
            isCanUseFC: (m: string, p: string) => {
              const info = builtinModels.find((item) => item.id === m && item.providerId === p);
              return info?.abilities?.functionCall ?? true;
            },
            isCanUseVideo: (m: string, p: string) => {
              const info =
                builtinModels.find((item) => item.id === m && item.providerId === p) ??
                builtinModels.find((item) => item.id === m);
              return info?.abilities?.video ?? false;
            },
            isCanUseVision: (m: string, p: string) => {
              // Aggregator providers (e.g. lobehub) route to upstream model cards
              // that live under the original provider's id in the registry, so
              // fall back to a cross-provider lookup by model id when the
              // (model, provider) pair has no direct entry.
              const info =
                builtinModels.find((item) => item.id === m && item.providerId === p) ??
                builtinModels.find((item) => item.id === m);
              return info?.abilities?.vision ?? false;
            },
          },
          botPlatformContext: ctx.botPlatformContext,
          discordContext: ctx.discordContext,
          enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
          preserveMessageIdentity: true,
          evalContext: ctx.evalContext,
          forceFinish: state.forceFinish,
          historyCount: resolveRuntimeHistoryCount(agentConfig.chatConfig?.historyCount),
          initialContext: (state as any).initialContext?.initialContext,
          knowledge: {
            fileContents: agentConfig.files
              ?.filter((f: { enabled?: boolean | null }) => f.enabled === true)
              .map((f: { content?: string | null; id?: string; name?: string }) => ({
                content: f.content ?? '',
                fileId: f.id ?? '',
                filename: f.name ?? '',
              })),
            knowledgeBases: agentConfig.knowledgeBases
              ?.filter((kb: { enabled?: boolean | null }) => kb.enabled === true)
              .map((kb: { id?: string; name?: string }) => ({
                id: kb.id ?? '',
                name: kb.name ?? '',
              })),
          },
          messages: messagesForContext,
          model,
          modelContextWindowTokens: resolvedContextWindowTokens,
          provider,
          systemRole: agentConfig.systemRole ?? undefined,
          toolDiscoveryConfig,
          toolsConfig: {
            manifests: Object.values(resolved.manifestMap),
            tools: resolved.enabledToolIds,
          },
          userMemory: state.metadata?.userMemory,

          // Skills configuration for <available_skills> injection.
          // In chat mode the MessagesEngine force-disables this injector via
          // its `enableAgentMode` param — no extra gate needed here.
          ...(resolvedSkills?.enabledSkills?.length && {
            skillsConfig: { enabledSkills: resolvedSkills.enabledSkills },
          }),
          enableAgentMode: agentConfig.chatConfig?.enableAgentMode,

          // Topic reference summaries
          ...(topicReferences && { topicReferences }),
          ...(onboardingContext && { onboardingContext }),
        };

        processedMessages = await agentRuntimeTracer.startActiveSpan(
          CONTEXT_ENGINEERING_SPAN_NAME,
          {
            attributes: buildContextEngineeringAttributes({
              hasImages: (messagesForContext as Array<{ content?: unknown }>).some(
                (m) =>
                  Array.isArray(m.content) &&
                  (m.content as Array<{ type?: string }>).some((p) => p?.type === 'image_url'),
              ),
              historyCompressed:
                Array.isArray(messagesForContext) &&
                messagesForContext.some((m: { role?: string }) => m?.role === 'compressedGroup'),
              knowledgeCount:
                (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) +
                (contextEngineInput.knowledge?.fileContents?.length ?? 0),
              knowledgeInjected:
                (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) > 0 ||
                (contextEngineInput.knowledge?.fileContents?.length ?? 0) > 0,
              memoryInjected: Boolean(contextEngineInput.userMemory?.memories),
              messageCount: messagesForContext.length,
              operationId,
              stepIndex,
              systemRoleLength: contextEngineInput.systemRole?.length,
              toolCount: contextEngineInput.toolsConfig?.tools?.length ?? 0,
            }),
          },
          async (ceSpan) => {
            try {
              const result = await serverMessagesEngine(contextEngineInput);
              ceSpan.setAttribute('lobehub.context.message_count', result.length);
              return result;
            } catch (error) {
              ceSpan.recordException(error as Error);
              ceSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error),
              });
              throw error;
            } finally {
              ceSpan.end();
            }
          },
        );

        // Hand context engine input/output to the trace sink out-of-band.
        // Omit large/redundant fields to reduce snapshot size:
        // - input.messages: reconstructible from step's messagesBaseline + messagesDelta
        // - input.toolsConfig: static per operation, ~47KB of manifests repeated every call_llm step
        // Keep output (processedMessages) — needed by inspect CLI for --env, --system-role, -m
        const {
          messages: _inputMsgs,
          toolsConfig: _toolsConfig,
          ...contextEngineInputLite
        } = contextEngineInput;
        ctx.tracingContextEngine?.(
          { ...contextEngineInputLite, toolCount: _toolsConfig?.tools?.length ?? 0 },
          processedMessages,
        );
      } else {
        processedMessages = llmPayload.messages;
      }

      // Initialize ModelRuntime (read user's keyVaults from database)
      const initModelRuntime = requireRuntimeBoundary(ctx.initModelRuntime, 'initModelRuntime');
      const modelRuntime = await initModelRuntime(
        ctx.serverDB,
        ctx.userId!,
        provider,
        ctx.workspaceId,
      );

      // Construct ChatStreamPayload
      const stream = ctx.stream ?? true;
      const providerMedia = collectProviderMediaTokenEstimates(
        processedMessages,
        sourceMessagesForProviderImages,
      );
      const providerMessages = await inlineProviderImageContentParts(
        processedMessages,
        sourceMessagesForProviderImages,
        buildProviderImageDataUrlResolver(ctx, state.metadata?.workspaceId),
      );
      const chatPayload = {
        messages: providerMessages,
        model,
        providerMedia,
        stream,
        tools,
        // ModelExtendParams keeps provider-specific effort/thinking values as loose
        // strings (e.g. hy3's 'no_think'); the runtime payload narrows them, so cast.
        ...(resolvedExtendParams as Partial<ChatStreamPayload>),
        ...(typeof preserveThinkingForPayload === 'boolean' && {
          preserveThinking: preserveThinkingForPayload,
        }),
      };

      // Hard-stop background operations before sending a request that cannot fit
      // in the remaining token or wall-clock budget. Frontend chat operations do
      // not carry executionBudget and therefore retain their existing behavior.
      const executionBudget = state.executionBudget ?? state.metadata?.executionBudget;
      if (executionBudget) {
        const projectedInputTokens = countContextTokens({
          messages: providerMessages as UIChatMessage[],
          providerMedia,
          tools,
        }).adjustedTotal;
        const preflightBudgetReason = getExecutionBudgetReason(state, projectedInputTokens);
        if (preflightBudgetReason) {
          return interruptForExecutionGuard(state, preflightBudgetReason, instruction);
        }
      }
      const createTraceOptions = requireRuntimeBoundary(
        ctx.createTraceOptions,
        'createTraceOptions',
      );
      const runtimeTraceOptions = createTraceOptions(chatPayload as ChatStreamPayload, {
        includeInput: false,
        metadata: {
          automationMode: state.metadata?.automationMode,
          executionBudget: state.executionBudget ?? state.metadata?.executionBudget,
          operationId,
          stepIndex,
          taskId: state.metadata?.taskId,
          trigger: state.metadata?.trigger,
        },
        provider,
        shutdownMode: 'immediate',
        trace: {
          topicId: state.metadata?.topicId ?? ctx.topicId,
          traceId: operationId,
          traceName: TraceNameMap.Conversation,
          userId: ctx.userId,
        },
      });

      // Buffer: accumulate text and reasoning, send every 50ms
      const BUFFER_INTERVAL = 50;
      let textBuffer = '';
      let reasoningBuffer = '';

      let textBufferTimer: NodeJS.Timeout | null = null;
      let reasoningBufferTimer: NodeJS.Timeout | null = null;

      const flushTextBuffer = async () => {
        const delta = textBuffer;
        textBuffer = '';

        if (!!delta) {
          log(`[${operationLogId}] flushTextBuffer:`, delta);

          // Build standard Agent Runtime event
          events.push({
            chunk: { text: delta, type: 'text' },
            type: 'llm_stream',
          });

          const publishStart = Date.now();
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'text',
            content: delta,
          });
          timing(
            '[%s] flushTextBuffer published at %d, took %dms, length: %d',
            operationLogId,
            publishStart,
            Date.now() - publishStart,
            delta.length,
          );
        }
      };

      const flushReasoningBuffer = async () => {
        const delta = reasoningBuffer;

        reasoningBuffer = '';

        if (!!delta) {
          log(`[${operationLogId}] flushReasoningBuffer:`, delta);

          events.push({
            chunk: { text: delta, type: 'reasoning' },
            type: 'llm_stream',
          });

          const publishStart = Date.now();
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'reasoning',
            reasoning: delta,
          });
          timing(
            '[%s] flushReasoningBuffer published at %d, took %dms, length: %d',
            operationLogId,
            publishStart,
            Date.now() - publishStart,
            delta.length,
          );
        }
      };

      // File service + date shard used to persist model-generated images
      // (Gemini multimodal `content_part`/`reasoning_part` images) to object
      // storage. Construct it lazily on the first image: pure-text turns must
      // not require object-storage configuration merely because they share the
      // streaming executor with multimodal turns.
      let imageUploadService: FileService | undefined;
      const imageUploadDate = new Date().toISOString().split('T')[0];

      // Coalesce a streamed text chunk into the trailing text part (mirrors the
      // client StreamingHandler) so serialized multimodal content stays compact
      // and preserves text/image ordering.
      const appendTextPart = (parts: ContentPart[], text: string) => {
        const last = parts.at(-1);
        if (last && last.type === 'text') {
          parts[parts.length - 1] = { text: last.text + text, type: 'text' };
        } else {
          parts.push({ text, type: 'text' });
        }
      };

      // Persist a base64 image part to object storage and swap the placeholder
      // part for one referencing the uploaded URL. Runs concurrently with the
      // rest of the stream; a failed upload leaves the inline data-URI so the
      // image still renders. Never stores raw base64 in the message on success.
      const uploadPartImage = (
        parts: ContentPart[],
        partIndex: number,
        base64: string,
        mimeType: string | undefined,
      ): Promise<void> => {
        if (!ctx.userId) return Promise.resolve();
        try {
          imageUploadService ??= new FileService(ctx.serverDB, ctx.userId);
        } catch (error) {
          console.error(`[${operationLogId}][content_part] image upload setup failed:`, error);
          return Promise.resolve();
        }
        const ext = mimeType?.split('/')[1] || 'png';
        const pathname = `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/generations/${imageUploadDate}/${nanoid()}.${ext}`;
        return imageUploadService
          .uploadBase64(base64, pathname)
          .then(({ url }) => {
            parts[partIndex] = { image: url, type: 'image' };
          })
          .catch((error) => {
            console.error(`[${operationLogId}][content_part] image upload failed:`, error);
          });
      };

      let persistedAutoCompression:
        | {
            inputFingerprint: string;
            outcome: ContextCompressionOutcome;
            providerMessages: UIChatMessage[];
            stateMessages: UIChatMessage[];
          }
        | undefined;

      const compressFinalPayload = async (
        payload: BudgetedChatStreamPayload,
        evaluation: ContextBudgetEvaluation,
      ) => {
        if (persistedAutoCompression?.inputFingerprint === evaluation.payloadFingerprint) {
          return {
            outcome: persistedAutoCompression.outcome,
            payload: { ...payload, messages: persistedAutoCompression.providerMessages },
          };
        }

        const topicId = state.metadata?.topicId ?? ctx.topicId;
        if (!topicId || !ctx.userId) throw new Error('SUMMARY_PERSISTENCE_REQUIRED');

        const stateMessageIds = new Set(
          state.messages.map((message) => message.id).filter((id): id is string => Boolean(id)),
        );
        const persistedCandidateIds = evaluation.partition.candidateIds.filter((id) =>
          stateMessageIds.has(id),
        );
        if (persistedCandidateIds.length === 0) {
          throw new Error('SUMMARY_PERSISTENCE_REQUIRED');
        }

        const messageService = new MessageService(
          ctx.serverDB,
          ctx.userId,
          state.metadata?.workspaceId ?? ctx.workspaceId,
        );
        const compressionGroup = await messageService.createCompressionGroup(
          topicId,
          persistedCandidateIds,
          {
            agentId: state.metadata?.agentId,
            threadId: state.metadata?.threadId,
            topicId,
          },
        );
        const compressionQuery = {
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId,
        };

        try {
          const compressionModel = state.modelRuntimeConfig?.compressionModel ?? {
            model,
            provider,
          };
          const initModelRuntime = requireRuntimeBoundary(ctx.initModelRuntime, 'initModelRuntime');
          const compressionRuntime = await initModelRuntime(
            ctx.serverDB,
            ctx.userId!,
            compressionModel.provider,
            ctx.workspaceId,
          );
          const summaryWindow = resolveCompressionSummaryBudgetTokens({
            compressionModel,
            compressionModelCatalogSnapshot: state.metadata?.compressionModelCatalogSnapshot as
              | ModelCatalogSnapshot
              | undefined,
            mainModelCatalogSnapshot: operationModelCatalogSnapshot,
          });

          let finalSummary = '';
          const result = await compressContextHierarchically<
            UIChatMessage,
            Partial<ChatStreamPayload>
          >({
            buildRequest: (items) =>
              chainCompressContext(
                items.map(
                  (item, index) =>
                    ({
                      content: item.text,
                      createdAt: Date.now(),
                      id: `summary-input-${index}`,
                      role: 'user',
                      updatedAt: Date.now(),
                    }) as UIChatMessage,
                ),
              ),
            candidateIds: evaluation.partition.candidateIds,
            createSummaryMessage: (summary, candidateIds, groupId) => {
              finalSummary = summary;
              return {
                content: `[Conversation summary]\n${summary}`,
                createdAt: Date.now(),
                id: groupId,
                metadata: { contextBudget: { candidateIds } },
                // This replacement is sent directly to the provider; keep a
                // provider-valid role instead of the UI-only compressedGroup.
                role: 'user',
                updatedAt: Date.now(),
              } as UIChatMessage;
            },
            getMessageId: (message, index) => message.id || `payload-message-${index}`,
            groupId: compressionGroup.messageGroupId,
            measurePayload: (messages) => {
              const accounting = countContextTokens({
                messages: [...messages],
                providerMedia: collectProviderMediaTokenEstimates(
                  messages as Readonly<ChatStreamPayload['messages']>,
                  sourceMessagesForProviderImages,
                ),
                tools,
              });
              return {
                payloadFingerprint: accounting.payloadFingerprint,
                tokens: accounting.adjustedTotal,
              };
            },
            measureRequest: (request) =>
              countContextTokens({ messages: (request.messages ?? []) as UIChatMessage[] })
                .adjustedTotal,
            messages: payload.messages as UIChatMessage[],
            renderMessage: renderMessageForCompression,
            summarize: async (request) => {
              let summary = '';
              let summaryError: unknown;
              const response = await compressionRuntime.chat(
                {
                  ...request,
                  messages: request.messages ?? [],
                  model: compressionModel.model,
                  stream: true,
                },
                {
                  callback: {
                    onError: async (error) => {
                      summaryError = error;
                    },
                    onText: async (text) => {
                      summary += text;
                    },
                  },
                  user: ctx.userId,
                },
              );
              await consumeStreamUntilDone(response);
              if (summaryError) throw summaryError;
              return summary;
            },
            summaryModelBudgetTokens: summaryWindow,
            trigger:
              evaluation.decision.kind === 'compress'
                ? evaluation.decision.trigger
                : 'final-preflight',
          });

          if (result.outcome.outcome !== 'compressed' || !finalSummary) {
            throw new Error(('code' in result.outcome && result.outcome.code) || 'SUMMARY_FAILED');
          }

          const finalized = await messageService.finalizeCompression(
            compressionGroup.messageGroupId,
            finalSummary,
            compressionQuery,
          );
          if (!Array.isArray(finalized.messages)) throw new Error('SUMMARY_PERSISTENCE_REQUIRED');

          const stateMessages = (finalized.messages as UIChatMessage[]).filter(
            (message) => message.id !== assistantMessageItem.id,
          );
          persistedAutoCompression = {
            inputFingerprint: evaluation.payloadFingerprint,
            outcome: result.outcome,
            providerMessages: result.messages,
            stateMessages,
          };
          events.push({ groupId: compressionGroup.messageGroupId, type: 'compression_complete' });

          return {
            outcome: result.outcome,
            payload: {
              ...payload,
              messages: result.messages,
              providerMedia: collectProviderMediaTokenEstimates(
                result.messages as ChatStreamPayload['messages'],
                sourceMessagesForProviderImages,
              ),
            },
          };
        } catch (error) {
          if (isAbortError(error)) {
            await messageService.cancelCompression(
              compressionGroup.messageGroupId,
              compressionQuery,
            );
          } else {
            await messageService.failCompression(compressionGroup.messageGroupId, compressionQuery);
          }
          throw error;
        }
      };

      const maxAttempts = resolveLLMMaxAttempts(provider);

      // OTel chat span — wraps all retry attempts; TTFT recorded on the first
      // text/reasoning chunk regardless of which attempt produced it (the
      // semantic span represents the LLM call from the agent's perspective).
      const llmStartTime = Date.now();
      let firstChunkAt: number | undefined;
      const chatSpan = agentRuntimeTracer.startSpan(chatSpanName(model), {
        attributes: buildChatRequestAttributes({
          conversationId: state.metadata?.topicId,
          operationId,
          provider,
          requestModel: model,
          stepIndex,
          stream,
        }),
        kind: SpanKind.CLIENT,
      });
      const chatCtx = otelTrace.setSpan(otelContext.active(), chatSpan);

      try {
        return await otelContext.with(chatCtx, async () => {
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let content = '';
            let toolsCalling: ChatToolPayload[] = [];
            let tool_calls: MessageToolCall[] = [];
            let thinkingContent = '';
            let imageList: any[] = [];
            let grounding: any = null;
            let currentStepUsage: any = undefined;
            let currentStepSpeed: any = undefined;
            let currentStepFinishReason: string | undefined = undefined;
            let streamError: any = undefined;
            let contentParts: ContentPart[] = [];
            let reasoningParts: ContentPart[] = [];
            let contentImageUploads: Promise<void>[] = [];
            let reasoningImageUploads: Promise<void>[] = [];
            let hasContentImages = false;
            let hasReasoningImages = false;
            textBuffer = '';
            reasoningBuffer = '';

            const clearAttemptBuffers = () => {
              if (textBufferTimer) {
                clearTimeout(textBufferTimer);
                textBufferTimer = null;
              }

              if (reasoningBufferTimer) {
                clearTimeout(reasoningBufferTimer);
                reasoningBufferTimer = null;
              }

              textBuffer = '';
              reasoningBuffer = '';
            };

            // `runContextBudgetedCall` may invoke the provider twice inside one
            // executor retry attempt. Keep a hard boundary between those two
            // streams: a rejected attempt must not contribute content, usage,
            // images or executable tool calls to the compressed retry.
            let providerAttemptEpoch = 0;
            let providerAttemptEventStart = events.length;
            let providerAttemptActive = false;

            const discardProviderAttempt = () => {
              providerAttemptEpoch += 1;
              clearAttemptBuffers();

              if (providerAttemptActive) {
                events.splice(providerAttemptEventStart);
              }

              content = '';
              toolsCalling = [];
              tool_calls = [];
              thinkingContent = '';
              imageList = [];
              grounding = null;
              currentStepUsage = undefined;
              currentStepSpeed = undefined;
              currentStepFinishReason = undefined;
              streamError = undefined;
              contentParts = [];
              reasoningParts = [];
              contentImageUploads = [];
              reasoningImageUploads = [];
              hasContentImages = false;
              hasReasoningImages = false;
              providerAttemptActive = false;
            };

            const startProviderAttempt = () => {
              if (providerAttemptActive) discardProviderAttempt();
              providerAttemptEpoch += 1;
              providerAttemptEventStart = events.length;
              providerAttemptActive = true;
              return providerAttemptEpoch;
            };

            try {
              log(
                `${stagePrefix} calling model-runtime chat (attempt %d/%d, model: %s, messages: %d, tools: %d)`,
                attempt,
                maxAttempts,
                model,
                processedMessages.length,
                tools?.length ?? 0,
              );

              // Call model-runtime chat through the final, post-injection
              // budget boundary. Provider context-limit failures are handled
              // by the same bounded one-retry flow as preflight compression.
              const remainingExecutionTimeMs = getRemainingExecutionTimeMs(state);
              const callProvider = async (budgetPayload: BudgetedChatStreamPayload) => {
                const currentProviderAttemptEpoch = startProviderAttempt();
                const {
                  messages,
                  providerMedia: _providerMedia,
                  ...providerParams
                } = budgetPayload;
                const providerPayload = {
                  ...providerParams,
                  messages: stripContextMessageIdentity(messages),
                };
                const response = await modelRuntime.chat(
                  providerPayload as unknown as ChatStreamPayload,
                  {
                    ...(remainingExecutionTimeMs === undefined
                      ? {}
                      : { signal: AbortSignal.timeout(Math.max(1, remainingExecutionTimeMs)) }),
                    callback: {
                      onCompletion: async (data) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        // Capture usage (may or may not include cost)
                        if (data.usage) {
                          currentStepUsage = data.usage;
                        }
                        // Capture performance metrics (tps / ttft / duration / latency)
                        if (data.speed) {
                          currentStepSpeed = data.speed;
                        }
                        // Capture provider's terminal finishReason so soft interrupts
                        // (e.g. Gemini RECITATION / MAX_TOKENS with empty content)
                        // are visible in tracing instead of being silently swallowed.
                        if (data.finishReason) {
                          currentStepFinishReason = data.finishReason;
                        }
                        await runtimeTraceOptions.callback.onCompletion?.(data);
                      },
                      onFinal: runtimeTraceOptions.callback.onFinal,
                      onGrounding: async (groundingData) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        log(`[${operationLogId}][grounding] %O`, groundingData);
                        grounding = groundingData;

                        await streamManager.publishStreamChunk(operationId, stepIndex, {
                          chunkType: 'grounding',
                          grounding: groundingData,
                        });
                      },
                      onText: async (text) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        if (firstChunkAt === undefined) {
                          firstChunkAt = Date.now() - llmStartTime;
                        }
                        timing(
                          '[%s] onText received chunk at %d, length: %d',
                          operationLogId,
                          Date.now(),
                          text.length,
                        );
                        content += text;

                        textBuffer += text;

                        // If no timer exists, create one
                        if (!textBufferTimer) {
                          textBufferTimer = setTimeout(async () => {
                            if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                            await flushTextBuffer();
                            textBufferTimer = null;
                          }, BUFFER_INTERVAL);
                        }
                      },
                      onThinking: async (reasoning) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        if (firstChunkAt === undefined) {
                          firstChunkAt = Date.now() - llmStartTime;
                        }
                        timing(
                          '[%s] onThinking received chunk at %d, length: %d',
                          operationLogId,
                          Date.now(),
                          reasoning.length,
                        );
                        thinkingContent += reasoning;

                        // Buffer reasoning content
                        reasoningBuffer += reasoning;

                        // If no timer exists, create one
                        if (!reasoningBufferTimer) {
                          reasoningBufferTimer = setTimeout(async () => {
                            if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                            await flushReasoningBuffer();
                            reasoningBufferTimer = null;
                          }, BUFFER_INTERVAL);
                        }
                      },
                      // Gemini 2.5+/3 multimodal streams deliver assistant text and
                      // reasoning as `content_part`/`reasoning_part` events (triggered by
                      // thought parts / thoughtSignature) instead of plain `text`/
                      // `reasoning`. Without these handlers the text is silently dropped:
                      // `onCompletion` still reports usage tokens, so the empty-completion
                      // guard sees outputTokens > 0 and finalizes the turn to a blank
                      // `done`. Mirror onText/onThinking for text parts so streaming,
                      // persistence and tracing all capture the content; upload image
                      // parts to object storage and serialize the multimodal content
                      // (text + image URLs, in order) — never persist raw base64.
                      onContentPart: async (part) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        if (firstChunkAt === undefined) {
                          firstChunkAt = Date.now() - llmStartTime;
                        }

                        if (part.partType === 'image') {
                          const partIndex = contentParts.length;
                          contentParts.push({
                            image: `data:${part.mimeType || 'image/png'};base64,${part.content}`,
                            type: 'image',
                          });
                          hasContentImages = true;
                          contentImageUploads.push(
                            uploadPartImage(contentParts, partIndex, part.content, part.mimeType),
                          );
                          return;
                        }

                        content += part.content;
                        appendTextPart(contentParts, part.content);
                        textBuffer += part.content;

                        if (!textBufferTimer) {
                          textBufferTimer = setTimeout(async () => {
                            if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                            await flushTextBuffer();
                            textBufferTimer = null;
                          }, BUFFER_INTERVAL);
                        }
                      },
                      onReasoningPart: async (part) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        if (firstChunkAt === undefined) {
                          firstChunkAt = Date.now() - llmStartTime;
                        }

                        if (part.partType === 'image') {
                          const partIndex = reasoningParts.length;
                          reasoningParts.push({
                            image: `data:${part.mimeType || 'image/png'};base64,${part.content}`,
                            type: 'image',
                          });
                          hasReasoningImages = true;
                          reasoningImageUploads.push(
                            uploadPartImage(reasoningParts, partIndex, part.content, part.mimeType),
                          );
                          return;
                        }

                        thinkingContent += part.content;
                        appendTextPart(reasoningParts, part.content);
                        reasoningBuffer += part.content;

                        if (!reasoningBufferTimer) {
                          reasoningBufferTimer = setTimeout(async () => {
                            if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                            await flushReasoningBuffer();
                            reasoningBufferTimer = null;
                          }, BUFFER_INTERVAL);
                        }
                      },
                      onStart: runtimeTraceOptions.callback.onStart,
                      onToolsCalling: async ({ toolsCalling: raw }) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        await runtimeTraceOptions.callback.onToolsCalling?.({
                          chunk: [],
                          toolsCalling: raw,
                        });
                        const resolvedCalls = new ToolNameResolver().resolve(
                          raw,
                          resolved.manifestMap,
                        );
                        // Attach source (origin) and executor (dispatch target) for routing.
                        // `arguments` are kept RAW here on purpose so the tool executor can
                        // still detect malformed JSON and return an `INVALID_JSON_ARGUMENTS`
                        // tool-result with the original bad string — that's the
                        // self-reflection signal the model needs to fix its own output.
                        // Sanitization happens later, only at the persist boundaries
                        // (DB write and state.messages push) to protect strict providers
                        // replaying history. See .
                        const payload = resolvedCalls.map((p) => ({
                          ...p,
                          executor: resolved.executorMap?.[p.identifier],
                          source: resolved.sourceMap[p.identifier],
                        }));
                        // log(`[${operationLogId}][toolsCalling]`, payload);
                        toolsCalling = payload;
                        tool_calls = raw;

                        // If textBuffer exists, flush it first
                        if (!!textBuffer) {
                          await flushTextBuffer();
                        }

                        await streamManager.publishStreamChunk(operationId, stepIndex, {
                          chunkType: 'tools_calling',
                          toolsCalling: payload,
                        });
                      },
                      onError: async (errorData) => {
                        if (currentProviderAttemptEpoch !== providerAttemptEpoch) return;
                        streamError = errorData;
                        console.error(`[${operationLogId}][stream_error]`, errorData);
                      },
                    },
                    metadata: {
                      operationId,
                      topicId: state.metadata?.topicId,
                      trigger: state.metadata?.trigger,
                    },
                    headers: runtimeTraceOptions.headers,
                    user: ctx.userId,
                  },
                );

                await consumeStreamUntilDone(response);
                if (streamError) {
                  const streamExecutionError = new Error(
                    typeof streamError.message === 'string'
                      ? `LLM stream error: ${streamError.message}`
                      : `LLM stream error: ${JSON.stringify(streamError)}`,
                  );
                  const { message: _message, ...restStreamError } = streamError as Record<
                    string,
                    unknown
                  >;
                  Object.assign(streamExecutionError, restStreamError);
                  throw streamExecutionError;
                }
                return response;
              };

              const budgetedCall = await runContextBudgetedCall<
                BudgetedChatStreamPayload,
                Awaited<ReturnType<typeof callProvider>>
              >({
                attemptState: state.metadata?.contextBudget?.attemptState,
                callProvider,
                catalogSnapshot: operationModelCatalogSnapshot,
                compress: compressFinalPayload,
                configuredWindowTokens: resolvedContextWindowTokens,
                modelId: model,
                onContextWindowObserved: ctx.onContextWindowObserved,
                onProviderAttemptDiscard: async ({ attempt: providerAttempt, willRetry }) => {
                  discardProviderAttempt();
                  if (!willRetry) return;

                  await streamManager.publishStreamEvent(operationId, {
                    data: {
                      attempt: providerAttempt + 1,
                      delayMs: 0,
                      maxAttempts: 2,
                      reason: 'context_window',
                      reset: true,
                    },
                    stepIndex,
                    type: 'stream_retry',
                  });
                },
                operationId,
                outputReserveTokens: 1024,
                payload: chatPayload as unknown as BudgetedChatStreamPayload,
                providerId: provider,
              });
              if (budgetedCall.kind === 'fail') {
                const evaluation = budgetedCall.evaluations.at(-1);
                const budgetError = new FinalContextWindowError({
                  contextWindowTokens: evaluation?.window.windowTokens ?? 32_000,
                  model,
                  promptTokens: evaluation?.estimatedPromptTokens ?? 0,
                });
                Object.assign(budgetError, {
                  contextBudget: {
                    decision: budgetedCall.decision,
                    trace: evaluation?.trace,
                  },
                  contextBudgetAttemptState: budgetedCall.attemptState,
                });
                throw budgetError;
              }

              await flushTextBuffer();
              await flushReasoningBuffer();
              clearAttemptBuffers();
              providerAttemptActive = false;

              // Wait for any model-generated image uploads to finish so the
              // persisted multimodal content references S3 URLs, not base64.
              if (contentImageUploads.length > 0 || reasoningImageUploads.length > 0) {
                await Promise.allSettled([...contentImageUploads, ...reasoningImageUploads]);
              }

              // Empty-completion guard: if the model produced
              // nothing actionable — no content, reasoning, tool calls, images,
              // or output tokens — throw so the retry loop below re-attempts the
              // turn instead of finalizing to `done` with a blank assistant
              // message. Skipped when the user interrupted mid-stream, where an
              // empty turn is expected and must not be retried.
              const reportedOutputTokens =
                currentStepUsage && typeof currentStepUsage === 'object'
                  ? (currentStepUsage as { totalOutputTokens?: unknown }).totalOutputTokens
                  : undefined;

              if (
                isEmptyModelCompletion({
                  content,
                  imageCount: imageList.length,
                  outputTokens:
                    typeof reportedOutputTokens === 'number' ? reportedOutputTokens : undefined,
                  reasoning: thinkingContent,
                  toolCallCount: toolsCalling.length + tool_calls.length,
                }) &&
                !(await isOperationInterrupted(ctx))
              ) {
                log(
                  '[%s] Model returned an empty completion (attempt %d/%d) — throwing ModelEmptyError to retry',
                  operationLogId,
                  attempt,
                  maxAttempts,
                );
                throw new ModelEmptyError();
              }

              log(
                `[${operationLogId}] finish model-runtime calling | content: %d chars | reasoning: %d chars | tools: %d | usage: %s`,
                content.length,
                thinkingContent.length,
                toolsCalling.length,
                currentStepUsage ? 'yes' : 'none',
              );

              if (thinkingContent) {
                log(`[${operationLogId}][reasoning]`, thinkingContent);
              }
              if (content) {
                log(`[${operationLogId}][content]`, content);
              }
              if (toolsCalling.length > 0) {
                log(`[${operationLogId}][toolsCalling] `, toolsCalling);
              }

              // Log usage information
              if (currentStepUsage) {
                log(`[${operationLogId}][usage] %O`, currentStepUsage);
              }

              // Add a complete llm_stream event (including all streaming chunks)
              events.push({
                result: {
                  content,
                  finishReason: currentStepFinishReason,
                  reasoning: thinkingContent,
                  tool_calls,
                  usage: currentStepUsage,
                },
                type: 'llm_result',
              });

              // Publish stream end event
              await streamManager.publishStreamEvent(operationId, {
                data: {
                  finalContent: content,
                  grounding,
                  ...(stepLabel && { stepLabel }),
                  imageList: imageList.length > 0 ? imageList : undefined,
                  reasoning: thinkingContent || undefined,
                  toolsCalling,
                  usage: currentStepUsage,
                },
                stepIndex,
                type: 'stream_end',
              });

              log('[%s:%d] call_llm completed', operationId, stepIndex);

              // ===== 1. First save original usage to message.metadata =====
              // Determine final content - use serialized parts if has images, otherwise plain text
              const finalContent = hasContentImages
                ? serializePartsForStorage(contentParts)
                : content;

              // Determine final reasoning - handle multimodal reasoning
              let finalReasoning: any = undefined;
              if (hasReasoningImages) {
                // Has images, use multimodal format
                finalReasoning = {
                  content: serializePartsForStorage(reasoningParts),
                  isMultimodal: true,
                };
              } else if (thinkingContent) {
                // Has text from reasoning but no images
                finalReasoning = {
                  content: thinkingContent,
                };
              }

              // preserveThinking only gates whether reasoning is replayed into the
              // next LLM payload (state.messages); the DB copy powers UI display
              // after refresh and must always be saved.
              const replayedReasoning = shouldReplayAssistantReasoning ? finalReasoning : undefined;

              try {
                // Build metadata object
                const metadata: Record<string, any> = {};
                if (currentStepUsage && typeof currentStepUsage === 'object') {
                  // Flat fields are kept for backward-compatible readers; `usage`
                  // is the canonical nested shape new readers should consume.
                  Object.assign(metadata, currentStepUsage);
                  metadata.usage = currentStepUsage;
                }
                if (currentStepSpeed && typeof currentStepSpeed === 'object') {
                  Object.assign(metadata, currentStepSpeed);
                  metadata.performance = currentStepSpeed;
                }
                if (hasContentImages) {
                  metadata.isMultimodal = true;
                }

                // Sanitize tool_call `arguments` before persisting to DB so malformed
                // JSON (e.g. Qwen emitting `{, ...}`) can't poison future context
                // builds and 400 strict providers like NVIDIA NIM. See .
                const persistedTools =
                  toolsCalling.length > 0
                    ? toolsCalling.map((t) => ({
                        ...t,
                        arguments: sanitizeToolCallArguments(t.arguments),
                      }))
                    : undefined;

                await ctx.messageModel.update(assistantMessageItem.id, {
                  content: finalContent,
                  imageList: imageList.length > 0 ? imageList : undefined,
                  metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                  reasoning: finalReasoning,
                  search: grounding,
                  tools: persistedTools,
                });
              } catch (error) {
                console.error('[call_llm] Failed to update message:', error);
              }

              // ===== 2. Then accumulate to AgentState =====
              const newState = structuredClone(state);
              if (persistedAutoCompression) {
                newState.messages = structuredClone(persistedAutoCompression.stateMessages);
              }
              newState.metadata = {
                ...newState.metadata,
                contextBudget: {
                  ...newState.metadata?.contextBudget,
                  attemptState: budgetedCall.attemptState,
                  trace: budgetedCall.evaluations.at(-1)?.trace,
                },
              };

              // state.messages flows into the next LLM call payload, so entries
              // must be safe for strict-provider history replay:
              //   - drop tool_calls with empty name (undispatchable, and strict
              //     providers 400 on nameless entries)
              //   - coerce malformed JSON `arguments` to valid JSON
              const sanitizedToolCalls =
                tool_calls.length > 0
                  ? tool_calls
                      .filter((tc) => !!tc.function.name)
                      .map((tc) => ({
                        ...tc,
                        function: {
                          ...tc.function,
                          arguments: sanitizeToolCallArguments(tc.function.arguments),
                        },
                      }))
                  : [];
              const stateToolCalls = sanitizedToolCalls.length > 0 ? sanitizedToolCalls : undefined;

              newState.messages.push({
                content,
                id: assistantMessageItem.id,
                reasoning: replayedReasoning,
                role: 'assistant',
                tool_calls: stateToolCalls,
              });

              if (currentStepUsage) {
                // Use UsageCounter to uniformly accumulate usage and cost
                const { usage, cost } = UsageCounter.accumulateLLM({
                  cost: newState.cost,
                  model: llmPayload.model,
                  modelUsage: currentStepUsage,
                  provider: llmPayload.provider,
                  usage: newState.usage,
                });

                newState.usage = usage;
                if (cost) newState.cost = cost;
              }

              // Propagate stepLabel from instruction to state metadata for hook consumers
              if (stepLabel) {
                if (!newState.metadata) newState.metadata = {};
                newState.metadata._stepLabel = stepLabel;
              }

              // Record chat response attributes on the OTel span.
              const usageRecord = currentStepUsage as
                | {
                    inputCachedTokens?: number;
                    outputReasoningTokens?: number;
                    totalInputTokens?: number;
                    totalOutputTokens?: number;
                  }
                | undefined;
              chatSpan.setAttributes(
                buildChatResponseAttributes({
                  cacheReadInputTokens: usageRecord?.inputCachedTokens,
                  finishReasons: currentStepFinishReason ? [currentStepFinishReason] : undefined,
                  inputTokens: usageRecord?.totalInputTokens,
                  outputTokens: usageRecord?.totalOutputTokens,
                  reasoningOutputTokens: usageRecord?.outputReasoningTokens,
                  timeToFirstChunkMs: firstChunkAt,
                }),
              );

              return {
                events,
                newState,
                nextContext: {
                  payload: {
                    hasToolsCalling: toolsCalling.length > 0,
                    // Pass assistant message ID as parentMessageId for tool calls
                    parentMessageId: assistantMessageItem.id,
                    result: { content, tool_calls },
                    toolsCalling,
                  } as GeneralAgentCallLLMResultPayload,
                  phase: 'llm_result' as const,
                  session: {
                    eventCount: events.length,
                    messageCount: newState.messages.length,
                    sessionId: operationId,
                    status: 'running' as const,
                    stepCount: state.stepCount + 1,
                  },
                  stepUsage: currentStepUsage,
                },
              };
            } catch (error) {
              clearAttemptBuffers();

              const runtimeBudgetReason = getExecutionBudgetReason(state);
              if (runtimeBudgetReason) {
                throw new ExecutionBudgetExceededError(runtimeBudgetReason);
              }

              const classified = classifyLLMError(error);
              const interrupted = await isOperationInterrupted(ctx);

              const retryBudget = resolveLLMRetryBudget(provider, error);

              if (!interrupted && shouldRetryLLM(classified.kind, attempt, retryBudget)) {
                const delayMs = getLLMRetryDelayMs(attempt, error);

                log(
                  '[%s] LLM call failed with kind=%s (attempt %d/%d), retrying in %dms ...',
                  operationLogId,
                  classified.kind,
                  attempt,
                  maxAttempts,
                  delayMs,
                );

                await streamManager.publishStreamEvent(operationId, {
                  data: { attempt: attempt + 1, delayMs, maxAttempts },
                  stepIndex,
                  type: 'stream_retry',
                });

                await sleep(delayMs);

                if (await isOperationInterrupted(ctx)) {
                  throw error;
                }

                continue;
              }

              // Cancel/interrupt path: when the user stops mid-stream, the model-runtime
              // stream is aborted before reaching the post-stream finalize (line ~1078),
              // so the DB row remains a LOADING_FLAT placeholder. Without this fix,
              // agent_runtime_end would push the placeholder as the source-of-truth
              // to the client, clobbering the streamed content accumulated in memory.
              // We persist whatever partial content the stream callbacks already
              // accumulated so that reload/end snapshots reflect actual progress.
              if (interrupted && (content || thinkingContent || toolsCalling.length > 0)) {
                try {
                  const persistedTools =
                    toolsCalling.length > 0
                      ? toolsCalling.map((t) => ({
                          ...t,
                          arguments: sanitizeToolCallArguments(t.arguments),
                        }))
                      : undefined;
                  const interruptedReasoning = thinkingContent
                    ? { content: thinkingContent }
                    : undefined;
                  const interruptedMetadata: Record<string, any> = { interruptedMidStream: true };
                  if (currentStepUsage && typeof currentStepUsage === 'object') {
                    Object.assign(interruptedMetadata, currentStepUsage);
                    interruptedMetadata.usage = currentStepUsage;
                  }
                  if (currentStepSpeed && typeof currentStepSpeed === 'object') {
                    Object.assign(interruptedMetadata, currentStepSpeed);
                    interruptedMetadata.performance = currentStepSpeed;
                  }
                  await ctx.messageModel.update(assistantMessageItem.id, {
                    content,
                    metadata: interruptedMetadata,
                    reasoning: interruptedReasoning,
                    tools: persistedTools,
                  });
                  log(
                    '[%s] Interrupted finalize: persisted partial content (c=%d r=%d tools=%d)',
                    operationLogId,
                    content.length,
                    thinkingContent.length,
                    toolsCalling.length,
                  );
                } catch (persistErr) {
                  log('[%s] Interrupted finalize update failed: %O', operationLogId, persistErr);
                }
              }

              throw error;
            }
          }

          throw new Error('LLM execution retry loop exited unexpectedly');
        });
      } catch (error) {
        chatSpan.recordException(error as Error);
        chatSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        chatSpan.end();
      }
    } catch (error) {
      if (error instanceof ExecutionBudgetExceededError) {
        return interruptForExecutionGuard(state, error.reason, instruction);
      }

      // Publish error event
      await streamManager.publishStreamEvent(operationId, {
        data: formatErrorEventData(error, 'llm_execution'),
        stepIndex,
        type: 'error',
      });

      console.error(
        `[StreamingLLMExecutor][${operationId}:${stepIndex}] LLM execution failed:`,
        error,
      );
      throw error;
    }
  },

  compress_context: async (instruction, state) => {
    const { payload } = instruction as AgentInstructionCompressContext;
    const { messages, currentTokenCount } = payload;
    const budgetPayload = payload as AgentInstructionCompressContext['payload'] & {
      catalogSnapshot?: ModelCatalogSnapshot;
      observedWindowTokens?: number;
      outputReserveTokens?: number;
      payloadFingerprint?: string;
      providerMedia?: unknown[];
      sentPayloadFingerprints?: readonly string[];
      trigger?: 'final-preflight' | 'manual' | 'provider-error' | 'threshold';
    };
    const { operationId, stepIndex } = ctx;
    const operationLogId = `${operationId}:${stepIndex}`;
    const stagePrefix = `[${operationLogId}][compress_context]`;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const topicId = state.metadata?.topicId;
    const lastMessage = messages.at(-1);
    const preservedMessages =
      messages.length > 1 && lastMessage?.role === 'user' ? [lastMessage] : [];
    const preservedMessageIds = new Set(
      preservedMessages.map((message) => message.id).filter((id): id is string => Boolean(id)),
    );
    const messagesToCompress = preservedMessages.length > 0 ? messages.slice(0, -1) : messages;
    const compressedMessagesFallback = [...messagesToCompress, ...preservedMessages];
    const inputMeasurement = countContextTokens({ messages, tools: state.tools });
    const payloadFingerprint =
      budgetPayload.payloadFingerprint || inputMeasurement.payloadFingerprint;
    const compressionTrigger = budgetPayload.trigger ?? 'threshold';
    const forwardedBudgetContext = {
      catalogSnapshot: budgetPayload.catalogSnapshot,
      observedWindowTokens: budgetPayload.observedWindowTokens,
      outputReserveTokens: budgetPayload.outputReserveTokens,
      providerMedia: budgetPayload.providerMedia,
      sentPayloadFingerprints: budgetPayload.sentPayloadFingerprints,
    };
    const skippedCompressionPayload = (params: {
      compressedMessages: unknown[];
      groupId?: string;
      parentMessageId?: string;
    }) => ({
      ...forwardedBudgetContext,
      afterTokens: currentTokenCount,
      attempt: 1 as const,
      beforeTokens: currentTokenCount,
      code: 'NO_CANDIDATES' as const,
      compressedMessages: params.compressedMessages,
      groupId: params.groupId ?? '',
      outcome: 'skipped' as const,
      parentMessageId: params.parentMessageId,
      payloadFingerprint,
      skipped: true,
      trigger: compressionTrigger,
    });
    const failedCompressionPayload = (params: {
      compressedMessages: unknown[];
      groupId?: string;
      parentMessageId?: string;
    }) => ({
      ...forwardedBudgetContext,
      afterTokens: currentTokenCount,
      attempt: 1 as const,
      beforeTokens: currentTokenCount,
      code: 'SUMMARY_FAILED' as const,
      compressedMessages: params.compressedMessages,
      groupId: params.groupId ?? '',
      outcome: 'failed' as const,
      parentMessageId: params.parentMessageId,
      payloadFingerprint,
      trigger: compressionTrigger,
    });
    let pendingCompression:
      | {
          groupId: string;
          messageService: MessageService;
          query: { agentId?: string; threadId?: string; topicId: string };
        }
      | undefined;
    const settlePendingCompression = async (cancelled: boolean) => {
      if (!pendingCompression) return;
      const pending = pendingCompression;
      if (cancelled) {
        await pending.messageService.cancelCompression(pending.groupId, pending.query);
      } else {
        await pending.messageService.failCompression(pending.groupId, pending.query);
      }
      pendingCompression = undefined;
    };

    if (!topicId || !ctx.userId) {
      return {
        events,
        newState,
        nextContext: {
          payload: {
            ...skippedCompressionPayload({ compressedMessages: compressedMessagesFallback }),
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    }

    if (ctx.hookDispatcher) {
      ctx.hookDispatcher
        .dispatch(
          operationId,
          'beforeCompact',
          {
            messageCount: messagesToCompress.length,
            operationId,
            stepIndex,
            tokenCount: currentTokenCount,
            userId: ctx.userId,
          },
          state.metadata?._hooks,
        )
        .catch(() => {});
    }

    try {
      const dbMessages = await ctx.messageModel.query(
        {
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId,
        },
        { postProcessUrl: buildPostProcessUrl(ctx) },
      );

      const messageIds = dbMessages
        .filter(
          (message) =>
            message.role !== 'compressedGroup' &&
            Boolean(message.id) &&
            !preservedMessageIds.has(message.id),
        )
        .map((message) => message.id);

      if (messageIds.length === 0 || messagesToCompress.length === 0) {
        return {
          events,
          newState,
          nextContext: {
            payload: {
              ...skippedCompressionPayload({ compressedMessages: compressedMessagesFallback }),
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          },
        };
      }

      const latestAssistantMessage = dbMessages.findLast((message) => message.role === 'assistant');
      const messageService = new MessageService(
        ctx.serverDB,
        ctx.userId,
        state.metadata?.workspaceId ?? ctx.workspaceId,
      );
      const compressionResult = await messageService.createCompressionGroup(topicId, messageIds, {
        agentId: state.metadata?.agentId,
        threadId: state.metadata?.threadId,
        topicId,
      });
      pendingCompression = {
        groupId: compressionResult.messageGroupId,
        messageService,
        query: {
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId,
        },
      };

      const compressionModel =
        newState.modelRuntimeConfig?.compressionModel || newState.modelRuntimeConfig;

      if (!compressionModel?.model || !compressionModel?.provider) {
        await settlePendingCompression(false);
        return {
          events,
          newState,
          nextContext: {
            payload: {
              ...failedCompressionPayload({
                compressedMessages: compressedMessagesFallback,
                groupId: compressionResult.messageGroupId,
                parentMessageId: latestAssistantMessage?.id,
              }),
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          },
        };
      }

      const initModelRuntime = requireRuntimeBoundary(ctx.initModelRuntime, 'initModelRuntime');
      const compressionRuntime = await initModelRuntime(
        ctx.serverDB,
        ctx.userId,
        compressionModel.provider,
        ctx.workspaceId,
      );

      let summaryContent = '';
      const summaryUsages: any[] = [];
      const summaryWindow = resolveCompressionSummaryBudgetTokens({
        compressionModel,
        compressionModelCatalogSnapshot: newState.metadata?.compressionModelCatalogSnapshot as
          | ModelCatalogSnapshot
          | undefined,
        mainModelCatalogSnapshot: newState.metadata?.modelCatalogSnapshot as
          | ModelCatalogSnapshot
          | undefined,
      });
      const hierarchy = await compressContextHierarchically<
        UIChatMessage,
        Partial<ChatStreamPayload>
      >({
        buildRequest: (items) =>
          chainCompressContext(
            items.map(
              (item, index) =>
                ({
                  content: item.text,
                  createdAt: Date.now(),
                  id: `summary-input-${index}`,
                  role: 'user',
                  updatedAt: Date.now(),
                }) as UIChatMessage,
            ),
          ),
        candidateIds: messageIds,
        createSummaryMessage: (summary) => {
          summaryContent = summary;
          return {
            content: summary,
            createdAt: Date.now(),
            id: compressionResult.messageGroupId,
            role: 'user',
            updatedAt: Date.now(),
          } as UIChatMessage;
        },
        getMessageId: (message, index) => message.id || `compression-message-${index}`,
        groupId: compressionResult.messageGroupId,
        measurePayload: (payloadMessages) => {
          const measurement = countContextTokens({
            messages: [...payloadMessages],
            providerMedia: collectProviderMediaTokenEstimates(
              payloadMessages as Readonly<ChatStreamPayload['messages']>,
              messages as UIChatMessage[],
            ),
          });
          return {
            payloadFingerprint: measurement.payloadFingerprint,
            tokens: measurement.adjustedTotal,
          };
        },
        measureRequest: (request) =>
          countContextTokens({ messages: (request.messages ?? []) as UIChatMessage[] })
            .adjustedTotal,
        messages: compressionResult.messagesToSummarize as UIChatMessage[],
        renderMessage: renderMessageForCompression,
        summarize: async (request) => {
          let chunkSummary = '';
          let summaryError: any;
          const compressionResponse = await compressionRuntime.chat(
            {
              ...request,
              messages: request.messages ?? [],
              model: compressionModel.model,
              stream: true,
            },
            {
              callback: {
                onCompletion: async (data) => {
                  if (data.usage) summaryUsages.push(data.usage);
                },
                onError: async (errorData) => {
                  summaryError = errorData;
                },
                onText: async (text) => {
                  chunkSummary += text;
                },
              },
              user: ctx.userId,
            },
          );
          await consumeStreamUntilDone(compressionResponse);
          if (summaryError) {
            throw new Error(
              typeof summaryError.message === 'string'
                ? summaryError.message
                : JSON.stringify(summaryError),
            );
          }
          return chunkSummary;
        },
        summaryModelBudgetTokens: summaryWindow,
        trigger: compressionTrigger,
      });
      if (hierarchy.outcome.outcome !== 'compressed' || !summaryContent) {
        throw new Error(
          ('code' in hierarchy.outcome && hierarchy.outcome.code) || 'SUMMARY_FAILED',
        );
      }

      const finalCompression = await messageService.finalizeCompression(
        compressionResult.messageGroupId,
        summaryContent,
        {
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId,
        },
      );
      pendingCompression = undefined;

      const compressedMessagesBase =
        finalCompression.messages || compressionResult.messagesToSummarize;
      const compressedMessages = [...compressedMessagesBase];

      for (const preservedMessage of preservedMessages) {
        if (
          !compressedMessages.some(
            (message) =>
              message === preservedMessage ||
              (Boolean(message.id) &&
                Boolean(preservedMessage.id) &&
                message.id === preservedMessage.id),
          )
        ) {
          compressedMessages.push(preservedMessage);
        }
      }

      newState.messages = compressedMessages;

      for (const summaryUsage of summaryUsages) {
        const { usage, cost } = UsageCounter.accumulateLLM({
          cost: newState.cost,
          model: compressionModel.model,
          modelUsage: summaryUsage,
          provider: compressionModel.provider,
          usage: newState.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;
      }

      events.push({
        groupId: compressionResult.messageGroupId,
        parentMessageId: latestAssistantMessage?.id,
        type: 'compression_complete',
      });

      if (ctx.hookDispatcher) {
        ctx.hookDispatcher
          .dispatch(
            operationId,
            'afterCompact',
            {
              groupId: compressionResult.messageGroupId,
              messagesAfter: compressedMessages.length,
              messagesBefore: messagesToCompress.length,
              operationId,
              stepIndex,
              summary: summaryContent.slice(0, 500),
              userId: ctx.userId,
            },
            state.metadata?._hooks,
          )
          .catch(() => {});
      }

      return {
        events,
        newState,
        nextContext: {
          payload: {
            ...forwardedBudgetContext,
            afterTokens: countContextTokens({ messages: compressedMessages, tools: state.tools })
              .adjustedTotal,
            attempt: 1,
            beforeTokens: currentTokenCount,
            compressedMessages,
            groupId: compressionResult.messageGroupId,
            outcome: 'compressed',
            parentMessageId: latestAssistantMessage?.id,
            payloadFingerprint,
            trigger: compressionTrigger,
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: compressedMessages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    } catch (error) {
      const failedGroupId = pendingCompression?.groupId;
      try {
        await settlePendingCompression(isAbortError(error));
      } catch (rollbackError) {
        log(`${stagePrefix} Compression rollback failed. error=%O`, rollbackError);
      }
      log(
        `${stagePrefix} Compression failed. originalTokens=%d error=%O`,
        currentTokenCount,
        error,
      );

      if (ctx.hookDispatcher) {
        ctx.hookDispatcher
          .dispatch(
            operationId,
            'onCompactError',
            {
              error: error instanceof Error ? error.message : String(error),
              operationId,
              stepIndex,
              tokenCount: currentTokenCount,
              userId: ctx.userId,
            },
            state.metadata?._hooks,
          )
          .catch(() => {});
      }

      events.push({ error, type: 'compression_error' });

      return {
        events,
        newState,
        nextContext: {
          payload: {
            ...failedCompressionPayload({
              compressedMessages: compressedMessagesFallback,
              groupId: failedGroupId,
            }),
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    }
  },
  /**
   * Tool execution
   */
  call_tool: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const preflightBudgetReason = getExecutionBudgetReason(state);
    if (preflightBudgetReason) {
      return interruptForExecutionGuard(state, preflightBudgetReason, instruction);
    }

    const operationLogId = `${operationId}:${stepIndex}`;
    log(`[${operationLogId}] payload: %O`, payload);

    // Publish tool execution start event
    await streamManager.publishStreamEvent(operationId, {
      data: payload,
      stepIndex,
      type: 'tool_start',
    });

    // payload is { parentMessageId, toolCalling: ChatToolPayload }
    const chatToolPayload: ChatToolPayload = payload.toolCalling;

    const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;
    const existingToolStats = state.usage?.tools?.byTool?.find((t) => t.name === toolName);
    const callIndex = (existingToolStats?.calls ?? 0) + 1;

    let parsedArgs: Record<string, any> = {};
    try {
      parsedArgs =
        typeof chatToolPayload.arguments === 'string'
          ? JSON.parse(chatToolPayload.arguments)
          : (chatToolPayload.arguments ?? {});
    } catch {
      // Keep malformed tool arguments as an empty preview payload; execution still uses raw args.
    }

    // OTel execute_tool span. Created up-front so it survives every exit path
    // (client-tool pause / success / error), ended in finally.
    const toolSource =
      state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
      state.toolSourceMap?.[chatToolPayload.identifier];
    const executeToolSpan = agentRuntimeTracer.startSpan(executeToolSpanName(toolName), {
      attributes: buildExecuteToolAttributes({
        operationId,
        stepIndex,
        toolCallId: chatToolPayload.id,
        toolName,
        toolSource,
        toolType: GEN_AI_FUNCTION_TOOL_TYPE,
      }),
    });

    try {
      try {
        if (toolSource === 'client') {
          log(`[${operationLogId}] Client function tool detected: ${toolName}, pausing for client`);

          // Publish tool call info so streaming can emit function_call events
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'tools_calling',
            toolsCalling: [chatToolPayload] as any,
          });

          const newState = structuredClone(state);
          newState.lastModified = new Date().toISOString();
          newState.status = 'waiting_for_async_tool';
          newState.interruption = {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            interruptedInstruction: instruction,
            reason: 'client_tool_execution',
          };
          newState.pendingToolsCalling = [chatToolPayload];

          return {
            events: [
              {
                canResume: true,
                interruptedAt: new Date().toISOString(),
                reason: 'client_tool_execution',
                type: 'interrupted',
              },
            ],
            newState,
            // No nextContext — loop stops, waiting for client to provide tool result
          };
        }

        // Extract toolResultMaxLength from agent config
        const agentConfig = state.metadata?.agentConfig;
        const toolResultMaxLength = agentConfig?.chatConfig?.toolResultMaxLength;

        // Build effective manifest map (operation + step-level activations)
        const effectiveManifestMap = {
          ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
          ...Object.fromEntries(
            (state.activatedStepTools ?? [])
              .filter((a) => a.manifest)
              .map((a) => [a.id, a.manifest!]),
          ),
        };

        // Route to client via Agent Gateway WS when the tool is marked
        // executor='client' and the current stream manager can reach a gateway.
        // Falls through to the normal server path if either is unavailable.
        const canDispatchToClient =
          chatToolPayload.executor === 'client' &&
          typeof streamManager.sendToolExecute === 'function' &&
          !requiresServerDeviceTransport(state, chatToolPayload);

        let toolCallMocked = false;
        const hookResult = ctx.hookDispatcher
          ? await (async () => {
              // 1. dispatch for observation (webhook in production, local handler logging)
              ctx
                .hookDispatcher!.dispatch(
                  operationId,
                  'beforeToolCall',
                  {
                    apiName: chatToolPayload.apiName,
                    args: parsedArgs,
                    callIndex,
                    identifier: chatToolPayload.identifier,
                    operationId,
                    stepIndex,
                    userId: ctx.userId,
                  },
                  state.metadata?._hooks,
                )
                .catch(() => {});
              // 2. dispatchBeforeToolCall for mock support (local-only)
              return ctx.hookDispatcher!.dispatchBeforeToolCall(operationId, {
                apiName: chatToolPayload.apiName,
                args: parsedArgs,
                callIndex,
                identifier: chatToolPayload.identifier,
                stepIndex,
              });
            })()
          : null;

        let execution: { result: ToolExecutionResultResponse; attempts: number };
        let preparedExecutionContext: PreparedToolExecutionContext = {
          executionContext: getFrozenExecutionContext(state),
        };
        if (isDeviceToolIdentifier(chatToolPayload.identifier) && !hookResult?.isMocked) {
          // Per-call audit for device tools (local-system / remote-device).
          // Emitted before dispatch so the record exists even if dispatch
          // throws. We rely on the engine's enable gate to keep `canUseDevice`
          // true here; recording the policy reason inline lets an operator
          // distinguish first-party vs bot-owner runs without joining logs.
          const policy = state.metadata?.deviceAccessPolicy as
            | { canUseDevice: boolean; reason: DeviceAccessReason }
            | undefined;
          logDeviceToolAudit({
            apiName: chatToolPayload.apiName,
            botContext: state.metadata?.botContext,
            canUseDevice: policy?.canUseDevice ?? true,
            messageId: state.metadata?.sourceMessageId,
            operationId,
            reason: policy?.reason ?? 'first-party',
            toolIdentifier: chatToolPayload.identifier,
            topicId: ctx.topicId,
            userId: ctx.userId,
          });
        }

        if (hookResult?.isMocked) {
          log(`[${operationLogId}] Tool ${toolName} mocked by beforeToolCall hook`);
          toolCallMocked = true;
          execution = {
            attempts: 0,
            result: { content: hookResult.content, executionTime: 0, success: true },
          };
        } else if (canDispatchToClient) {
          preparedExecutionContext = await prepareToolExecutionContext(ctx, state, chatToolPayload);
          log(`[${operationLogId}] Dispatching tool ${toolName} to client via Agent Gateway`);
          const timeoutMs = clampToolTimeoutToExecutionBudget(
            state,
            resolveToolTimeoutMs({
              apiName: chatToolPayload.apiName,
              args: parsedArgs,
              manifest: effectiveManifestMap[chatToolPayload.identifier],
            }),
          );
          const dispatchResult = await dispatchClientTool(chatToolPayload, {
            deviceId:
              preparedExecutionContext.executionContext?.plan.kind === 'device'
                ? preparedExecutionContext.executionContext.plan.deviceId
                : undefined,
            executionContext: projectExecutionContextForClient(
              state,
              preparedExecutionContext.executionContext,
            ),
            operationId,
            streamManager,
            timeoutMs,
            topicId: state.metadata?.topicId ?? ctx.topicId,
          });
          execution = { attempts: 1, result: dispatchResult };
        } else {
          preparedExecutionContext = await prepareToolExecutionContext(ctx, state, chatToolPayload);
          // Inject source from sourceMap so BuiltinToolsExecutor can route
          // lobehubSkill / composio tools correctly (LLM responses don't carry source)
          if (toolSource && !chatToolPayload.source) {
            chatToolPayload.source = toolSource;
          }

          const timeoutMs = clampToolTimeoutToExecutionBudget(
            state,
            resolveToolTimeoutMs({
              apiName: chatToolPayload.apiName,
              args: parsedArgs,
              manifest: effectiveManifestMap[chatToolPayload.identifier],
            }),
          );
          // Execute tool using ToolExecutionService
          log(`[${operationLogId}] Executing tool ${toolName} ...`);
          execution = await executeToolWithRetry(
            () =>
              toolExecutionService.executeTool(chatToolPayload, {
                activeDeviceId: getExecutionDeviceId(
                  state,
                  preparedExecutionContext.executionContext,
                ),
                agentId: state.metadata?.agentId,
                agentMember: buildServerAgentMemberRunner(
                  ctx,
                  state,
                  chatToolPayload,
                  payload.parentMessageId,
                ),
                documentId: state.metadata?.documentId,
                editingAgentId: state.metadata?.editingAgentId,
                execSubAgent: ctx.execSubAgent,
                executionContext: preparedExecutionContext.executionContext,
                executionTimeoutMs: timeoutMs,
                groupId: state.metadata?.groupId,
                isSubAgent: state.metadata?.isSubAgent === true,
                memoryToolPermission: agentConfig?.chatConfig?.memory?.toolPermission,
                messageId: state.metadata?.sourceMessageId,
                modelCatalogSnapshot: state.metadata?.modelCatalogSnapshot,
                operationId,
                projectSkills: (
                  state.metadata?.skillRegistryResult?.skills ??
                  state.metadata?.operationSkillSet?.skills ??
                  []
                )
                  .filter(
                    (skill: { location?: string; source?: string }) =>
                      skill.source === 'project' && !!skill.location,
                  )
                  .map((skill: { location: string; name: string }) => ({
                    location: skill.location,
                    name: skill.name,
                  })),
                scope: state.metadata?.scope,
                serverDB: ctx.serverDB,
                skipResultTruncation: true,
                skillRegistryResult: state.metadata?.skillRegistryResult,
                subAgent: buildServerVirtualSubAgentRunner(
                  ctx,
                  state,
                  chatToolPayload,
                  payload.parentMessageId,
                ),
                taskId: state.metadata?.taskId,
                threadId: state.metadata?.threadId,
                toolCallId: chatToolPayload.id,
                toolManifestMap: effectiveManifestMap,
                toolResultMaxLength,
                topicId: ctx.topicId,
                userId: ctx.userId,
                workspaceId: state.metadata?.workspaceId ?? ctx.workspaceId,
              }),
            {
              isInterrupted: () => isOperationInterrupted(ctx),
              maxRetries: TOOL_MAX_RETRIES,
              operationLogId,
              toolName,
            },
          );
        }

        // Deferred tool (e.g. async sub-agent): the executor performed its
        // side-effect and created a pending placeholder; the real result is
        // delivered out-of-band later by a completion bridge. Park like a
        // client tool — surface the pending call, hold it in pendingToolsCalling,
        // and do not write a tool_result now.
        if (execution.result.deferred) {
          log(`[${operationLogId}] Tool ${toolName} deferred; parking for async result`);
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'tools_calling',
            toolsCalling: [chatToolPayload] as any,
          });
          executeToolSpan.setAttributes(
            buildExecuteToolResultAttributes({ attempts: execution.attempts, success: true }),
          );
          const newState = structuredClone(state);
          newState.lastModified = new Date().toISOString();
          newState.status = 'waiting_for_async_tool';
          newState.interruption = {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: 'async_tool',
          };
          newState.pendingToolsCalling = [chatToolPayload];
          return {
            events: [
              {
                canResume: true,
                interruptedAt: new Date().toISOString(),
                reason: 'async_tool',
                type: 'interrupted',
              },
            ],
            newState,
          };
        }

        // Post-success workspace coordination. Shared with call_tools_batch:
        // the bind can change which context the next step runs in, but it can
        // never fail, drop, or delay the result of the tool that just ran.
        // Without a success there is no bind to owe, and a scratch root merely
        // proposed for a failed tool is dropped rather than frozen — only a
        // committed bind may move the topic's execution context, and the next
        // cwd-dependent tool re-proposes the same deterministic root.
        const scratchSettlement: ScratchBindSettlement = execution.result.success
          ? await settleScratchBindAfterToolSuccess({
              ctx,
              operationLogId,
              prepared: preparedExecutionContext,
              state,
              toolName,
            })
          : {
              executionContext: preparedExecutionContext.scratchRoot
                ? getFrozenExecutionContext(state)
                : preparedExecutionContext.executionContext,
            };

        const postDispatchPathConsent = getPostDispatchWorkspacePathConsent({
          activeDeviceId: state.metadata?.activeDeviceId,
          operationId,
          result: execution.result,
          topicId: ctx.topicId ?? state.metadata?.topicId,
        });
        if (postDispatchPathConsent && requiresInteractivePathConsent(state)) {
          const pendingState = {
            ...(execution.result.state && typeof execution.result.state === 'object'
              ? execution.result.state
              : {}),
            workspacePathConsent: postDispatchPathConsent,
          };
          let toolMessageId: string;
          if (payload.skipCreateToolMessage) {
            toolMessageId = payload.parentMessageId;
            await ctx.messageModel.updateToolMessage(toolMessageId, {
              content: '',
              pluginState: pendingState,
            });
            await ctx.messageModel.updateMessagePlugin(toolMessageId, {
              intervention: { status: 'pending' },
            });
          } else {
            const toolMessage = await ctx.messageModel.create({
              agentId: state.metadata!.agentId!,
              content: '',
              parentId: payload.parentMessageId,
              plugin: chatToolPayload as any,
              pluginIntervention: { status: 'pending' },
              pluginState: pendingState,
              role: 'tool',
              threadId: state.metadata?.threadId,
              tool_call_id: chatToolPayload.id,
              topicId: state.metadata?.topicId,
            });
            toolMessageId = toolMessage.id;
          }

          await streamManager.publishStreamEvent(operationId, {
            data: {
              pendingToolsCalling: [chatToolPayload],
              phase: 'human_approval',
              requiresApproval: true,
            },
            stepIndex,
            type: 'step_start',
          });
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'tools_calling',
            toolMessageIds: { [chatToolPayload.id]: toolMessageId },
            toolsCalling: [chatToolPayload] as any,
          } as any);

          executeToolSpan.setAttributes(
            buildExecuteToolResultAttributes({ attempts: execution.attempts, success: false }),
          );
          const newState = structuredClone(state);
          applyScratchBindSettlement(newState, scratchSettlement);
          newState.lastModified = new Date().toISOString();
          newState.pendingToolsCalling = [chatToolPayload];
          newState.status = 'waiting_for_human';
          return {
            events: [
              {
                operationId,
                pendingToolsCalling: [chatToolPayload],
                type: 'human_approve_required',
              },
              { toolCalls: [chatToolPayload] as any, type: 'tool_pending' },
            ],
            newState,
          };
        }

        const activation = validateSkillActivationResult(
          state.metadata?.operationSkillSet?.skills,
          chatToolPayload,
          execution.result,
          operationId,
        );
        const executionResult = await archiveRuntimeToolResult(activation.result, {
          agentId: state.metadata?.agentId,
          identifier: chatToolPayload.identifier,
          limit: toolResultMaxLength,
          serverDB: ctx.serverDB,
          toolCallId: chatToolPayload.id,
          topicId: ctx.topicId ?? state.metadata?.topicId,
          userId: ctx.userId,
          workspaceId: state.metadata?.workspaceId ?? ctx.workspaceId,
        });
        const executionTime = executionResult.executionTime;
        const isSuccess = executionResult.success;
        if (ctx.hookDispatcher) {
          ctx.hookDispatcher
            .dispatch(
              operationId,
              'afterToolCall',
              {
                apiName: chatToolPayload.apiName,
                args: parsedArgs,
                callIndex,
                content: executionResult.content,
                executionTimeMs: executionTime,
                identifier: chatToolPayload.identifier,
                mocked: toolCallMocked,
                operationId,
                stepIndex,
                success: isSuccess,
                userId: ctx.userId,
              },
              state.metadata?._hooks,
            )
            .catch(() => {});
        }
        log(
          `[${operationLogId}] Executing ${toolName} in ${executionTime}ms, result: %O`,
          chatToolPayload.identifier === 'lobe-skills' &&
            chatToolPayload.apiName === 'activateSkill'
            ? {
                success: isSuccess,
                skillKey: activation.skill?.key,
                errorCode: executionResult.state?.errorCode,
              }
            : executionResult,
        );

        // Publish tool execution result event
        await streamManager.publishStreamEvent(operationId, {
          data: {
            executionTime,
            isSuccess,
            attempts: execution.attempts,
            maxAttempts: TOOL_MAX_RETRIES + 1,
            payload,
            phase: 'tool_execution',
            result: executionResult,
          },
          stepIndex,
          type: 'tool_end',
        });

        // Finally persist to database. In resumption mode (skipCreateToolMessage),
        // the pending tool message already exists from request_human_approve, so
        // we update it in-place rather than inserting a new row — inserting would
        // either duplicate the tool_call_id or violate parent_id FK ().
        let toolMessageId: string | undefined;
        try {
          if (payload.skipCreateToolMessage) {
            toolMessageId = payload.parentMessageId;
            await ctx.messageModel.updateToolMessage(toolMessageId, {
              content: executionResult.content,
              metadata: { toolExecutionTimeMs: executionTime },
              pluginError: executionResult.error,
              pluginState: executionResult.state,
            });
            log(
              '[%s:%d] Updated existing tool message %s (skipCreateToolMessage)',
              operationId,
              stepIndex,
              toolMessageId,
            );
          } else {
            const toolMessage = await ctx.messageModel.create({
              agentId: state.metadata!.agentId!,
              content: executionResult.content,
              metadata: { toolExecutionTimeMs: executionTime },
              parentId: payload.parentMessageId,
              plugin: chatToolPayload as any,
              pluginError: executionResult.error,
              pluginState: executionResult.state,
              role: 'tool',
              threadId: state.metadata?.threadId,
              tool_call_id: chatToolPayload.id,
              topicId: state.metadata?.topicId,
            });
            toolMessageId = toolMessage.id;
          }
        } catch (error) {
          console.error('[StreamingToolExecutor] Failed to persist tool message: %O', error);
          // Normalize BEFORE publishing so clients (which treat `error` stream
          // events as terminal and surface `event.data.error` directly) see the
          // typed business error, not the raw SQL / driver text.
          const fatal = isMidOperationReferenceMissingError(error)
            ? createConversationParentMissingError(payload.parentMessageId, error)
            : error instanceof Error
              ? error
              : new Error(String(error));
          await streamManager.publishStreamEvent(operationId, {
            data: formatErrorEventData(fatal, 'tool_message_persist'),
            stepIndex,
            type: 'error',
          });
          // Mark so the outer catch (which normally converts tool-exec errors
          // into event records and returns the unchanged state) re-throws.
          throw markPersistFatal(fatal);
        }

        const newState = structuredClone(state);

        applyScratchBindSettlement(newState, scratchSettlement);

        const resultMessage = {
          content: executionResult.content,
          id: toolMessageId,
          role: 'tool' as const,
          tool_call_id: chatToolPayload.id,
        };
        // Approval resumes already contain the pending tool message. Replace it
        // so context reordering cannot retain its empty content over the result.
        const pendingToolIndex = payload.skipCreateToolMessage
          ? newState.messages.findIndex(
              (message) =>
                message.role === 'tool' &&
                (message.id === toolMessageId || message.tool_call_id === chatToolPayload.id),
            )
          : -1;
        if (pendingToolIndex >= 0) newState.messages[pendingToolIndex] = resultMessage;
        else newState.messages.push(resultMessage);

        events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

        // Get tool unit price
        const toolCost = TOOL_PRICING[toolName] || 0;

        // Use UsageCounter to uniformly accumulate tool usage
        const { usage, cost } = UsageCounter.accumulateTool({
          cost: newState.cost,
          executionTime,
          success: isSuccess,
          toolCost,
          toolName,
          usage: newState.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;

        const deterministicFailureKey = getDeterministicToolFailureKey(toolName, executionResult);
        if (deterministicFailureKey) {
          const previousFailure = state.metadata?.deterministicToolFailure as
            | { count: number; key: string }
            | undefined;
          const count =
            previousFailure?.key === deterministicFailureKey ? previousFailure.count + 1 : 1;
          newState.metadata = {
            ...newState.metadata,
            deterministicToolFailure: { count, key: deterministicFailureKey },
          };

          if (count >= 2) {
            return interruptForExecutionGuard(newState, 'repeated_error', instruction);
          }
        } else if (newState.metadata?.deterministicToolFailure) {
          const { deterministicToolFailure: _failure, ...metadata } = newState.metadata;
          newState.metadata = metadata;
        }

        if (activation.skill)
          recordActivatedSkill(newState, activation.skill, executionResult.content);

        // Persist ToolsActivator discovery results to state.activatedStepTools
        const discoveredTools = executionResult.state?.activatedTools as
          | Array<{ identifier: string }>
          | undefined;
        if (discoveredTools?.length) {
          const existingIds = new Set(
            (newState.activatedStepTools ?? []).map((t: { id: string }) => t.id),
          );
          const newActivations = discoveredTools
            .filter((t) => !existingIds.has(t.identifier))
            .map((t) => ({
              activatedAtStep: state.stepCount,
              id: t.identifier,
              manifest: effectiveManifestMap[t.identifier],
              source: 'discovery' as const,
            }));

          if (newActivations.length > 0) {
            newState.activatedStepTools = [
              ...(newState.activatedStepTools ?? []),
              ...newActivations,
            ];

            log(
              `[${operationLogId}] Persisted %d tool activations to state: %o`,
              newActivations.length,
              newActivations.map((a) => a.id),
            );
          }
        }

        // Find current tool statistics
        const currentToolStats = usage.tools.byTool.find((t) => t.name === toolName);

        // Log usage information
        log(
          `[${operationLogId}][tool usage] %s: calls=%d, time=%dms, success=%s, cost=$%s`,
          toolName,
          currentToolStats?.calls || 0,
          executionTime,
          isSuccess,
          toolCost.toFixed(4),
        );

        log('[%s:%d] Tool execution completed', operationId, stepIndex);

        // When a legacy callAgent task result carries execSubAgent / execSubAgents
        // state, the GeneralChatAgent needs `stop: true` in the payload to detect
        // it and emit the matching exec_sub_agent / exec_sub_agents instruction.
        // Without this flag the agent falls through to the normal LLM-call path
        // and the background agent run is never spawned.
        const legacyAgentInvocationStateType = executionResult.state?.type as string | undefined;
        const isLegacyAgentInvocationState =
          legacyAgentInvocationStateType === 'execSubAgent' ||
          legacyAgentInvocationStateType === 'execSubAgents';

        executeToolSpan.setAttributes(
          buildExecuteToolResultAttributes({ attempts: execution.attempts, success: isSuccess }),
        );

        // Last: the tool result is persisted, reported and accounted for by
        // now, so interrupting here loses none of it.
        if (scratchSettlement.failed)
          return interruptForPendingWorkspaceBindFailure(newState, events);

        return {
          events,
          newState,
          nextContext: {
            payload: {
              data: executionResult,
              executionTime,
              isSuccess,
              // Pass tool message ID as parentMessageId for the next LLM call
              parentMessageId: toolMessageId,
              ...(isLegacyAgentInvocationState && { stop: true }),
              toolCall: chatToolPayload,
              toolCallId: chatToolPayload.id,
            },
            phase: 'tool_result',
            session: {
              eventCount: events.length,
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
            stepUsage: {
              cost: toolCost,
              toolName,
              unitPrice: toolCost,
              usageCount: 1,
            },
          },
        };
      } catch (error) {
        executeToolSpan.recordException(error as Error);
        executeToolSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        executeToolSpan.setAttributes(buildExecuteToolResultAttributes({ success: false }));

        // Persist-level failures (parent FK violation etc.) must propagate so
        // the step fails — otherwise the swallow-and-continue path keeps
        // running the agent on a broken conversation chain. See .
        if (isPersistFatal(error)) throw error;

        if (ctx.hookDispatcher) {
          ctx.hookDispatcher
            .dispatch(
              operationId,
              'onToolCallError',
              {
                apiName: chatToolPayload.apiName,
                args: parsedArgs,
                callIndex,
                error: error instanceof Error ? error.message : String(error),
                identifier: chatToolPayload.identifier,
                operationId,
                stepIndex,
                userId: ctx.userId,
              },
              state.metadata?._hooks,
            )
            .catch(() => {});
        }

        // Publish tool execution error event
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(error, 'tool_execution'),
          stepIndex,
          type: 'error',
        });

        events.push({ error, type: 'error' });

        console.error(
          `[StreamingToolExecutor] Tool execution failed for operation ${operationId}:${stepIndex}:`,
          error,
        );

        return {
          events,
          newState: state, // State unchanged
        };
      }
    } finally {
      executeToolSpan.end();
    }
  },

  /**
   * Batch tool execution with database sync
   * Executes multiple tools concurrently and refreshes messages from database after completion
   */
  call_tools_batch: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tools_batch' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const preflightBudgetReason = getExecutionBudgetReason(state);
    if (preflightBudgetReason) {
      return interruptForExecutionGuard(state, preflightBudgetReason, instruction);
    }

    const operationLogId = `${operationId}:${stepIndex}`;
    log(
      `[${operationLogId}][call_tools_batch] Starting batch execution for ${toolsCalling.length} tools`,
    );

    // Split client vs server tools
    const clientTools: ChatToolPayload[] = [];
    const serverTools: ChatToolPayload[] = [];
    for (const tp of toolsCalling) {
      const src =
        state.operationToolSet?.sourceMap?.[tp.identifier] ?? state.toolSourceMap?.[tp.identifier];
      if (src === 'client') {
        clientTools.push(tp);
      } else {
        serverTools.push(tp);
      }
    }

    // If all tools are client-side, pause immediately
    if (clientTools.length > 0 && serverTools.length === 0) {
      log(
        `[${operationLogId}][call_tools_batch] All ${clientTools.length} tools are client-side, pausing`,
      );

      await streamManager.publishStreamChunk(operationId, stepIndex, {
        chunkType: 'tools_calling',
        toolsCalling: clientTools as any,
      });

      const newState = structuredClone(state);
      newState.lastModified = new Date().toISOString();
      newState.status = 'waiting_for_async_tool';
      newState.interruption = {
        canResume: true,
        interruptedAt: new Date().toISOString(),
        reason: 'client_tool_execution',
      };
      newState.pendingToolsCalling = clientTools;

      return {
        events: [
          {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: 'client_tool_execution',
            type: 'interrupted',
          },
        ],
        newState,
      };
    }

    // Track all tool message IDs created during execution
    const toolMessageIds: string[] = [];
    const toolResults: any[] = [];
    // Deferred (async) tools whose result is delivered out-of-band later;
    // collected here so the batch parks for them after server tools finish.
    const deferredTools: ChatToolPayload[] = [];
    // A path may pass the lexical pre-dispatch audit and still resolve outside
    // the frozen roots on the device (for example through a symlink). Keep
    // those device-authored interventions out of the LLM result stream and
    // park the whole batch on the same approval UI used by call_tool.
    const pathConsentTools: ChatToolPayload[] = [];
    const pathConsentToolMessageIds: Record<string, string> = {};
    let scratchPreparedPromise: Promise<PreparedToolExecutionContext> | undefined;
    // One shared post-success settlement for the whole batch: the first tool
    // that succeeds against the scratch root starts it, every other tool awaits
    // the same outcome, and it never rejects — a bind must not decide whether a
    // sibling tool's successful result gets persisted.
    let scratchBindPromise: Promise<ScratchBindSettlement> | undefined;
    let scratchSettlement: ScratchBindSettlement | undefined;
    const prepareBatchExecutionContext = (tool: ChatToolPayload) => {
      if (
        !requiresPrimaryCwdForTool({ executionContext: getFrozenExecutionContext(state), tool })
      ) {
        return Promise.resolve({ executionContext: getFrozenExecutionContext(state) });
      }
      scratchPreparedPromise ??= prepareToolExecutionContext(ctx, state, tool);
      return scratchPreparedPromise;
    };

    // Execute server tools concurrently (skip client tools in mixed batch)
    const toolsToExecute = serverTools.length > 0 ? serverTools : toolsCalling;
    await Promise.all(
      toolsToExecute.map(async (chatToolPayload: ChatToolPayload) => {
        const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;

        // Publish tool execution start event
        await streamManager.publishStreamEvent(operationId, {
          data: { parentMessageId, toolCalling: chatToolPayload },
          stepIndex,
          type: 'tool_start',
        });

        const batchToolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;
        const batchExistingStats = state.usage?.tools?.byTool?.find(
          (t) => t.name === batchToolName,
        );
        const batchCallIndex = (batchExistingStats?.calls ?? 0) + 1;
        let batchParsedArgs: Record<string, any> = {};
        try {
          batchParsedArgs =
            typeof chatToolPayload.arguments === 'string'
              ? JSON.parse(chatToolPayload.arguments)
              : (chatToolPayload.arguments ?? {});
        } catch {
          // Keep malformed tool arguments as an empty preview payload; execution still uses raw args.
        }

        // OTel execute_tool span — one per tool inside the concurrent batch.
        const batchToolSourceForSpan =
          state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
          state.toolSourceMap?.[chatToolPayload.identifier];
        const batchExecuteToolSpan = agentRuntimeTracer.startSpan(executeToolSpanName(toolName), {
          attributes: buildExecuteToolAttributes({
            operationId,
            stepIndex,
            toolCallId: chatToolPayload.id,
            toolName,
            toolSource: batchToolSourceForSpan,
            toolType: GEN_AI_FUNCTION_TOOL_TYPE,
          }),
        });

        try {
          try {
            log(`[${operationLogId}] Executing tool ${toolName} ...`);
            // Build effective manifest map (operation + step-level activations)
            const batchManifestMap = {
              ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
              ...Object.fromEntries(
                (state.activatedStepTools ?? [])
                  .filter((a) => a.manifest)
                  .map((a) => [a.id, a.manifest!]),
              ),
            };

            const batchAgentConfig = state.metadata?.agentConfig;

            const canDispatchToClient =
              chatToolPayload.executor === 'client' &&
              typeof streamManager.sendToolExecute === 'function' &&
              !requiresServerDeviceTransport(state, chatToolPayload);

            let batchToolCallMocked = false;
            const batchHookResult = ctx.hookDispatcher
              ? await (async () => {
                  ctx
                    .hookDispatcher!.dispatch(
                      operationId,
                      'beforeToolCall',
                      {
                        apiName: chatToolPayload.apiName,
                        args: batchParsedArgs,
                        callIndex: batchCallIndex,
                        identifier: chatToolPayload.identifier,
                        operationId,
                        stepIndex,
                        userId: ctx.userId,
                      },
                      state.metadata?._hooks,
                    )
                    .catch(() => {});
                  return ctx.hookDispatcher!.dispatchBeforeToolCall(operationId, {
                    apiName: chatToolPayload.apiName,
                    args: batchParsedArgs,
                    callIndex: batchCallIndex,
                    identifier: chatToolPayload.identifier,
                    stepIndex,
                  });
                })()
              : null;

            if (isDeviceToolIdentifier(chatToolPayload.identifier) && !batchHookResult?.isMocked) {
              const policy = state.metadata?.deviceAccessPolicy as
                | { canUseDevice: boolean; reason: DeviceAccessReason }
                | undefined;
              logDeviceToolAudit({
                apiName: chatToolPayload.apiName,
                botContext: state.metadata?.botContext,
                canUseDevice: policy?.canUseDevice ?? true,
                messageId: state.metadata?.sourceMessageId,
                operationId,
                reason: policy?.reason ?? 'first-party',
                toolIdentifier: chatToolPayload.identifier,
                topicId: ctx.topicId,
                userId: ctx.userId,
              });
            }

            let execution: { result: ToolExecutionResultResponse; attempts: number };
            let preparedExecutionContext: PreparedToolExecutionContext = {
              executionContext: getFrozenExecutionContext(state),
            };
            if (batchHookResult?.isMocked) {
              log(`[${operationLogId}] Tool ${toolName} mocked by beforeToolCall hook`);
              batchToolCallMocked = true;
              execution = {
                attempts: 0,
                result: { content: batchHookResult.content, executionTime: 0, success: true },
              };
            } else if (canDispatchToClient) {
              preparedExecutionContext = await prepareBatchExecutionContext(chatToolPayload);
              log(`[${operationLogId}] Dispatching tool ${toolName} to client via Agent Gateway`);
              const timeoutMs = clampToolTimeoutToExecutionBudget(
                state,
                resolveToolTimeoutMs({
                  apiName: chatToolPayload.apiName,
                  args: batchParsedArgs,
                  manifest: batchManifestMap[chatToolPayload.identifier],
                }),
              );
              const dispatchResult = await dispatchClientTool(chatToolPayload, {
                deviceId:
                  preparedExecutionContext.executionContext?.plan.kind === 'device'
                    ? preparedExecutionContext.executionContext.plan.deviceId
                    : undefined,
                executionContext: projectExecutionContextForClient(
                  state,
                  preparedExecutionContext.executionContext,
                ),
                operationId,
                streamManager,
                timeoutMs,
                topicId: state.metadata?.topicId ?? ctx.topicId,
              });
              execution = { attempts: 1, result: dispatchResult };
            } else {
              preparedExecutionContext = await prepareBatchExecutionContext(chatToolPayload);
              // Inject source from sourceMap so BuiltinToolsExecutor can route
              // lobehubSkill / composio tools correctly (LLM responses don't carry source)
              const batchToolSource =
                state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
                state.toolSourceMap?.[chatToolPayload.identifier];
              if (batchToolSource && !chatToolPayload.source) {
                chatToolPayload.source = batchToolSource;
              }

              const timeoutMs = clampToolTimeoutToExecutionBudget(
                state,
                resolveToolTimeoutMs({
                  apiName: chatToolPayload.apiName,
                  args: batchParsedArgs,
                  manifest: batchManifestMap[chatToolPayload.identifier],
                }),
              );

              execution = await executeToolWithRetry(
                () =>
                  toolExecutionService.executeTool(chatToolPayload, {
                    activeDeviceId: getExecutionDeviceId(
                      state,
                      preparedExecutionContext.executionContext,
                    ),
                    agentId: state.metadata?.agentId,
                    agentMember: buildServerAgentMemberRunner(
                      ctx,
                      state,
                      chatToolPayload,
                      payload.parentMessageId,
                    ),
                    documentId: state.metadata?.documentId,
                    execSubAgent: ctx.execSubAgent,
                    executionContext: preparedExecutionContext.executionContext,
                    executionTimeoutMs: timeoutMs,
                    groupId: state.metadata?.groupId,
                    isSubAgent: state.metadata?.isSubAgent === true,
                    memoryToolPermission: batchAgentConfig?.chatConfig?.memory?.toolPermission,
                    messageId: state.metadata?.sourceMessageId,
                    modelCatalogSnapshot: state.metadata?.modelCatalogSnapshot,
                    operationId,
                    projectSkills: (
                      state.metadata?.skillRegistryResult?.skills ??
                      state.metadata?.operationSkillSet?.skills ??
                      []
                    )
                      .filter(
                        (skill: { location?: string; source?: string }) =>
                          skill.source === 'project' && !!skill.location,
                      )
                      .map((skill: { location: string; name: string }) => ({
                        location: skill.location,
                        name: skill.name,
                      })),
                    scope: state.metadata?.scope,
                    serverDB: ctx.serverDB,
                    skipResultTruncation: true,
                    skillRegistryResult: state.metadata?.skillRegistryResult,
                    subAgent: buildServerVirtualSubAgentRunner(
                      ctx,
                      state,
                      chatToolPayload,
                      payload.parentMessageId,
                    ),
                    taskId: state.metadata?.taskId,
                    threadId: state.metadata?.threadId,
                    toolCallId: chatToolPayload.id,
                    toolManifestMap: batchManifestMap,
                    toolResultMaxLength: batchAgentConfig?.chatConfig?.toolResultMaxLength,
                    topicId: ctx.topicId,
                    userId: ctx.userId,
                    workspaceId: state.metadata?.workspaceId ?? ctx.workspaceId,
                  }),
                {
                  isInterrupted: () => isOperationInterrupted(ctx),
                  maxRetries: TOOL_MAX_RETRIES,
                  operationLogId,
                  toolName,
                },
              );
            }

            // Deferred (async) tool: executor created a pending placeholder and
            // the real result arrives out-of-band. Skip the tool_result write;
            // the batch parks for it after all server tools settle.
            if (execution.result.deferred) {
              log(`[${operationLogId}] Tool ${toolName} deferred; will park after batch`);
              deferredTools.push(chatToolPayload);
              batchExecuteToolSpan.setAttributes(
                buildExecuteToolResultAttributes({ attempts: execution.attempts, success: true }),
              );
              return;
            }

            if (execution.result.success && preparedExecutionContext.scratchRoot) {
              scratchBindPromise ??= settleScratchBindAfterToolSuccess({
                ctx,
                operationLogId,
                prepared: preparedExecutionContext,
                state,
                toolName,
              });
              scratchSettlement = await scratchBindPromise;
            }

            const postDispatchPathConsent = getPostDispatchWorkspacePathConsent({
              activeDeviceId: state.metadata?.activeDeviceId,
              operationId,
              result: execution.result,
              topicId: ctx.topicId ?? state.metadata?.topicId,
            });
            if (postDispatchPathConsent && requiresInteractivePathConsent(state)) {
              const pendingState = {
                ...(execution.result.state && typeof execution.result.state === 'object'
                  ? execution.result.state
                  : {}),
                workspacePathConsent: postDispatchPathConsent,
              };
              const toolMessage = await ctx.messageModel.create({
                agentId: state.metadata!.agentId!,
                content: '',
                parentId: parentMessageId,
                plugin: chatToolPayload as any,
                pluginIntervention: { status: 'pending' },
                pluginState: pendingState,
                role: 'tool',
                threadId: state.metadata?.threadId,
                tool_call_id: chatToolPayload.id,
                topicId: state.metadata?.topicId,
              });
              pathConsentTools.push(chatToolPayload);
              pathConsentToolMessageIds[chatToolPayload.id] = toolMessage.id;
              toolMessageIds.push(toolMessage.id);
              batchExecuteToolSpan.setAttributes(
                buildExecuteToolResultAttributes({ attempts: execution.attempts, success: false }),
              );
              return;
            }

            const activation = validateSkillActivationResult(
              state.metadata?.operationSkillSet?.skills,
              chatToolPayload,
              execution.result,
              operationId,
            );
            const executionResult = await archiveRuntimeToolResult(activation.result, {
              agentId: state.metadata?.agentId,
              identifier: chatToolPayload.identifier,
              limit: batchAgentConfig?.chatConfig?.toolResultMaxLength,
              serverDB: ctx.serverDB,
              toolCallId: chatToolPayload.id,
              topicId: ctx.topicId ?? state.metadata?.topicId,
              userId: ctx.userId,
              workspaceId: state.metadata?.workspaceId ?? ctx.workspaceId,
            });
            const executionTime = executionResult.executionTime;
            const isSuccess = executionResult.success;
            if (ctx.hookDispatcher) {
              ctx.hookDispatcher
                .dispatch(
                  operationId,
                  'afterToolCall',
                  {
                    apiName: chatToolPayload.apiName,
                    args: batchParsedArgs,
                    callIndex: batchCallIndex,
                    content: executionResult.content,
                    executionTimeMs: executionTime,
                    identifier: chatToolPayload.identifier,
                    mocked: batchToolCallMocked,
                    operationId,
                    stepIndex,
                    success: isSuccess,
                    userId: ctx.userId,
                  },
                  state.metadata?._hooks,
                )
                .catch(() => {});
            }
            log(
              `[${operationLogId}] Executed ${toolName} in ${executionTime}ms, success: ${isSuccess}`,
            );

            // Publish tool execution result event
            await streamManager.publishStreamEvent(operationId, {
              data: {
                executionTime,
                isSuccess,
                attempts: execution.attempts,
                maxAttempts: TOOL_MAX_RETRIES + 1,
                payload: { parentMessageId, toolCalling: chatToolPayload },
                phase: 'tool_execution',
                result: executionResult,
              },
              stepIndex,
              type: 'tool_end',
            });

            // Create tool message in database
            try {
              const toolMessage = await ctx.messageModel.create({
                agentId: state.metadata!.agentId!,
                content: executionResult.content,
                metadata: { toolExecutionTimeMs: executionTime },
                parentId: parentMessageId,
                plugin: chatToolPayload as any,
                pluginError: executionResult.error,
                pluginState: executionResult.state,
                role: 'tool',
                threadId: state.metadata?.threadId,
                tool_call_id: chatToolPayload.id,
                topicId: state.metadata?.topicId,
              });
              toolMessageIds.push(toolMessage.id);
              log(`[${operationLogId}] Created tool message ${toolMessage.id} for ${toolName}`);
            } catch (error) {
              console.error(
                `[${operationLogId}] Failed to create tool message for ${toolName}:`,
                error,
              );
              // Normalize BEFORE publishing — clients treat `error` stream
              // events as terminal and surface `event.data.error` directly, so
              // a raw SQL error here would leak driver text to the user before
              // the ConversationParentMissing throw is consumed. See .
              const fatal = isMidOperationReferenceMissingError(error)
                ? createConversationParentMissingError(parentMessageId, error)
                : error instanceof Error
                  ? error
                  : new Error(String(error));
              await streamManager.publishStreamEvent(operationId, {
                data: formatErrorEventData(fatal, 'tool_message_persist'),
                stepIndex,
                type: 'error',
              });
              // Marker so the outer catch (which normally just records
              // per-tool exec errors) knows to propagate this one.
              throw markPersistFatal(fatal);
            }

            // Collect tool result
            toolResults.push({
              activatedSkill: activation.skill,
              data: executionResult,
              executionTime,
              isSuccess,
              toolCall: chatToolPayload,
              toolCallId: chatToolPayload.id,
            });

            events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

            // Collect per-tool usage for post-batch accumulation
            const toolCost = TOOL_PRICING[toolName] || 0;
            toolResults.at(-1).usageParams = {
              executionTime,
              success: isSuccess,
              toolCost,
              toolName,
            };

            batchExecuteToolSpan.setAttributes(
              buildExecuteToolResultAttributes({
                attempts: execution.attempts,
                success: isSuccess,
              }),
            );
          } catch (error) {
            batchExecuteToolSpan.recordException(error as Error);
            batchExecuteToolSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            batchExecuteToolSpan.setAttributes(
              buildExecuteToolResultAttributes({ success: false }),
            );

            // Persist-level failures (e.g. parent FK violations) must propagate
            // so the whole batch short-circuits. Without this the fallback to
            // the already-deleted parent triggers another FK on the next step.
            if (isPersistFatal(error)) {
              throw error;
            }

            if (ctx.hookDispatcher) {
              ctx.hookDispatcher
                .dispatch(
                  operationId,
                  'onToolCallError',
                  {
                    apiName: chatToolPayload.apiName,
                    args: batchParsedArgs,
                    callIndex: batchCallIndex,
                    error: error instanceof Error ? error.message : String(error),
                    identifier: chatToolPayload.identifier,
                    operationId,
                    stepIndex,
                    userId: ctx.userId,
                  },
                  state.metadata?._hooks,
                )
                .catch(() => {});
            }

            console.error(`[${operationLogId}] Tool execution failed for ${toolName}:`, error);

            // Publish error event
            await streamManager.publishStreamEvent(operationId, {
              data: formatErrorEventData(error, 'tool_execution'),
              stepIndex,
              type: 'error',
            });

            events.push({ error, type: 'error' });
          }
        } finally {
          batchExecuteToolSpan.end();
        }
      }),
    );

    log(
      `[${operationLogId}][call_tools_batch] All tools executed, created ${toolMessageIds.length} tool messages`,
    );

    // Accumulate tool usage sequentially after all tools have finished
    const newState = structuredClone(state);
    if (scratchSettlement) applyScratchBindSettlement(newState, scratchSettlement);
    for (const result of toolResults) {
      if (result.activatedSkill) {
        recordActivatedSkill(newState, result.activatedSkill, result.data.content);
      }
      if (result.usageParams) {
        const { usage, cost } = UsageCounter.accumulateTool({
          ...result.usageParams,
          cost: newState.cost,
          usage: newState.usage,
        });
        newState.usage = usage;
        if (cost) newState.cost = cost;
      }
    }

    // Persist ToolsActivator discovery results from batch tool executions
    const batchEffectiveManifestMap = {
      ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
      ...Object.fromEntries(
        (state.activatedStepTools ?? []).filter((a) => a.manifest).map((a) => [a.id, a.manifest!]),
      ),
    };
    const existingActivationIds = new Set(
      (newState.activatedStepTools ?? []).map((t: { id: string }) => t.id),
    );
    for (const result of toolResults) {
      const discovered = result.data?.state?.activatedTools as
        | Array<{ identifier: string }>
        | undefined;
      if (discovered?.length) {
        const newActivations = discovered
          .filter((t) => !existingActivationIds.has(t.identifier))
          .map((t) => ({
            activatedAtStep: state.stepCount,
            id: t.identifier,
            manifest: batchEffectiveManifestMap[t.identifier],
            source: 'discovery' as const,
          }));

        for (const activation of newActivations) {
          existingActivationIds.add(activation.id);
        }

        if (newActivations.length > 0) {
          newState.activatedStepTools = [...(newState.activatedStepTools ?? []), ...newActivations];
        }
      }
    }

    // Refresh messages from database to ensure state is in sync

    // Query latest messages from database
    // Must pass agentId to ensure correct query scope, otherwise when topicId is undefined,
    // the query will use isNull(topicId) condition which won't find messages with actual topicId
    //
    // postProcessUrl resolves keys in imageList/videoList/fileList to external URLs;
    // without it the next LLM call sees raw keys and providers reject them.
    const latestMessages = await ctx.messageModel.query(
      {
        agentId: state.metadata?.agentId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      },
      { postProcessUrl: buildPostProcessUrl(ctx) },
    );

    // Use conversation-flow parse to resolve branching into linear flat list
    // parse() handles assistantGroup, compare, supervisor, etc. virtual message types
    const { flatList } = parse(latestMessages);
    newState.messages = flatList;

    log(
      `[${operationLogId}][call_tools_batch] Refreshed ${newState.messages.length} messages from database`,
    );

    // Get the last tool message ID as parentMessageId for next LLM call
    const lastToolMessageId = toolMessageIds.at(-1);

    if (pathConsentTools.length > 0) {
      await streamManager.publishStreamEvent(operationId, {
        data: {
          pendingToolsCalling: pathConsentTools,
          phase: 'human_approval',
          requiresApproval: true,
        },
        stepIndex,
        type: 'step_start',
      });
      await streamManager.publishStreamChunk(operationId, stepIndex, {
        chunkType: 'tools_calling',
        toolMessageIds: pathConsentToolMessageIds,
        toolsCalling: pathConsentTools as any,
      } as any);

      newState.lastModified = new Date().toISOString();
      newState.pendingToolsCalling = pathConsentTools;
      newState.status = 'waiting_for_human';
      return {
        events: [
          ...events,
          { operationId, pendingToolsCalling: pathConsentTools, type: 'human_approve_required' },
          { toolCalls: pathConsentTools as any, type: 'tool_pending' },
        ],
        newState,
      };
    }

    // Park if any tools still owe an out-of-band result: client tools (run on
    // the client) and/or deferred async tools (e.g. sub-agents). The operation
    // resumes once every pending tool's result is delivered.
    const pendingTools = [...deferredTools, ...clientTools];
    if (pendingTools.length > 0) {
      // Prefer the async-tool reason when any deferred tool is present; the
      // individual pending payloads still carry their own identity for the
      // resume gate.
      const pauseReason = deferredTools.length > 0 ? 'async_tool' : 'client_tool_execution';
      log(
        `[${operationLogId}][call_tools_batch] Pausing after ${serverTools.length} server tools: ${deferredTools.length} deferred + ${clientTools.length} client`,
      );

      await streamManager.publishStreamChunk(operationId, stepIndex, {
        chunkType: 'tools_calling',
        toolsCalling: pendingTools as any,
      });

      newState.status = 'waiting_for_async_tool';
      newState.interruption = {
        canResume: true,
        interruptedAt: new Date().toISOString(),
        reason: pauseReason,
      };
      newState.pendingToolsCalling = pendingTools;

      return {
        events: [
          ...events,
          {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: pauseReason,
            type: 'interrupted',
          },
        ],
        newState,
      };
    }

    // Same post-success workspace semantics as call_tool, applied once for the
    // whole batch and only after every tool result is persisted and reported.
    if (scratchSettlement?.failed) return interruptForPendingWorkspaceBindFailure(newState, events);

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId: lastToolMessageId ?? parentMessageId,
          toolCount: toolsCalling.length,
          toolResults,
        },
        phase: 'tools_batch_result',
        session: {
          eventCount: events.length,
          messageCount: newState.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      },
    };
  },

  /**
   * Server-side exec_sub_agent executor
   *
   * Mirrors the client-side exec_sub_agent executor in createAgentExecutors.ts
   * but runs entirely server-side (no polling required).  Flow:
   *   1. Create a task message (role: 'task') as a placeholder visible in the UI.
   *   2. Fire execSubAgent via the injected callback so the sub-agent runs as
   *      an independent QStash operation.
   *   3. Return a sub_agent_result context so GeneralChatAgent calls the LLM once
   *      more and the parent agent can acknowledge the delegation.
   */
  exec_sub_agent: async (instruction, state) => {
    const { payload } = instruction as AgentInstructionExecSubAgent;
    const { parentMessageId, task } = payload;
    const events: AgentEvent[] = [];
    const { operationId } = ctx;
    const taskLogId = `${operationId}:exec_sub_agent`;

    const topicId = ctx.topicId ?? state.metadata?.topicId;
    const agentId = state.metadata?.agentId;
    // targetAgentId is a cloud extension injected by agentManagement.callAgent
    const targetAgentId = (task as any).targetAgentId ?? agentId;

    if (state.metadata?.isSubAgent === true) {
      log('[%s] Nested sub-agent dispatch blocked', taskLogId);
      return {
        events,
        newState: state,
        nextContext: {
          payload: {
            parentMessageId,
            result: {
              error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
              success: false,
              taskMessageId: parentMessageId,
              threadId: '',
            },
          },
          phase: 'sub_agent_result',
          session: {
            messageCount: state.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as unknown as AgentRuntimeContext,
      };
    }

    let taskMessageId: string | undefined;
    try {
      const taskMessage = await ctx.messageModel.create({
        agentId: agentId!,
        content: '',
        metadata: {
          instruction: task.instruction,
          taskTitle: task.description,
          ...(targetAgentId && targetAgentId !== agentId && { targetAgentId }),
        },
        parentId: parentMessageId,
        role: 'task',
        threadId: state.metadata?.threadId ?? undefined,
        topicId: topicId!,
      });
      taskMessageId = taskMessage.id;
      log('[%s] Created task message: %s', taskLogId, taskMessageId);
    } catch (error) {
      log('[%s] Failed to create task message: %O', taskLogId, error);
    }

    const effectiveTaskMessageId = taskMessageId ?? parentMessageId;

    let dispatched = false;
    if (ctx.execSubAgent && topicId && agentId) {
      try {
        await ctx.execSubAgent({
          agentId: targetAgentId,
          groupId: state.metadata?.groupId ?? undefined,
          instruction: task.instruction,
          parentMessageId: effectiveTaskMessageId,
          parentOperationId: operationId,
          timeout: task.timeout,
          title: task.description,
          topicId,
        });
        dispatched = true;
        log('[%s] Spawned sub-agent task for agent %s', taskLogId, targetAgentId);
      } catch (error) {
        log('[%s] Failed to spawn sub-agent task: %O', taskLogId, error);
        if (taskMessageId) {
          try {
            await ctx.messageModel.update(taskMessageId, {
              content: `Task failed to start: ${(error as Error).message}`,
            });
          } catch {
            // best-effort
          }
        }
      }
    } else {
      log('[%s] execSubAgent not available, skipping sub-agent dispatch', taskLogId);
    }

    return {
      events,
      newState: state,
      nextContext: {
        payload: {
          parentMessageId: effectiveTaskMessageId,
          result: {
            success: dispatched,
            taskMessageId: effectiveTaskMessageId,
            threadId: '',
          },
        },
        phase: 'sub_agent_result',
        session: {
          messageCount: state.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      } as unknown as AgentRuntimeContext,
    };
  },

  /**
   * Server-side exec_sub_agents executor
   *
   * Same as exec_sub_agent but for a batch.  Each sub-agent is fired
   * independently via execSubAgent and a task message is created for each.
   */
  exec_sub_agents: async (instruction, state) => {
    const { payload } = instruction as AgentInstructionExecSubAgents;
    const { parentMessageId, tasks } = payload;
    const events: AgentEvent[] = [];
    const { operationId } = ctx;
    const taskLogId = `${operationId}:exec_sub_agents`;

    const topicId = ctx.topicId ?? state.metadata?.topicId;
    const agentId = state.metadata?.agentId;

    log('[%s] Starting batch of %d tasks', taskLogId, tasks.length);

    if (state.metadata?.isSubAgent === true) {
      log('[%s] Nested sub-agent batch dispatch blocked', taskLogId);
      return {
        events,
        newState: state,
        nextContext: {
          payload: {
            parentMessageId,
            results: tasks.map((task) => ({
              description: task.description,
              error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
              success: false,
              taskMessageId: parentMessageId,
              threadId: '',
            })),
          },
          phase: 'sub_agents_batch_result',
          session: {
            messageCount: state.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as unknown as AgentRuntimeContext,
      };
    }

    let lastTaskMessageId: string | undefined;
    const taskResults: Array<{ success: boolean; taskMessageId: string; threadId: string }> = [];

    for (const task of tasks) {
      const targetAgentId = (task as any).targetAgentId ?? agentId;
      let taskMessageId: string | undefined;

      try {
        const taskMessage = await ctx.messageModel.create({
          agentId: agentId!,
          content: '',
          metadata: {
            instruction: task.instruction,
            taskTitle: task.description,
            ...(targetAgentId && targetAgentId !== agentId && { targetAgentId }),
          },
          parentId: parentMessageId,
          role: 'task',
          threadId: state.metadata?.threadId ?? undefined,
          topicId: topicId!,
        });
        taskMessageId = taskMessage.id;
        lastTaskMessageId = taskMessageId;
      } catch (error) {
        log('[%s] Failed to create task message for "%s": %O', taskLogId, task.description, error);
      }

      let taskDispatched = false;
      if (ctx.execSubAgent && topicId && agentId) {
        try {
          await ctx.execSubAgent({
            agentId: targetAgentId,
            groupId: state.metadata?.groupId ?? undefined,
            instruction: task.instruction,
            parentMessageId: taskMessageId ?? parentMessageId,
            parentOperationId: operationId,
            timeout: task.timeout,
            title: task.description,
            topicId,
          });
          taskDispatched = true;
          log(
            '[%s] Spawned sub-agent task "%s" for agent %s',
            taskLogId,
            task.description,
            targetAgentId,
          );
        } catch (error) {
          log('[%s] Failed to spawn task "%s": %O', taskLogId, task.description, error);
          if (taskMessageId) {
            try {
              await ctx.messageModel.update(taskMessageId, {
                content: `Task failed to start: ${(error as Error).message}`,
              });
            } catch {
              // best-effort
            }
          }
        }
      }
      taskResults.push({
        success: taskDispatched,
        taskMessageId: taskMessageId ?? parentMessageId,
        threadId: '',
      });
    }

    return {
      events,
      newState: state,
      nextContext: {
        payload: {
          parentMessageId: lastTaskMessageId ?? parentMessageId,
          results: taskResults,
        },
        phase: 'sub_agents_batch_result',
        session: {
          messageCount: state.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      } as unknown as AgentRuntimeContext,
    };
  },

  /**
   * Complete runtime execution
   */
  finish: async (instruction, state) => {
    const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Finishing execution: (%s)', operationId, stepIndex, reason);

    // Persist the terminal status on the server as well as clearing the
    // reconnect pointer. The renderer may have refreshed or disconnected, so
    // its best-effort terminal write cannot be the source of truth.
    if (ctx.topicId && ctx.userId) {
      try {
        if (ctx.completeTopicOperation) {
          await ctx.completeTopicOperation({
            operationId,
            status: 'active',
            topicId: ctx.topicId,
          });
        } else {
          const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
          await topicModel.completeRunningOperation(ctx.topicId, operationId, 'active');
        }
      } catch (e) {
        log('[%s] Failed to persist terminal topic state: %O', operationId, e);
      }
    }

    // Publish execution complete event. `finalState.messages` + tool-set
    // fields are stripped centrally inside `publishStreamEvent` so this
    // call site stays unaware.
    await streamManager.publishStreamEvent(operationId, {
      data: {
        finalState: { ...state, status: 'done' },
        phase: 'execution_complete',
        reason,
        reasonDetail,
      },
      stepIndex,
      type: 'step_complete',
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    const events: AgentEvent[] = [
      {
        finalState: newState,
        reason,
        reasonDetail,
        type: 'done',
      },
    ];

    return { events, newState };
  },

  /**
   * Human approval
   *
   * Mirrors the client executor (`createAgentExecutors.ts:1072-1177`):
   * - Creates one `role='tool'` message per pending tool call with
   *   `pluginIntervention: { status: 'pending' }` so approval UI has a target.
   * - When `skipCreateToolMessage` is true (resumption via `/run` after a
   *   previous op already persisted them), skip creation.
   * - Publishes the `toolCallId -> toolMessageId` mapping alongside the
   *   `tools_calling` stream chunk so the client can hydrate its local
   *   message map without waiting for `agent_runtime_end`.
   */
  request_human_approve: async (instruction, state) => {
    const { pendingToolsCalling, skipCreateToolMessage } = instruction as Extract<
      AgentInstruction,
      { type: 'request_human_approve' }
    >;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Requesting human approval for %O', operationId, stepIndex, pendingToolsCalling);

    // Publish human approval request event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        pendingToolsCalling,
        phase: 'human_approval',
        requiresApproval: true,
      },
      stepIndex,
      type: 'step_start',
    });

    if (ctx.hookDispatcher) {
      ctx.hookDispatcher
        .dispatch(
          operationId,
          'beforeHumanIntervention',
          {
            operationId,
            pendingTools: pendingToolsCalling.map((t: any) => ({
              apiName: t.apiName,
              identifier: t.identifier,
            })),
            stepIndex,
            userId: ctx.userId,
          },
          state.metadata?._hooks,
        )
        .catch(() => {});
    }

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'waiting_for_human';
    newState.pendingToolsCalling = pendingToolsCalling;

    // Map of toolCallId -> toolMessageId, populated either by creating fresh
    // pending tool messages or (in resumption mode) by looking up existing ones.
    const toolMessageIds: Record<string, string> = {};

    if (skipCreateToolMessage) {
      // Resumption mode: tool messages already exist in DB. Look them up by
      // tool_call_id so we can still ship the mapping to the client.
      log('[%s:%d] Resuming with existing tool messages', operationId, stepIndex);
      try {
        const dbMessages = await ctx.messageModel.query({
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId: state.metadata?.topicId,
        });
        for (const toolPayload of pendingToolsCalling) {
          const existing = dbMessages.find(
            (m: any) => m.role === 'tool' && m.tool_call_id === toolPayload.id,
          );
          if (existing) {
            toolMessageIds[toolPayload.id] = existing.id;
          }
        }
      } catch (error) {
        console.error(
          '[%s:%d] Failed to look up existing tool messages: %O',
          operationId,
          stepIndex,
          error,
        );
      }
    } else {
      // Find parent assistant message. Prefer state.messages (already in
      // memory from call_llm); fall back to DB query if the runtime has been
      // rehydrated without recent messages.
      let parentAssistantId: string | undefined = (state.messages ?? [])
        .slice()
        .reverse()
        .find((m: any) => m.role === 'assistant' && m.id)?.id;

      if (!parentAssistantId) {
        try {
          const dbMessages = await ctx.messageModel.query({
            agentId: state.metadata?.agentId,
            threadId: state.metadata?.threadId,
            topicId: state.metadata?.topicId,
          });
          parentAssistantId = dbMessages
            .slice()
            .reverse()
            .find((m: any) => m.role === 'assistant')?.id;
        } catch (error) {
          console.error(
            '[%s:%d] Failed to query DB for parent assistant: %O',
            operationId,
            stepIndex,
            error,
          );
        }
      }

      if (!parentAssistantId) {
        throw new Error(
          `[request_human_approve] No assistant message found as parent for pending tool messages (op=${operationId})`,
        );
      }

      for (const toolPayload of pendingToolsCalling) {
        const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
        const workspacePathConsent = buildPendingWorkspacePathConsent({
          activeDeviceId: state.metadata?.activeDeviceId,
          executionContext: getFrozenExecutionContext(state),
          operationId,
          tool: toolPayload,
          topicId: ctx.topicId ?? state.metadata?.topicId,
        });
        try {
          const toolMessage = await ctx.messageModel.create({
            agentId: state.metadata!.agentId!,
            content: '',
            parentId: parentAssistantId,
            plugin: toolPayload as any,
            pluginIntervention: { status: 'pending' },
            ...(workspacePathConsent && {
              pluginState: { workspacePathConsent },
            }),
            role: 'tool',
            threadId: state.metadata?.threadId,
            tool_call_id: toolPayload.id,
            topicId: state.metadata?.topicId,
          });

          toolMessageIds[toolPayload.id] = toolMessage.id;

          // Intentionally DO NOT push the empty placeholder into
          // newState.messages. When the approval resumes, the `call_tool`
          // executor (skip-create branch) appends the resolved tool message
          // to state.messages itself. Pushing a placeholder here produced
          // two entries for the same tool_call_id — see review P2.

          log(
            '[%s:%d] Created pending tool message %s for %s',
            operationId,
            stepIndex,
            toolMessage.id,
            toolName,
          );
        } catch (error) {
          console.error(
            '[%s:%d] Failed to create pending tool message for %s: %O',
            operationId,
            stepIndex,
            toolName,
            error,
          );
          throw error;
        }
      }
    }

    // Notify frontend to display approval UI through streaming system.
    // `toolMessageIds` is a new optional field; legacy consumers ignore it.
    await streamManager.publishStreamChunk(operationId, stepIndex, {
      chunkType: 'tools_calling',
      toolMessageIds,
      toolsCalling: pendingToolsCalling as any,
    } as any);

    const events: AgentEvent[] = [
      {
        operationId,
        pendingToolsCalling,
        type: 'human_approve_required',
      },
      {
        // Note: pendingToolsCalling is ChatToolPayload[] but AgentEventToolPending expects ToolsCalling[]
        // This is intentional for display purposes in the frontend
        toolCalls: pendingToolsCalling as any,
        type: 'tool_pending',
      },
    ];

    log('Human approval requested for operation %s:%d', operationId, stepIndex);

    return {
      events,
      newState,
      // Do not provide nextContext as it requires waiting for human intervention
    };
  },

  /**
   * Resolve tools blocked in headless mode.
   * Creates tool results without executing the tools, then continues the loop.
   */
  resolve_blocked_tools: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_blocked_tools' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const toolResults: Array<{ data: ToolExecutionResultResponse; toolCallId: string }> = [];
    const toolMessageIds: string[] = [];

    log('[%s:%d] Resolving %d blocked tools', operationId, stepIndex, toolsCalling.length);

    for (const toolPayload of toolsCalling) {
      const result: ToolExecutionResultResponse = {
        content: 'Blocked by security/privacy.',
        error: 'blocked_by_security_privacy',
        executionTime: 0,
        state: { type: 'blocked' },
        success: false,
      };

      await streamManager.publishStreamEvent(operationId, {
        data: {
          executionTime: 0,
          isSuccess: false,
          attempts: 0,
          maxAttempts: 0,
          payload: { parentMessageId, toolCalling: toolPayload },
          phase: 'tool_execution',
          result,
        },
        stepIndex,
        type: 'tool_end',
      });

      try {
        const toolMessage = await ctx.messageModel.create({
          agentId: state.metadata!.agentId!,
          content: result.content,
          metadata: { toolExecutionTimeMs: 0 },
          parentId: parentMessageId,
          plugin: toolPayload as any,
          pluginError: result.error,
          pluginIntervention: { rejectedReason: result.error, status: 'rejected' },
          pluginState: result.state,
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });
        toolMessageIds.push(toolMessage.id);
      } catch (error) {
        console.error('[resolve_blocked_tools] Failed to create blocked tool message: %O', error);
        const fatal = isMidOperationReferenceMissingError(error)
          ? createConversationParentMissingError(parentMessageId, error)
          : error instanceof Error
            ? error
            : new Error(String(error));
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(fatal, 'tool_message_persist'),
          stepIndex,
          type: 'error',
        });
        throw fatal;
      }

      newState.messages.push({
        content: result.content,
        role: 'tool',
        tool_call_id: toolPayload.id,
      });
      events.push({ id: toolPayload.id, result, type: 'tool_result' });
      toolResults.push({ data: result, toolCallId: toolPayload.id });
    }

    newState.lastModified = new Date().toISOString();

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId: toolMessageIds.at(-1) ?? parentMessageId,
          toolCount: toolsCalling.length,
          toolResults,
        },
        phase: 'tools_batch_result',
        session: {
          eventCount: events.length,
          messageCount: newState.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      },
    };
  },

  /**
   * Resolve aborted tool calls
   * Create tool messages with 'aborted' intervention status for canceled tool calls
   */
  resolve_aborted_tools: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_aborted_tools' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    log('[%s:%d] Resolving %d aborted tools', operationId, stepIndex, toolsCalling.length);

    // Publish tool cancellation event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        parentMessageId,
        phase: 'tools_aborted',
        toolsCalling,
      },
      stepIndex,
      type: 'step_start',
    });

    const newState = structuredClone(state);

    // Create tool message for each canceled tool call
    for (const toolPayload of toolsCalling) {
      const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
      log('[%s:%d] Creating aborted tool message for %s', operationId, stepIndex, toolName);

      try {
        const toolMessage = await ctx.messageModel.create({
          agentId: state.metadata!.agentId!,
          content: 'Tool execution was aborted by user.',
          parentId: parentMessageId,
          plugin: toolPayload as any,
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });

        log(
          '[%s:%d] Created aborted tool message: %s for %s',
          operationId,
          stepIndex,
          toolMessage.id,
          toolName,
        );

        // Update state messages
        newState.messages.push({
          content: 'Tool execution was aborted by user.',
          role: 'tool',
          tool_call_id: toolPayload.id,
        });
      } catch (error) {
        console.error(
          '[resolve_aborted_tools] Failed to create aborted tool message for %s: %O',
          toolName,
          error,
        );
        // Normalize BEFORE publishing so clients surface the typed business
        // error instead of the raw driver text (see review).
        const fatal = isMidOperationReferenceMissingError(error)
          ? createConversationParentMissingError(parentMessageId, error)
          : error instanceof Error
            ? error
            : new Error(String(error));
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(fatal, 'tool_message_persist'),
          stepIndex,
          type: 'error',
        });
        throw fatal;
      }
    }

    log('[%s:%d] All aborted tool messages created', operationId, stepIndex);

    // Mark status as complete
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    // Publish completion event. finalState stripped centrally inside
    // `publishStreamEvent`.
    await streamManager.publishStreamEvent(operationId, {
      data: {
        finalState: newState,
        phase: 'execution_complete',
        reason: 'user_aborted',
        reasonDetail: 'User aborted operation with pending tool calls',
      },
      stepIndex,
      type: 'step_complete',
    });

    events.push({
      finalState: newState,
      reason: 'user_aborted',
      reasonDetail: 'User aborted operation with pending tool calls',
      type: 'done',
    });

    return { events, newState };
  },
});
