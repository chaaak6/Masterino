import type {
  AgentEvent,
  AgentInstruction,
  AgentInstructionCallLlm,
  AgentInstructionCallTool,
  AgentInstructionCompressContext,
  AgentInstructionExecSubAgent,
  AgentInstructionExecSubAgents,
  AgentRuntimeContext,
  ContextBudgetEvaluation,
  GeneralAgentCallingToolInstructionPayload,
  GeneralAgentCallLLMInstructionPayload,
  GeneralAgentCallLLMResultPayload,
  GeneralAgentCallToolResultPayload,
  GeneralAgentCompressionResultPayload,
  InstructionExecutor,
  SubAgentResultPayload,
  SubAgentsBatchResultPayload,
} from '@lobechat/agent-runtime';
import { UsageCounter } from '@lobechat/agent-runtime';
import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import {
  countContextTokens,
  type OperationSkillSet,
  type ToolsEngine,
} from '@lobechat/context-engine';
import {
  type ChatMessageError,
  type ChatToolPayload,
  type CreateMessageParams,
  type MessageMetadata,
  type MessageToolCall,
  type ModelUsage,
  TraceNameMap,
  type UIChatMessage,
} from '@lobechat/types';
import type { ContextBudgetAttemptState } from '@lobechat/types/src/contextBudget';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';
import { createNanoId, dedupeBy } from '@lobechat/utils';
import debug from 'debug';
import { t } from 'i18next';
import pMap from 'p-map';

import { LOADING_FLAT } from '@/const/message';
import { shouldPauseForPathConsent } from '@/helpers/executionContext/credentialPath';
import { getRuntimePathConsentRequest } from '@/helpers/executionContext/pathConsent';
import { aiAgentService } from '@/services/aiAgent';
import { chatService, collectClientProviderMediaTokenEstimates } from '@/services/chat';
import { type ResolvedAgentConfig } from '@/services/chat/mecha';
import type { ClientBudgetedChatPayload } from '@/services/chat/types';
import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { getCompressionCandidateMessageIds } from '@/store/chat/utils/compression';
import { getFileStoreState } from '@/store/file/store';
import { sleep } from '@/utils/sleep';

import { runClientContextCompressionTransaction } from './clientContextCompression';
import { StreamingHandler } from './StreamingHandler';
import { createChatStoreToolCallLifecycle } from './toolCallLifecycle';
import { type StreamChunk } from './types/streaming';

const log = debug('lobe-store:agent-executors');
const createToolMessageId = createNanoId(12);

const combineAbortSignals = (
  ...signals: Array<AbortSignal | undefined>
): { cleanup: () => void; signal?: AbortSignal } => {
  const activeSignals = [...new Set(signals.filter((signal): signal is AbortSignal => !!signal))];
  if (activeSignals.length === 0) return { cleanup: () => {} };
  if (activeSignals.length === 1) return { cleanup: () => {}, signal: activeSignals[0] };

  const controller = new AbortController();
  const listeners: Array<{ listener: () => void; signal: AbortSignal }> = [];
  for (const signal of activeSignals) {
    const abortFromSignal = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    if (signal.aborted) {
      abortFromSignal();
      break;
    }
    signal.addEventListener('abort', abortFromSignal, { once: true });
    listeners.push({ listener: abortFromSignal, signal });
  }

  return {
    cleanup: () => {
      for (const { listener, signal } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
    signal: controller.signal,
  };
};

// Tool pricing configuration (USD per call)
const TOOL_PRICING: Record<string, number> = {
  'lobe-web-browsing/craw': 0.002,
  'lobe-web-browsing/search': 0.001,
};

const isAbortError = (error: unknown, abortController?: AbortController) =>
  !!abortController?.signal.aborted ||
  (error instanceof Error &&
    (error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('cancelled')));

const getGoogleBlockedReason = (error: ChatMessageError): string | undefined => {
  const body = error.body as
    | {
        context?: {
          finishReason?: unknown;
          promptFeedback?: {
            blockReason?: unknown;
          };
        };
        provider?: unknown;
      }
    | undefined;

  if (body?.provider !== 'google') return undefined;

  const promptFeedbackReason = body.context?.promptFeedback?.blockReason;
  if (typeof promptFeedbackReason === 'string') return promptFeedbackReason;

  const finishReason = body.context?.finishReason;
  if (typeof finishReason === 'string') return finishReason;

  return undefined;
};

const localizeGoogleBlockedError = (error: ChatMessageError): ChatMessageError => {
  const blockReason = getGoogleBlockedReason(error);
  if (!blockReason) return error;

  const translationKey = `response.GoogleAIBlockReason.${blockReason}`;
  const localized = t(translationKey as any, {
    defaultValue: error.message ?? '',
    ns: 'error',
  }).trim();

  if (!localized || localized === translationKey) return error;

  const normalizedBody =
    error.body && typeof error.body === 'object' ? (error.body as Record<string, any>) : {};

  return {
    ...error,
    body: {
      ...normalizedBody,
      message: localized,
    },
    message: localized,
  };
};

const localizeError = (error: ChatMessageError): ChatMessageError => {
  const body = error.body as
    | {
        provider?: unknown;
      }
    | undefined;

  if (body?.provider === 'google') {
    return localizeGoogleBlockedError(error);
  }

  return error;
};

/**
 * Creates custom executors for the Chat Agent Runtime
 * These executors wrap existing chat store methods to integrate with agent-runtime
 *
 * @param context.operationId - Operation ID to get business context (agentId, topicId, etc.)
 * @param context.get - Store getter function
 * @param context.messageKey - Message map key
 * @param context.parentId - Parent message ID
 * @param context.skipCreateFirstMessage - Skip first message creation
 */
export const createAgentExecutors = (context: {
  /** Pre-resolved agent config with isSubAgent filtering applied */
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  messageKey: string;
  operationId: string;
  /** Registry winners captured once for the enclosing operation. */
  operationSkills?: OperationSkillSet['skills'];
  parentId: string;
  skipCreateFirstMessage?: boolean;
  /** ToolsEngine for expanding dynamically activated tools */
  toolsEngine?: ToolsEngine;
}) => {
  let shouldSkipCreateMessage = context.skipCreateFirstMessage;

  /**
   * Get operation context via closure
   * Returns the business context (agentId, topicId, etc.) captured by the operation
   */
  const getOperationContext = () => {
    const operation = context.get().operations[context.operationId];
    if (!operation) {
      throw new Error(`Operation not found: ${context.operationId}`);
    }
    return operation.context;
  };

  /**
   * Get effective agentId for message creation - depends on scope
   * - scope: 'sub_agent': agentId stays unchanged (subAgentId only for config/display)
   * - Other scopes with subAgentId: use subAgentId for message ownership (e.g., Group mode)
   * - Default: use agentId
   */
  const getEffectiveAgentId = () => {
    const opContext = getOperationContext();

    // Use subAgentId for message ownership except in sub_agent scope
    // - sub_agent scope: callAgent scenario, message.agentId should stay unchanged
    // - Other scopes with subAgentId: Group mode, message.agentId should be subAgentId
    return opContext.subAgentId && opContext.scope !== 'sub_agent'
      ? opContext.subAgentId
      : opContext.agentId;
  };

  /**
   * Get subAgentId and scope for metadata (when scope is 'sub_agent')
   */
  const getMetadataForSubAgent = () => {
    const opContext = getOperationContext();

    if (opContext.scope === 'sub_agent' && opContext.subAgentId) {
      return {
        subAgentId: opContext.subAgentId,
        scope: opContext.scope,
      };
    }
    return null;
  };

  const executors: Partial<Record<AgentInstruction['type'], InstructionExecutor>> = {
    /**
     * Custom call_llm executor
     * Creates assistant message and calls internal_fetchAIChatMessage
     */
    call_llm: async (instruction, state, runtimeContext) => {
      const sessionLogId = `${state.operationId}:${state.stepCount}`;
      const stagePrefix = `[${sessionLogId}][call_llm]`;

      const llmPayload = (instruction as AgentInstructionCallLlm)
        .payload as GeneralAgentCallLLMInstructionPayload;

      log(
        `${stagePrefix} Starting session. Input: state.messages=%d, llmPayload.messages=%d, messageKey=%s`,
        state.messages.length,
        llmPayload.messages.length,
        context.messageKey,
      );

      let assistantMessageId: string;

      // Check if we should skip message creation:
      // - shouldSkipCreateMessage is true (e.g., regenerate mode)
      // - BUT if createAssistantMessage is explicitly true, always create new message
      //   (e.g., after compression we need a new assistant message)
      if (shouldSkipCreateMessage && !llmPayload.createAssistantMessage) {
        // Skip first creation, subsequent calls will not skip
        assistantMessageId = context.parentId;
        shouldSkipCreateMessage = false;
      } else {
        // Get context from operation
        const opContext = getOperationContext();
        // Get effective agentId (depends on scope)
        const effectiveAgentId = getEffectiveAgentId();
        // Get subAgentId metadata (for sub_agent scope)
        const subAgentMetadata = getMetadataForSubAgent();

        // If this is the first regenerated creation of userMessage, llmPayload doesn't have parentMessageId
        // So we assign it this way
        // TODO: Maybe this should be implemented with an init method in the future
        if (!llmPayload.parentMessageId) {
          llmPayload.parentMessageId = context.parentId;
        }

        // Build metadata
        const metadata: Record<string, any> = {};
        if (opContext.isSupervisor) {
          metadata.isSupervisor = true;
        }
        if (subAgentMetadata) {
          // Store subAgentId and scope in metadata for sub_agent mode
          // This will be used by conversation-flow to transform agentId for display
          Object.assign(metadata, subAgentMetadata);
        }

        // Create assistant message (following server-side pattern)
        const assistantMessageItem = await context.get().optimisticCreateMessage(
          {
            content: LOADING_FLAT,
            groupId: opContext.groupId,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            model: llmPayload.model,
            parentId: llmPayload.parentMessageId,
            provider: llmPayload.provider,
            role: 'assistant',
            agentId: effectiveAgentId!,
            threadId: opContext.threadId,
            topicId: opContext.topicId ?? undefined,
          },
          { operationId: context.operationId },
        );

        if (!assistantMessageItem) {
          throw new Error('Failed to create assistant message');
        }
        assistantMessageId = assistantMessageItem.id;

        // Associate the assistant message with the operation for UI loading states
        context.get().associateMessageWithOperation(assistantMessageId, context.operationId);
      }

      log(`${stagePrefix} Created assistant message, id: %s`, assistantMessageId);

      log(
        `${stagePrefix} calling model-runtime chat (model: %s, messages: %d, tools: %d)`,
        llmPayload.model,
        llmPayload.messages.length,
        llmPayload.tools?.length ?? 0,
      );

      // ======== Inlined streaming logic (previously internal_fetchAIChatMessage) ========
      const {
        optimisticUpdateMessageContent,
        internal_dispatchMessage,
        internal_toggleToolCallingStreaming,
      } = context.get();

      // Get agentId, topicId, groupId and abortController from operation
      const operation = context.get().operations[context.operationId];
      if (!operation) {
        throw new Error(`Operation not found: ${context.operationId}`);
      }
      const { subAgentId, groupId, topicId } = operation.context;
      const abortController = operation.abortController;

      // In group orchestration, subAgentId is the actual responding agent
      const agentId = groupId && subAgentId ? subAgentId : operation.context.agentId!;

      const traceId = operation.metadata?.traceId;

      const fetchContext = { ...operation.context, agentId };

      const { agentConfig: agentConfigData } = context.agentConfig;

      let finalUsage: ModelUsage | undefined;
      let finalToolCalls: MessageToolCall[] | undefined;

      // Expand dynamically activated tools (from lobe-activator activateTools API)
      // and merge them into the agent config for this LLM call.
      // Built before the StreamingHandler so we can bind the offered tool
      // names into the transformToolCalls callback ().
      const activatedToolIds = runtimeContext?.stepContext?.activatedToolIds;
      let resolvedAgentConfig = context.agentConfig;

      if (activatedToolIds?.length && context.toolsEngine) {
        const additional = context.toolsEngine.generateToolsDetailed({
          context: { isExplicitActivation: true },
          model: agentConfigData.model,
          provider: agentConfigData.provider!,
          skipDefaultTools: true,
          toolIds: activatedToolIds,
        });

        if (additional.tools?.length) {
          const mergedEnabledManifests = dedupeBy(
            [...(context.agentConfig.enabledManifests || []), ...additional.enabledManifests],
            (manifest) => manifest.identifier,
          );
          const mergedEnabledToolIds = [
            ...new Set([
              ...(context.agentConfig.enabledToolIds || []),
              ...additional.enabledToolIds,
            ]),
          ];
          const mergedTools = dedupeBy(
            [...(context.agentConfig.tools || []), ...additional.tools],
            (tool) => tool.function.name,
          );

          resolvedAgentConfig = {
            ...context.agentConfig,
            enabledManifests: mergedEnabledManifests,
            enabledToolIds: mergedEnabledToolIds,
            tools: mergedTools,
          };

          log(
            `${stagePrefix} Injected %d activated tools: %o`,
            activatedToolIds.length,
            activatedToolIds,
          );
        }
      }

      // Names of tools actually sent to the LLM this turn. Passed to the
      // resolver's missing-prefix fallback so a model can't reach tools that
      // weren't enabled, and disabled duplicates can't shadow enabled calls.
      const offeredToolNames = (resolvedAgentConfig.tools ?? []).map((tool) => tool.function.name);

      // Create streaming handler with callbacks
      const handler = new StreamingHandler(
        {
          messageId: assistantMessageId,
          operationId: context.operationId,
          agentId,
          groupId,
          topicId,
        },
        {
          onAttemptReset: () => {
            finalUsage = undefined;
            finalToolCalls = undefined;
            internal_dispatchMessage(
              {
                id: assistantMessageId,
                type: 'updateMessage',
                value: {
                  content: '',
                  imageList: undefined,
                  metadata: {
                    isMultimodal: undefined,
                    tempDisplayContent: undefined,
                  },
                  reasoning: undefined,
                  search: undefined,
                  tools: undefined,
                },
              },
              { operationId: context.operationId },
            );
          },
          onContentUpdate: (content, reasoning, contentMetadata) => {
            internal_dispatchMessage(
              {
                id: assistantMessageId,
                type: 'updateMessage',
                value: {
                  content,
                  reasoning,
                  ...(contentMetadata && {
                    metadata: {
                      isMultimodal: contentMetadata.isMultimodal,
                      tempDisplayContent: contentMetadata.tempDisplayContent,
                    },
                  }),
                },
              },
              { operationId: context.operationId },
            );
          },
          onReasoningUpdate: (reasoning) => {
            internal_dispatchMessage(
              {
                id: assistantMessageId,
                type: 'updateMessage',
                value: { reasoning },
              },
              { operationId: context.operationId },
            );
          },
          onToolCallsUpdate: (tools) => {
            internal_dispatchMessage(
              {
                id: assistantMessageId,
                type: 'updateMessage',
                value: { tools },
              },
              { operationId: context.operationId },
            );
          },
          onGroundingUpdate: (grounding) => {
            internal_dispatchMessage(
              {
                id: assistantMessageId,
                type: 'updateMessage',
                value: { search: grounding },
              },
              { operationId: context.operationId },
            );
          },
          onImagesUpdate: (images) => {
            internal_dispatchMessage(
              {
                id: assistantMessageId,
                type: 'updateMessage',
                value: { imageList: images },
              },
              { operationId: context.operationId },
            );
          },
          onReasoningStart: () => {
            const { operationId: reasoningOpId } = context.get().startOperation({
              type: 'reasoning',
              context: { ...fetchContext, messageId: assistantMessageId },
              parentOperationId: context.operationId,
            });
            context.get().associateMessageWithOperation(assistantMessageId, reasoningOpId);
            return reasoningOpId;
          },
          onReasoningComplete: (opId) => context.get().completeOperation(opId),
          uploadBase64Image: (data) =>
            getFileStoreState()
              .uploadBase64FileWithProgress(data)
              .then((file) => ({
                id: file?.id,
                url: file?.url,
                alt: file?.filename || file?.id,
              })),
          transformToolCalls: (calls) =>
            context.get().internal_transformToolCalls(calls, offeredToolNames),
          toggleToolCallingStreaming: internal_toggleToolCallingStreaming,
        },
      );

      const messages = llmPayload.messages.filter((message) => message.id !== assistantMessageId);

      const contextBudgetEvents: AgentEvent[] = [];
      let contextBudgetAttemptState = state.metadata?.contextBudget?.attemptState as
        | ContextBudgetAttemptState
        | undefined;
      const compressFinalPayload = async (
        budgetPayload: ClientBudgetedChatPayload,
        evaluation: ContextBudgetEvaluation,
      ) => {
        const compressionTrigger =
          evaluation.decision.kind === 'compress' ? evaluation.decision.trigger : 'final-preflight';
        const failedOutcome = {
          afterTokens: evaluation.estimatedPromptTokens,
          attempt: 1 as const,
          beforeTokens: evaluation.estimatedPromptTokens,
          code: 'SUMMARY_FAILED' as const,
          outcome: 'failed' as const,
          payloadFingerprint: evaluation.payloadFingerprint,
          trigger: compressionTrigger,
        };
        const skippedOutcome = {
          afterTokens: evaluation.estimatedPromptTokens,
          attempt: 1 as const,
          beforeTokens: evaluation.estimatedPromptTokens,
          code: 'NO_CANDIDATES' as const,
          outcome: 'skipped' as const,
          payloadFingerprint: evaluation.payloadFingerprint,
          trigger: compressionTrigger,
        };

        if (
          agentConfigData.chatConfig?.enableContextCompression === false ||
          !topicId ||
          !agentId
        ) {
          return { outcome: failedOutcome, payload: budgetPayload };
        }

        const persistedIds = new Set(
          (context.get().dbMessagesMap[context.messageKey] || [])
            .map((message) => message.id)
            .filter(Boolean),
        );
        const messageIds = evaluation.partition.candidateIds.filter((id) => persistedIds.has(id));
        if (messageIds.length === 0) {
          return { outcome: skippedOutcome, payload: budgetPayload };
        }

        const { operationId: compressionOperationId } = context.get().startOperation({
          context: { ...fetchContext, messageId: assistantMessageId },
          metadata: { messageCount: messageIds.length, startTime: Date.now() },
          parentOperationId: context.operationId,
          type: 'contextCompression',
        });
        const compressionModel = state.modelRuntimeConfig?.compressionModel ?? {
          model: llmPayload.model,
          provider: llmPayload.provider,
        };
        const transaction = await runClientContextCompressionTransaction({
          abortController,
          // Only persisted history may enter the persisted compression group. CE injections
          // (system/memory/skills) remain in the provider payload as preserved messages.
          candidateIds: messageIds,
          compressionModel,
          createGroup: () =>
            messageService.createCompressionGroup({
              agentId,
              groupId,
              messageIds,
              threadId: operation.context.threadId,
              topicId,
            }),
          failGroup: (messageGroupId) =>
            messageService.failCompression({
              agentId,
              groupId,
              messageGroupId,
              threadId: operation.context.threadId,
              topicId,
            }),
          finalizeGroup: (messageGroupId, summary) =>
            messageService.finalizeCompression({
              agentId,
              content: summary,
              groupId,
              messageGroupId,
              threadId: operation.context.threadId,
              topicId,
            }),
          metadata: state.metadata,
          rollbackGroup: (messageGroupId) =>
            messageService.cancelCompression({
              agentId,
              groupId,
              messageGroupId,
              threadId: operation.context.threadId,
              topicId,
            }),
          sourceMessages: budgetPayload.messages as UIChatMessage[],
          tools: budgetPayload.tools,
          trigger: compressionTrigger,
        });

        if (transaction.kind === 'failed') {
          if (transaction.rollbackError) {
            log(`${stagePrefix} Final compression rollback failed: %O`, transaction.rollbackError);
          }
          context.get().completeOperation(compressionOperationId, {
            error: {
              message:
                transaction.error instanceof Error
                  ? transaction.error.message
                  : String(transaction.error ?? 'SUMMARY_FAILED'),
              type: 'compression_failed',
            },
          });
          return { outcome: transaction.outcome, payload: budgetPayload };
        }

        context.get().replaceMessages(transaction.finalizedMessages, {
          context: operation.context,
        });
        context.get().completeOperation(compressionOperationId, { groupId: transaction.groupId });
        contextBudgetEvents.push({
          groupId: transaction.groupId,
          parentMessageId: assistantMessageId,
          type: 'compression_complete',
        });
        return {
          outcome: transaction.outcome,
          payload: {
            ...budgetPayload,
            messages: transaction.providerMessages,
            providerMedia: collectClientProviderMediaTokenEstimates(transaction.providerMessages),
          },
        };
      };

      await chatService.createAssistantMessageStream({
        abortController,
        contextBudget: {
          attemptState: contextBudgetAttemptState,
          catalogSnapshot: state.metadata?.modelCatalogSnapshot,
          compress: compressFinalPayload,
          onAttemptState: (attemptState) => {
            contextBudgetAttemptState = attemptState;
          },
          onProviderAttemptDiscard: () => handler.discardAttempt(),
          operationId: state.operationId,
          outputReserveTokens: 1024,
        },
        params: {
          agentId: agentId || undefined,
          groupId,
          messages,
          model: llmPayload.model,
          operationSkills: context.operationSkills?.map((skill) => {
            const activation = state.activatedStepSkills?.find((item) => item.key === skill.key);
            return activation ? { ...skill, activated: true, content: activation.content } : skill;
          }),
          executionContext: state.metadata?.executionContext,
          provider: llmPayload.provider,
          resolvedAgentConfig,
          topicId: topicId ?? undefined,
          ...agentConfigData.params,
        },
        initialContext: runtimeContext?.initialContext,
        metadata: context.metadata,
        stepContext: runtimeContext?.stepContext,
        trace: {
          traceId,
          topicId: topicId ?? undefined,
          traceName: TraceNameMap.Conversation,
        },
        onErrorHandle: async (error) => {
          const enrichedError = {
            ...error,
            body: {
              ...error.body,
              traceId: traceId ?? error.body?.traceId,
            },
          };
          const localizedError = localizeError(enrichedError);

          await context.get().optimisticUpdateMessageError(assistantMessageId, localizedError, {
            operationId: context.operationId,
          });
        },
        onFinish: async (
          _content,
          { traceId, observationId, toolCalls, reasoning, grounding, usage, speed, type },
        ) => {
          void _content;

          if (traceId) {
            messageService.updateMessage(
              assistantMessageId,
              { traceId, observationId: observationId ?? undefined },
              { agentId, groupId, topicId },
            );
          }

          const result = await handler.handleFinish({
            traceId,
            observationId,
            toolCalls,
            reasoning,
            grounding,
            usage,
            speed,
            type,
          });

          finalUsage = result.usage;
          finalToolCalls = result.toolCalls;

          await optimisticUpdateMessageContent(
            assistantMessageId,
            result.content,
            {
              tools: result.tools,
              reasoning: result.metadata.reasoning,
              search: result.metadata.search,
              imageList: result.metadata.imageList,
              metadata: {
                ...result.metadata.usage,
                ...result.metadata.performance,
                performance: result.metadata.performance,
                usage: result.metadata.usage,
                finishType: result.metadata.finishType,
                ...(result.metadata.isMultimodal && { isMultimodal: true }),
              },
            },
            { operationId: context.operationId },
          );
        },
        onMessageHandle: async (chunk) => {
          handler.handleChunk(chunk as StreamChunk);
        },
      });

      const isFunctionCall = handler.getIsFunctionCall();
      const content = handler.getOutput();
      const tools = handler.getTools();
      const currentStepUsage = finalUsage;
      const tool_calls = finalToolCalls;
      const finishType = handler.getFinishType();

      log(`[${sessionLogId}] finish model-runtime calling`);

      // Get latest messages from store (already updated by internal_fetchAIChatMessage)
      const latestMessages = context.get().dbMessagesMap[context.messageKey] || [];

      log(
        `${stagePrefix} After fetch: dbMessagesMap[${context.messageKey}]=%d messages, available keys=%o`,
        latestMessages.length,
        Object.keys(context.get().dbMessagesMap),
      );

      // Get updated assistant message to extract usage/cost information
      const assistantMessage = latestMessages.find((m) => m.id === assistantMessageId);

      const toolCalls = tools || [];

      // Log llm result
      if (content) {
        log(`[${sessionLogId}][content]`, content);
      }
      if (assistantMessage?.reasoning?.content) {
        log(`[${sessionLogId}][reasoning]`, assistantMessage.reasoning.content);
      }
      if (toolCalls.length > 0) {
        log(`[${sessionLogId}][toolsCalling] `, toolCalls);
      }

      // Log usage
      if (currentStepUsage) {
        log(`[${sessionLogId}][usage] %O`, currentStepUsage);
      }

      log(
        '[%s:%d] call_llm completed, finishType: %s, outputMessages: %d',
        state.operationId,
        state.stepCount,
        finishType,
        latestMessages.length,
      );

      // Accumulate usage and cost to state
      const newState = {
        ...state,
        messages: latestMessages,
        metadata: {
          ...state.metadata,
          contextBudget: {
            ...state.metadata?.contextBudget,
            attemptState: contextBudgetAttemptState,
            catalogSnapshot: state.metadata?.modelCatalogSnapshot,
          },
        },
      };

      if (currentStepUsage) {
        // Use UsageCounter to accumulate LLM usage and cost
        const { usage, cost } = UsageCounter.accumulateLLM({
          cost: state.cost,
          model: llmPayload.model,
          modelUsage: currentStepUsage,
          provider: llmPayload.provider,
          usage: state.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;
      }

      // If operation was aborted, enter human_abort phase to let agent decide how to handle
      if (finishType === 'abort') {
        log(
          '[%s:%d] call_llm aborted by user, entering human_abort phase',
          state.operationId,
          state.stepCount,
        );

        return {
          events: contextBudgetEvents,
          newState,
          nextContext: {
            payload: {
              reason: 'user_cancelled',
              parentMessageId: assistantMessageId,
              hasToolsCalling: isFunctionCall,
              toolsCalling: toolCalls,
              result: { content, tool_calls },
            },
            phase: 'human_abort',
            session: {
              messageCount: newState.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      return {
        events: contextBudgetEvents,
        newState,
        nextContext: {
          payload: {
            hasToolsCalling: isFunctionCall,
            parentMessageId: assistantMessageId,
            result: { content, tool_calls },
            toolsCalling: toolCalls,
          } as GeneralAgentCallLLMResultPayload,
          phase: 'llm_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: state.operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
          stepUsage: currentStepUsage,
        } as AgentRuntimeContext,
      };
    },

    /**
     * Custom call_tool executor
     * Runs the Electron tool lifecycle: ensure message, execute once, then commit result.
     */
    call_tool: async (instruction, state, runtimeContext) => {
      const payload = (instruction as AgentInstructionCallTool)
        .payload as GeneralAgentCallingToolInstructionPayload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][call_tool] Executor start, payload: %O', sessionLogId, payload);

      // Convert CallingToolPayload to ChatToolPayload for ToolExecutionService
      const chatToolPayload: ChatToolPayload = payload.toolCalling;

      const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;

      // Get context from operation
      const opContext = getOperationContext();
      // Get assistant message to derive the same-turn source user message when the root
      // runtime operation is anchored to the assistant message.
      const latestMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const existingToolMessage = payload.skipCreateToolMessage
        ? latestMessages.find((m) => m.id === payload.parentMessageId)
        : undefined;
      const assistantMessage =
        latestMessages.find((m) => m.id === payload.parentMessageId && m.role === 'assistant') ??
        (existingToolMessage?.parentId
          ? latestMessages.find(
              (m) => m.id === existingToolMessage.parentId && m.role === 'assistant',
            )
          : undefined) ??
        (opContext.messageId
          ? latestMessages.find((m) => m.id === opContext.messageId && m.role === 'assistant')
          : undefined) ??
        latestMessages.findLast((m) => m.role === 'assistant');
      const sourceMessageId =
        opContext.sourceMessageId ??
        assistantMessage?.parentId ??
        (opContext.messageId !== assistantMessage?.id ? opContext.messageId : undefined);

      try {
        const toolMessageId = payload.skipCreateToolMessage
          ? payload.parentMessageId
          : `msg_${createToolMessageId()}`;
        const toolMessageParentId = payload.skipCreateToolMessage
          ? existingToolMessage?.parentId || assistantMessage?.id
          : payload.parentMessageId;
        if (!toolMessageParentId) {
          throw new Error(
            `Cannot prepare existing tool message ${toolMessageId} without its parent`,
          );
        }
        const lifecycleContext = {
          ...opContext,
          agentId: opContext.agentId!,
          sourceMessageId,
        };
        const approvalMode =
          state.userInterventionConfig?.approvalMode ??
          context.get().operations[context.operationId]?.metadata.executionContext?.approvalMode;
        const lifecycle = createChatStoreToolCallLifecycle({
          approvalMode,
          context: lifecycleContext,
          get: context.get,
          messageAgentId: getEffectiveAgentId(),
          messageGroupId: assistantMessage?.groupId,
          onOperationStart: (operation) => {
            if (operation.type !== 'createToolMessage' && operation.type !== 'executeToolCall') {
              return;
            }

            context.get().onOperationCancel(operation.id, async () => {
              log(
                '[%s][call_tool] %s cancelled; projecting aborted tool message',
                sessionLogId,
                operation.type,
              );
              await Promise.allSettled([
                context
                  .get()
                  .optimisticUpdateMessageContent(
                    toolMessageId,
                    'Tool execution was cancelled by user.',
                    undefined,
                    { operationId: operation.id },
                  ),
                context
                  .get()
                  .optimisticUpdateMessagePlugin(
                    toolMessageId,
                    { intervention: { status: 'aborted' } },
                    { operationId: operation.id },
                  ),
              ]);
            });
          },
        });

        log(
          '[%s][call_tool] Running lifecycle for %s with stable message %s (resume=%s)',
          sessionLogId,
          toolName,
          toolMessageId,
          !!payload.skipCreateToolMessage,
        );

        const rootOperationSignal =
          context.get().operations[context.operationId]?.abortController.signal;
        const lifecycleSignal = combineAbortSignals(rootOperationSignal, runtimeContext?.signal);
        const receipt = await lifecycle
          .run({
            context: lifecycleContext,
            message: payload.skipCreateToolMessage
              ? {
                  kind: 'existing',
                  messageId: toolMessageId,
                  parentMessageId: toolMessageParentId,
                }
              : {
                  kind: 'create',
                  messageId: toolMessageId,
                  parentMessageId: toolMessageParentId,
                },
            parentOperationId: context.operationId,
            signal: lifecycleSignal.signal,
            stepContext: runtimeContext?.stepContext,
            toolCall: chatToolPayload,
          })
          .finally(lifecycleSignal.cleanup);
        const { executionTimeMs: executionTime, result } = receipt;

        const executionContext =
          context.get().operations[context.operationId]?.metadata.executionContext;
        const pathRequest = getRuntimePathConsentRequest({ state: result.state });
        if (
          !result.success &&
          result.content === 'INTERVENTION_REQUIRED' &&
          chatToolPayload.identifier === LocalSystemIdentifier &&
          pathRequest &&
          executionContext?.plan.kind === 'device' &&
          executionContext.plan.target === 'local' &&
          pathRequest.deviceId === executionContext.plan.deviceId &&
          pathRequest.operationId === (executionContext.operationId ?? context.operationId) &&
          pathRequest.topicId === opContext.topicId &&
          shouldPauseForPathConsent(approvalMode, pathRequest.requestedPath)
        ) {
          const updateContext = { operationId: context.operationId };
          context.get().preservePausedExecutionContext(toolMessageId, executionContext);
          await context.get().optimisticUpdateToolMessage(
            toolMessageId,
            {
              content: '',
              pluginError: null,
              pluginState: result.state,
            },
            updateContext,
          );
          await context.get().optimisticUpdateMessagePlugin(
            toolMessageId,
            {
              intervention: { status: 'pending' },
            },
            updateContext,
          );
          return {
            events: [
              {
                type: 'human_approve_required',
                operationId: state.operationId,
                pendingToolsCalling: [chatToolPayload],
              },
            ],
            newState: {
              ...state,
              messages: context.get().dbMessagesMap[context.messageKey] || [],
              status: 'waiting_for_human',
              pendingToolsCalling: [chatToolPayload],
            },
          };
        }

        const isSuccess = result.success;

        log(
          '[%s][call_tool] Executing %s in %dms, result: %O',
          sessionLogId,
          toolName,
          executionTime,
          result,
        );

        events.push({ id: chatToolPayload.id, result, type: 'tool_result' });

        // The message adapter already projected the committed result into the renderer store.
        const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];

        const newState = { ...state, messages: updatedMessages };
        if (
          result.success &&
          chatToolPayload.identifier === 'lobe-skills' &&
          chatToolPayload.apiName === 'activateSkill'
        ) {
          const activation = result.state as { id?: string; content?: string } | undefined;
          const skill = context.operationSkills?.find(
            (candidate) => candidate.key === activation?.id,
          );
          if (skill) {
            newState.activatedStepSkills = [
              ...(state.activatedStepSkills ?? []).filter((item) => item.key !== skill.key),
              {
                key: skill.key,
                identifier: skill.identifier,
                content: result.content,
                activatedAtStep: state.stepCount,
              },
            ];
          }
        }

        // Get tool unit price
        const toolCost = TOOL_PRICING[toolName] || 0;

        // Use UsageCounter to accumulate tool usage
        const { usage, cost } = UsageCounter.accumulateTool({
          cost: state.cost,
          executionTime,
          success: isSuccess,
          toolCost,
          toolName,
          usage: state.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;

        // Find current tool statistics
        const currentToolStats = usage.tools.byTool.find((t) => t.name === toolName);

        // Log usage
        log(
          '[%s][tool usage] %s: calls=%d, time=%dms, success=%s, cost=$%s',
          sessionLogId,
          toolName,
          currentToolStats?.calls || 0,
          executionTime,
          isSuccess,
          toolCost.toFixed(4),
        );

        // Check if tool wants to stop execution flow
        if (result?.stop) {
          log('[%s][call_tool] Tool returned stop=true, state: %O', sessionLogId, result.state);

          const stateType = result.state?.type;

          // Legacy agent-invocation dispatches need to be forwarded to the Agent
          // runtime as exec_sub_agent / exec_sub_agents instructions. This covers
          // server-side callAgent task states plus the desktop client-side variants.
          const legacyAgentInvocationStateTypes = [
            'execSubAgent',
            'execSubAgents',
            'execClientSubAgent',
            'execClientSubAgents',
          ];
          if (legacyAgentInvocationStateTypes.includes(stateType)) {
            log(
              '[%s][call_tool] Detected %s state, passing to Agent for decision',
              sessionLogId,
              stateType,
            );

            return {
              events,
              newState,
              nextContext: {
                payload: {
                  data: result,
                  executionTime,
                  isSuccess,
                  parentMessageId: toolMessageId,
                  stop: true,
                  toolCall: chatToolPayload,
                  toolCallId: chatToolPayload.id,
                } as GeneralAgentCallToolResultPayload,
                phase: 'tool_result',
                session: {
                  eventCount: events.length,
                  messageCount: newState.messages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
                stepUsage: {
                  cost: toolCost,
                  toolName,
                  unitPrice: toolCost,
                  usageCount: 1,
                },
              } as AgentRuntimeContext,
            };
          }

          // Other stop types (speak, delegate, broadcast, etc.) - stop execution immediately
          newState.status = 'done';

          return {
            events,
            newState,
            nextContext: undefined,
          };
        }

        log('[%s][call_tool] Tool execution completed', sessionLogId);

        return {
          events,
          newState,
          nextContext: {
            payload: {
              data: result,
              executionTime,
              isSuccess,
              parentMessageId: toolMessageId,
              toolCall: chatToolPayload,
              toolCallId: chatToolPayload.id,
            } as GeneralAgentCallToolResultPayload,
            phase: 'tool_result',
            session: {
              eventCount: events.length,
              messageCount: newState.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
            stepUsage: {
              cost: toolCost,
              toolName,
              unitPrice: toolCost,
              usageCount: 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        log(
          '[%s][call_tool] Lifecycle failed and terminalized its operation subtree: %O',
          sessionLogId,
          error,
        );
        throw error;
      }
    },

    /** Create human approve executor */
    request_human_approve: async (instruction, state) => {
      const { pendingToolsCalling, reason, skipCreateToolMessage } = instruction as Extract<
        AgentInstruction,
        { type: 'request_human_approve' }
      >;
      const newState = structuredClone(state);
      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log(
        '[%s][request_human_approve] Executor start, pending tools count: %d, reason: %s',
        sessionLogId,
        pendingToolsCalling.length,
        reason || 'human_intervention_required',
      );

      // Update state to waiting_for_human
      newState.lastModified = new Date().toISOString();
      newState.status = 'waiting_for_human';
      newState.pendingToolsCalling = pendingToolsCalling;

      // Get assistant message to extract groupId and parentId
      const latestMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const assistantMessage = latestMessages.findLast((m) => m.role === 'assistant');
      const executionContext =
        context.get().operations[context.operationId]?.metadata.executionContext ??
        state.metadata?.executionContext;

      if (!assistantMessage) {
        log('[%s][request_human_approve] ERROR: No assistant message found', sessionLogId);
        throw new Error('No assistant message found for intervention');
      }

      log(
        '[%s][request_human_approve] Found assistant message: %s',
        sessionLogId,
        assistantMessage.id,
      );

      if (skipCreateToolMessage) {
        // Resumption mode: Tool messages already exist, just verify them
        log('[%s][request_human_approve] Resuming with existing tool messages', sessionLogId);
        if (executionContext) {
          for (const toolPayload of pendingToolsCalling) {
            const toolMessage = latestMessages.find(
              (message) => message.role === 'tool' && message.tool_call_id === toolPayload.id,
            );
            if (toolMessage) {
              context.get().preservePausedExecutionContext(toolMessage.id, executionContext);
            }
          }
        }
      } else {
        // Get context from operation
        const opContext = getOperationContext();
        // Get effective agentId (subAgentId for group orchestration)
        const effectiveAgentId = getEffectiveAgentId();

        // Create tool messages for each pending tool call with intervention status
        await pMap(pendingToolsCalling, async (toolPayload) => {
          const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
          log(
            '[%s][request_human_approve] Creating tool message for %s with tool_call_id: %s',
            sessionLogId,
            toolName,
            toolPayload.id,
          );

          const toolMessageParams: CreateMessageParams = {
            content: '',
            groupId: assistantMessage.groupId,
            parentId: assistantMessage.id,
            plugin: {
              ...toolPayload,
            },
            pluginIntervention: { status: 'pending' },
            role: 'tool',
            agentId: effectiveAgentId!,
            threadId: opContext.threadId,
            tool_call_id: toolPayload.id,
            topicId: opContext.topicId ?? undefined,
          };

          const createResult = await context
            .get()
            .optimisticCreateMessage(toolMessageParams, { operationId: context.operationId });

          if (!createResult) {
            log(
              '[%s][request_human_approve] ERROR: Failed to create tool message for %s',
              sessionLogId,
              toolName,
            );
            throw new Error(`Failed to create tool message for ${toolName}`);
          }

          if (executionContext) {
            context.get().preservePausedExecutionContext(createResult.id, executionContext);
          }

          log(
            '[%s][request_human_approve] Created tool message: %s for %s',
            sessionLogId,
            createResult.id,
            toolName,
          );
        });
      }

      log(
        '[%s][request_human_approve] All tool messages created, emitting human_approve_required event',
        sessionLogId,
      );

      events.push({
        operationId: newState.operationId,
        pendingToolsCalling,
        type: 'human_approve_required',
      });

      return { events, newState };
    },

    /**
     * Resolve aborted tools executor
     * Creates tool messages with 'aborted' intervention status for cancelled tools
     */
    resolve_aborted_tools: async (instruction, state) => {
      const { parentMessageId, toolsCalling } = (
        instruction as Extract<AgentInstruction, { type: 'resolve_aborted_tools' }>
      ).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;
      const newState = structuredClone(state);

      log(
        '[%s][resolve_aborted_tools] Resolving %d aborted tools',
        sessionLogId,
        toolsCalling.length,
      );

      // Get context from operation
      const opContext = getOperationContext();
      // Get effective agentId (subAgentId for group orchestration)
      const effectiveAgentId = getEffectiveAgentId();

      // Create tool messages for each aborted tool
      await pMap(toolsCalling, async (toolPayload) => {
        const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
        log(
          '[%s][resolve_aborted_tools] Creating aborted tool message for %s',
          sessionLogId,
          toolName,
        );

        const toolMessageParams: CreateMessageParams = {
          content: 'Tool execution was aborted by user.',
          groupId: opContext.groupId,
          parentId: parentMessageId,
          plugin: toolPayload,
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          agentId: effectiveAgentId!,
          threadId: opContext.threadId,
          tool_call_id: toolPayload.id,
          topicId: opContext.topicId ?? undefined,
        };

        const createResult = await context
          .get()
          .optimisticCreateMessage(toolMessageParams, { operationId: context.operationId });

        if (createResult) {
          log(
            '[%s][resolve_aborted_tools] Created aborted tool message: %s for %s',
            sessionLogId,
            createResult.id,
            toolName,
          );
        }
      });

      log('[%s][resolve_aborted_tools] All aborted tool messages created', sessionLogId);

      // Mark state as done since we're finishing after abort
      newState.lastModified = new Date().toISOString();
      newState.status = 'done';

      events.push({
        finalState: newState,
        reason: 'user_aborted',
        reasonDetail: 'User aborted operation with pending tool calls',
        type: 'done',
      });

      return { events, newState };
    },

    /**
     * Finish executor
     * Completes the runtime execution
     */
    finish: async (instruction, state) => {
      const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log(`[${sessionLogId}] Finishing execution: (%s)`, reason);

      const newState = structuredClone(state);
      newState.lastModified = new Date().toISOString();
      newState.status = 'done';

      const events: AgentEvent[] = [{ finalState: newState, reason, reasonDetail, type: 'done' }];

      return { events, newState };
    },

    /**
     * exec_sub_agent executor
     * Dispatches a single sub-agent
     *
     * Flow:
     * 1. Create a task message (role: 'task') as placeholder
     * 2. Call execSubAgentTask API (backend creates thread)
     * 3. Poll for sub-agent completion
     * 4. Update task message content with result on completion
     * 5. Return sub_agent_result phase with result
     */
    exec_sub_agent: async (instruction, state) => {
      const { parentMessageId, task } = (instruction as AgentInstructionExecSubAgent).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][exec_sub_agent] Starting execution of task: %s', sessionLogId, task.description);

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      // Check for targetAgentId (callAgent mode)
      const targetAgentId = (task as any).targetAgentId;
      const executionAgentId = targetAgentId || agentId;

      if (!agentId || !topicId || !executionAgentId) {
        log('[%s][exec_sub_agent] No valid context, cannot execute task', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: 'No valid context available',
                success: false,
                taskMessageId: '',
                threadId: '',
              },
            } as SubAgentResultPayload,
            phase: 'sub_agent_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      if (targetAgentId) {
        log(
          '[%s][exec_sub_agent] callAgent mode - current agent: %s, target agent: %s',
          sessionLogId,
          agentId,
          targetAgentId,
        );
      }

      const taskLogId = `${sessionLogId}:task`;

      try {
        // 1. Create task message as placeholder
        // IMPORTANT: Use operation context's agentId (current agent) for message creation
        // This ensures the task message appears in the current conversation
        const taskMessageResult = await context.get().optimisticCreateMessage(
          {
            agentId, // Use current agent's ID (not targetAgentId)
            content: '',
            metadata: {
              instruction: task.instruction,
              taskTitle: task.description,
              // Store targetAgentId in metadata for UI display
              ...(targetAgentId && { targetAgentId }),
            },
            parentId: parentMessageId,
            role: 'task',
            topicId,
          },
          { operationId: state.operationId },
        );

        if (!taskMessageResult) {
          log('[%s] Failed to create task message', taskLogId);
          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                parentMessageId,
                result: {
                  error: 'Failed to create task message',
                  success: false,
                  taskMessageId: '',
                  threadId: '',
                },
              } as SubAgentResultPayload,
              phase: 'sub_agent_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        const taskMessageId = taskMessageResult.id;
        log('[%s] Created task message: %s', taskLogId, taskMessageId);

        // 2. Create and execute task on server
        // IMPORTANT: Use executionAgentId here (targetAgentId if in callAgent mode)
        // This ensures the task executes with the correct agent's config
        log('[%s] Using server-side execution with agentId: %s', taskLogId, executionAgentId);
        const createResult = await aiAgentService.execSubAgentTask({
          agentId: executionAgentId, // Use targetAgentId for callAgent, or current agentId for sub-agent dispatch
          instruction: task.instruction,
          parentMessageId: taskMessageId,
          title: task.description,
          topicId,
        });

        if (!createResult.success) {
          log('[%s] Failed to create task: %s', taskLogId, createResult.error);
          await context
            .get()
            .optimisticUpdateMessageContent(
              taskMessageId,
              `Task creation failed: ${createResult.error}`,
              undefined,
              { operationId: state.operationId },
            );
          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                parentMessageId,
                result: {
                  error: createResult.error,
                  success: false,
                  taskMessageId,
                  threadId: '',
                },
              } as SubAgentResultPayload,
              phase: 'sub_agent_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        log('[%s] Task created with threadId: %s', taskLogId, createResult.threadId);

        // 3. Poll for task completion
        const pollInterval = 3000; // 3 seconds
        const maxWait = task.timeout || 1_800_000; // Default 30 minutes
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          // Check if parent operation has been cancelled
          const currentOperation = context.get().operations[state.operationId];
          if (currentOperation?.status === 'cancelled') {
            log('[%s] Operation cancelled, stopping polling', taskLogId);

            // Send interrupt request to stop the server-side task
            try {
              await aiAgentService.interruptTask({ threadId: createResult.threadId });
              log('[%s] Sent interrupt request for cancelled task', taskLogId);
            } catch (err) {
              log('[%s] Failed to interrupt cancelled task: %O', taskLogId, err);
            }

            // Update task message to cancelled state
            await context
              .get()
              .optimisticUpdateMessageContent(
                taskMessageId,
                'Task was cancelled by user.',
                undefined,
                { operationId: state.operationId },
              );

            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: 'Operation cancelled',
                    success: false,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          const status = await aiAgentService.getSubAgentTaskStatus({
            threadId: createResult.threadId,
          });

          // Update taskDetail in message if available
          if (status.taskDetail) {
            context.get().internal_dispatchMessage(
              {
                id: taskMessageId,
                type: 'updateMessage',
                value: { taskDetail: status.taskDetail },
              },
              { operationId: state.operationId },
            );
            log('[%s] Updated task message with taskDetail', taskLogId);
          }

          if (status.status === 'completed') {
            log('[%s] Task completed successfully', taskLogId);
            if (status.result) {
              await context
                .get()
                .optimisticUpdateMessageContent(taskMessageId, status.result, undefined, {
                  operationId: state.operationId,
                });
            }
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    result: status.result,
                    success: true,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          if (status.status === 'failed') {
            // Extract error message (error is always a string in TaskStatusResult)
            const errorMessage = status.error || 'Unknown error';
            log('[%s] Task failed: %s', taskLogId, errorMessage);
            await context
              .get()
              .optimisticUpdateMessageContent(
                taskMessageId,
                `Task failed: ${errorMessage}`,
                undefined,
                { operationId: state.operationId },
              );
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: status.error,
                    success: false,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          if (status.status === 'cancel') {
            log('[%s] Task was cancelled', taskLogId);
            // Note: Don't fail the operation here - it was cancelled intentionally
            // The cancel handler already updated the message
            await context
              .get()
              .optimisticUpdateMessageContent(taskMessageId, 'Task was cancelled', undefined, {
                operationId: state.operationId,
              });
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: 'Task was cancelled',
                    success: false,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as SubAgentResultPayload,
                phase: 'sub_agent_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          // Still processing, wait and poll again
          await sleep(pollInterval);
        }

        // Timeout reached
        log('[%s] Task timeout after %dms', taskLogId, maxWait);

        // Try to interrupt the task that timed out
        try {
          await aiAgentService.interruptTask({ threadId: createResult.threadId });
          log('[%s] Sent interrupt request for timed out task', taskLogId);
        } catch (err) {
          log('[%s] Failed to interrupt timed out task: %O', taskLogId, err);
        }

        await context
          .get()
          .optimisticUpdateMessageContent(
            taskMessageId,
            `Task timeout after ${maxWait}ms`,
            undefined,
            { operationId: state.operationId },
          );

        const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: `Task timeout after ${maxWait}ms`,
                success: false,
                taskMessageId,
                threadId: createResult.threadId,
              },
            } as SubAgentResultPayload,
            phase: 'sub_agent_result',
            session: {
              messageCount: updatedMessages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        log('[%s] Error executing task: %O', taskLogId, error);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: error instanceof Error ? error.message : 'Unknown error',
                success: false,
                taskMessageId: '',
                threadId: '',
              },
            } as SubAgentResultPayload,
            phase: 'sub_agent_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }
    },

    /**
     * exec_sub_agents executor
     * Dispatches one or more sub-agents in parallel
     *
     * Flow:
     * 1. For each sub-agent, create a task message (role: 'task') as placeholder
     * 2. Call execSubAgentTask API (backend creates thread)
     * 3. Poll for sub-agent completion
     * 4. Update task message content with result on completion
     * 5. Return sub_agents_batch_result phase with all results
     */
    exec_sub_agents: async (instruction, state) => {
      const { parentMessageId, tasks } = (instruction as AgentInstructionExecSubAgents).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][exec_sub_agents] Starting execution of %d tasks', sessionLogId, tasks.length);

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      if (!agentId || !topicId) {
        log('[%s][exec_sub_agents] No valid context, cannot execute tasks', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              results: tasks.map(() => ({
                error: 'No valid context available',
                success: false,
                taskMessageId: '',
                threadId: '',
              })),
            } as SubAgentsBatchResultPayload,
            phase: 'sub_agents_batch_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Execute all tasks in parallel
      const results = await pMap(
        tasks,
        async (task, taskIndex) => {
          const taskLogId = `${sessionLogId}:task-${taskIndex}`;
          log('[%s] Starting task: %s', taskLogId, task.description);

          try {
            // 1. Create task message as placeholder
            const taskMessageResult = await context.get().optimisticCreateMessage(
              {
                agentId,
                content: '',
                createdAt: Date.now() + taskIndex,
                metadata: { instruction: task.instruction },
                parentId: parentMessageId,
                role: 'task',
                topicId,
              },
              { operationId: state.operationId },
            );

            if (!taskMessageResult) {
              log('[%s] Failed to create task message', taskLogId);
              return {
                error: 'Failed to create task message',
                success: false,
                taskMessageId: '',
                threadId: '',
              };
            }

            const taskMessageId = taskMessageResult.id;
            log('[%s] Created task message: %s', taskLogId, taskMessageId);

            // 2. Create and execute task on server
            log('[%s] Using server-side execution', taskLogId);
            const createResult = await aiAgentService.execSubAgentTask({
              agentId,
              instruction: task.instruction,
              parentMessageId: taskMessageId,
              title: task.description,
              topicId,
            });

            if (!createResult.success) {
              log('[%s] Failed to create task: %s', taskLogId, createResult.error);
              // Update task message with error
              await context
                .get()
                .optimisticUpdateMessageContent(
                  taskMessageId,
                  `Task creation failed: ${createResult.error}`,
                  undefined,
                  { operationId: state.operationId },
                );
              return {
                error: createResult.error,
                success: false,
                taskMessageId,
                threadId: '',
              };
            }

            log('[%s] Task created with threadId: %s', taskLogId, createResult.threadId);

            // 4. Poll for task completion
            const pollInterval = 3000; // 3 seconds
            const maxWait = task.timeout || 1_800_000; // Default 30 minutes
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
              // Check if parent operation has been cancelled
              const currentOperation = context.get().operations[state.operationId];
              if (currentOperation?.status === 'cancelled') {
                log('[%s] Operation cancelled, stopping polling', taskLogId);

                // Send interrupt request to stop the server-side task
                try {
                  await aiAgentService.interruptTask({ threadId: createResult.threadId });
                  log('[%s] Sent interrupt request for cancelled task', taskLogId);
                } catch (err) {
                  log('[%s] Failed to interrupt cancelled task: %O', taskLogId, err);
                }

                // Update task message to cancelled state
                await context
                  .get()
                  .optimisticUpdateMessageContent(
                    taskMessageId,
                    'Task was cancelled by user.',
                    undefined,
                    { operationId: state.operationId },
                  );

                return {
                  error: 'Operation cancelled',
                  success: false,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              const status = await aiAgentService.getSubAgentTaskStatus({
                threadId: createResult.threadId,
              });

              // Update taskDetail in message if available
              if (status.taskDetail) {
                context.get().internal_dispatchMessage(
                  {
                    id: taskMessageId,
                    type: 'updateMessage',
                    value: { taskDetail: status.taskDetail },
                  },
                  { operationId: state.operationId },
                );
                log('[%s] Updated task message with taskDetail', taskLogId);
              }

              if (status.status === 'completed') {
                log('[%s] Task completed successfully', taskLogId);
                // 5. Update task message with result
                if (status.result) {
                  await context
                    .get()
                    .optimisticUpdateMessageContent(taskMessageId, status.result, undefined, {
                      operationId: state.operationId,
                    });
                }
                return {
                  result: status.result,
                  success: true,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              if (status.status === 'failed') {
                const errorMessage = status.error || 'Unknown error';
                log('[%s] Task failed: %s', taskLogId, errorMessage);
                // Update task message with error
                await context
                  .get()
                  .optimisticUpdateMessageContent(
                    taskMessageId,
                    `Task failed: ${errorMessage}`,
                    undefined,
                    { operationId: state.operationId },
                  );
                return {
                  error: status.error,
                  success: false,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              if (status.status === 'cancel') {
                log('[%s] Task was cancelled', taskLogId);
                // Note: Don't fail the operation here - it was cancelled intentionally
                // The cancel handler already updated the message
                await context
                  .get()
                  .optimisticUpdateMessageContent(taskMessageId, 'Task was cancelled', undefined, {
                    operationId: state.operationId,
                  });
                return {
                  error: 'Task was cancelled',
                  success: false,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              // Still processing, wait and poll again
              await sleep(pollInterval);
            }

            // Timeout reached
            log('[%s] Task timeout after %dms', taskLogId, maxWait);

            // Try to interrupt the task that timed out
            try {
              await aiAgentService.interruptTask({ threadId: createResult.threadId });
              log('[%s] Sent interrupt request for timed out task', taskLogId);
            } catch (err) {
              log('[%s] Failed to interrupt timed out task: %O', taskLogId, err);
            }

            // Update task message with timeout error
            await context
              .get()
              .optimisticUpdateMessageContent(
                taskMessageId,
                `Task timeout after ${maxWait}ms`,
                undefined,
                { operationId: state.operationId },
              );

            return {
              error: `Task timeout after ${maxWait}ms`,
              success: false,
              taskMessageId,
              threadId: createResult.threadId,
            };
          } catch (error) {
            log('[%s] Error executing task: %O', taskLogId, error);
            return {
              error: error instanceof Error ? error.message : 'Unknown error',
              success: false,
              taskMessageId: '',
              threadId: '',
            };
          }
        },
        { concurrency: 15 }, // Limit concurrent tasks
      );

      log('[%s][exec_sub_agents] All tasks completed, results: %O', sessionLogId, results);

      // Get latest messages from store
      const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const newState = { ...state, messages: updatedMessages };

      // Return sub_agents_batch_result phase
      return {
        events,
        newState,
        nextContext: {
          payload: {
            parentMessageId,
            results,
          } as SubAgentsBatchResultPayload,
          phase: 'sub_agents_batch_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: state.operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as AgentRuntimeContext,
      };
    },

    /**
     * Context compression executor
     * Compresses ALL messages into a single MessageGroup summary to reduce token usage
     */
    compress_context: async (instruction, state) => {
      const sessionLogId = `${state.operationId}:${state.stepCount}`;
      const stagePrefix = `[${sessionLogId}][compress_context]`;

      const { payload } = instruction as AgentInstructionCompressContext;
      const { messages, currentTokenCount } = payload;
      const budgetPayload = payload as AgentInstructionCompressContext['payload'] & {
        candidateIds?: readonly string[];
        catalogSnapshot?: ModelCatalogSnapshot;
        observedWindowTokens?: number;
        outputReserveTokens?: number;
        payloadFingerprint?: string;
        providerMedia?: ClientBudgetedChatPayload['providerMedia'];
        sentPayloadFingerprints?: readonly string[];
        trigger?: 'final-preflight' | 'manual' | 'provider-error' | 'threshold';
      };

      // Get topicId from operation context (same as agentId)
      const { topicId } = getOperationContext();

      log(
        `${stagePrefix} Starting compression. displayMessages=%d, tokens=%d`,
        messages.length,
        currentTokenCount,
      );

      const events: AgentEvent[] = [];
      const inputMeasurement = countContextTokens({
        messages,
        providerMedia: budgetPayload.providerMedia,
        tools: state.tools,
      });
      const payloadFingerprint =
        budgetPayload.payloadFingerprint ?? inputMeasurement.payloadFingerprint;
      const compressionTrigger = budgetPayload.trigger ?? 'threshold';
      const forwardedBudgetContext = {
        catalogSnapshot: budgetPayload.catalogSnapshot,
        observedWindowTokens: budgetPayload.observedWindowTokens,
        outputReserveTokens: budgetPayload.outputReserveTokens,
        providerMedia: budgetPayload.providerMedia,
        sentPayloadFingerprints: budgetPayload.sentPayloadFingerprints,
      };
      const resultPayload = (
        outcome: 'failed' | 'skipped',
        compressedMessages: UIChatMessage[],
        parentMessageId?: string,
      ) => ({
        ...forwardedBudgetContext,
        afterTokens: currentTokenCount,
        attempt: 1 as const,
        beforeTokens: currentTokenCount,
        code: outcome === 'failed' ? ('SUMMARY_FAILED' as const) : ('NO_CANDIDATES' as const),
        compressedMessages,
        groupId: '',
        outcome,
        parentMessageId,
        payloadFingerprint,
        skipped: outcome === 'skipped' || undefined,
        trigger: compressionTrigger,
      });

      // Get message IDs from dbMessagesMap (raw db messages)
      const dbMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const requestedCandidates = new Set(
        budgetPayload.candidateIds ?? getCompressionCandidateMessageIds(dbMessages),
      );
      const messageIds = getCompressionCandidateMessageIds(dbMessages).filter((id) =>
        requestedCandidates.has(id),
      );

      if (!topicId || messageIds.length === 0) {
        // No topicId or no messages, skip compression
        log(
          `${stagePrefix} Skipping compression: topicId=%s, messageIds=%d`,
          topicId,
          messageIds.length,
        );
        return {
          events: [],
          newState: state,
          nextContext: {
            payload: resultPayload('skipped', messages),
            phase: 'compression_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Find the latest assistant message to attach the compression operation
      const latestAssistantMessage = dbMessages.findLast((m) => m.role === 'assistant');
      const assistantMessageId = latestAssistantMessage?.id;

      log(
        `${stagePrefix} Compressing %d db messages (display: %d), assistantMsgId=%s`,
        messageIds.length,
        messages.length,
        assistantMessageId,
      );

      // Create compress_context operation and attach to the assistant message
      const { operationId: compressOperationId } = context.get().startOperation({
        context: { ...getOperationContext(), messageId: assistantMessageId },
        metadata: {
          messageCount: messageIds.length,
          startTime: Date.now(),
        },
        parentOperationId: state.operationId,
        type: 'contextCompression',
      });

      const opContext = getOperationContext();
      const agentId = getEffectiveAgentId();
      let summaryOperationId: string | undefined;

      try {
        if (!agentId) throw new Error('SUMMARY_PERSISTENCE_REQUIRED');
        const compressionModel = state.modelRuntimeConfig?.compressionModel;
        if (!compressionModel?.model || !compressionModel.provider) {
          throw new Error('SUMMARY_MODEL_REQUIRED');
        }
        const summaryOperation = context.get().startOperation({
          context: { ...opContext, messageId: assistantMessageId },
          parentOperationId: compressOperationId,
          type: 'generateSummary',
        });
        summaryOperationId = summaryOperation.operationId;
        const transaction = await runClientContextCompressionTransaction({
          abortController: summaryOperation.abortController,
          candidateIds: messageIds,
          compressionModel,
          createGroup: () =>
            messageService.createCompressionGroup({
              agentId,
              groupId: opContext.groupId,
              messageIds,
              threadId: opContext.threadId,
              topicId,
            }),
          failGroup: (messageGroupId) =>
            messageService.failCompression({
              agentId,
              groupId: opContext.groupId,
              messageGroupId,
              threadId: opContext.threadId,
              topicId,
            }),
          finalizeGroup: (messageGroupId, summary) =>
            messageService.finalizeCompression({
              agentId,
              content: summary,
              groupId: opContext.groupId,
              messageGroupId,
              threadId: opContext.threadId,
              topicId,
            }),
          metadata: state.metadata,
          rollbackGroup: (messageGroupId) =>
            messageService.cancelCompression({
              agentId,
              groupId: opContext.groupId,
              messageGroupId,
              threadId: opContext.threadId,
              topicId,
            }),
          sourceMessages: messages,
          tools: state.tools,
          trigger: compressionTrigger,
        });
        if (transaction.kind === 'failed') {
          if (transaction.rollbackError) {
            log(`${stagePrefix} Compression rollback failed: %O`, transaction.rollbackError);
          }
          throw transaction.error ?? new Error('SUMMARY_FAILED');
        }
        context.get().completeOperation(summaryOperation.operationId);

        const compressedMessages = transaction.finalizedMessages;
        const groupId = transaction.groupId;
        // Use the latest assistant message ID (before compression) as parentMessageId for next call_llm
        const parentMessageId = assistantMessageId;

        // 6. Update UI with finalized messages (includes compressedGroup with summary)
        context.get().replaceMessages(compressedMessages, { context: opContext });

        log(
          `${stagePrefix} Compression complete. groupId=%s, parentMessageId=%s`,
          groupId,
          parentMessageId,
        );

        // Complete the compress_context operation
        context.get().completeOperation(compressOperationId, { groupId, parentMessageId });

        events.push({ type: 'compression_complete', groupId, parentMessageId });

        const compressedTokenCount = countContextTokens({
          messages: compressedMessages,
          providerMedia: collectClientProviderMediaTokenEstimates(compressedMessages),
          tools: state.tools,
        }).adjustedTotal;

        return {
          events,
          newState: {
            ...state,
            messages: compressedMessages,
            metadata: {
              ...state.metadata,
              contextBudget: {
                ...state.metadata?.contextBudget,
                attemptState: {
                  compressionAttempt: 1,
                  payloadFingerprint,
                  sentPayloadFingerprints: budgetPayload.sentPayloadFingerprints ?? [],
                },
                catalogSnapshot:
                  budgetPayload.catalogSnapshot ?? state.metadata?.modelCatalogSnapshot,
              },
            },
          },
          nextContext: {
            payload: {
              ...forwardedBudgetContext,
              afterTokens: compressedTokenCount,
              attempt: 1,
              beforeTokens: currentTokenCount,
              compressedMessages,
              groupId,
              outcome: 'compressed',
              parentMessageId,
              payloadFingerprint,
              trigger: compressionTrigger,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: compressedMessages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        if (
          summaryOperationId &&
          context.get().operations[summaryOperationId]?.status === 'running'
        ) {
          context.get().completeOperation(summaryOperationId, {
            error: {
              message: error instanceof Error ? error.message : String(error),
              type: 'summary_generation_failed',
            },
          });
        }

        if (isAbortError(error)) {
          log(`${stagePrefix} Compression cancelled`);

          if (context.get().operations[compressOperationId]?.status === 'running') {
            context.get().completeOperation(compressOperationId, { cancelled: true });
          }

          events.push({ type: 'compression_error', error });

          return {
            events,
            newState: state,
            nextContext: {
              payload: resultPayload('failed', messages, assistantMessageId),
              phase: 'compression_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        log(`${stagePrefix} Compression failed: %O`, error);

        // Complete the compress_context operation with error
        context.get().completeOperation(compressOperationId, {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: 'compression_failed',
          },
        });

        // On error, continue without compression
        events.push({ type: 'compression_error', error });

        return {
          events,
          newState: state,
          nextContext: {
            payload: resultPayload('failed', messages, assistantMessageId),
            phase: 'compression_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }
    },
  };

  return executors;
};
