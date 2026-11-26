import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { isDesktop, LOADING_FLAT } from '@lobechat/const';
import { isDeviceLocalMcpIdentifier } from '@lobechat/electron-client-ipc';
import type {
  ChatImageItem,
  ConversationContext,
  HeterogeneousProviderConfig,
  RuntimeSelectedTool,
  UIChatMessage,
} from '@lobechat/types';
import { t } from 'i18next';
import { type StateCreator } from 'zustand';

import { message as antdMessage } from '@/components/AntdStaticMethods';
import { MESSAGE_CANCEL_FLAT } from '@/const/index';
import { validateMessageImages } from '@/features/Attachments/validateMessageImages';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { selectConversationRuntime } from '@/store/chat/slices/aiChat/actions/agentDispatcher';
import {
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
} from '@/store/chat/slices/aiChat/actions/commandBus';
import { resolveHeteroResume } from '@/store/chat/slices/aiChat/actions/heteroResume';
import { routeDesktopWorkspaceRuntime } from '@/store/chat/slices/aiChat/actions/managedEnvRuntime';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import {
  mergeAgentRuntimeInitialContexts,
  resolveActiveTopicDocumentInitialContext,
} from '@/store/chat/utils/activeTopicDocumentContext';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getElectronStoreState } from '@/store/electron';
import { DesktopDeviceIdentityUnavailableError } from '@/store/electron/deviceIdentity';
import { getProjectWorkspaceStoreState } from '@/store/projectWorkspace';
import {
  checkDesktopProjectSend,
  ProjectDeviceMismatchError,
} from '@/store/projectWorkspace/topicExecutionIntent';

import { type Store as ConversationStore } from '../../action';

const buildRetryInitialContext = (editorData: Record<string, any> | null | undefined) => {
  const normalizedEditorData = editorData ?? undefined;
  const selectedSkills = parseSelectedSkillsFromEditorData(normalizedEditorData);
  const selectedTools = parseSelectedToolsFromEditorData(normalizedEditorData);
  const mentionedAgents = parseMentionedAgentsFromEditorData(normalizedEditorData);

  const effectiveSelectedTools =
    mentionedAgents.length > 0 &&
    !selectedTools.some((tool) => tool.identifier === AgentManagementIdentifier)
      ? [...selectedTools, { identifier: AgentManagementIdentifier, name: 'Agent Management' }]
      : selectedTools;

  const hasInitialContext =
    effectiveSelectedTools.length > 0 || selectedSkills.length > 0 || mentionedAgents.length > 0;

  if (!hasInitialContext) return undefined;

  return {
    initialContext: {
      ...(selectedSkills.length > 0 ? { selectedSkills } : undefined),
      ...(effectiveSelectedTools.length > 0
        ? { selectedTools: effectiveSelectedTools }
        : undefined),
      ...(mentionedAgents.length > 0 ? { mentionedAgents } : undefined),
    },
    phase: 'init' as const,
  };
};

const getFrozenTopicWorkspaceId = (
  context: ConversationContext,
  chatStore: ReturnType<typeof useChatStore.getState>,
): string | undefined => {
  const topicId = context.topicId ?? undefined;
  if (!topicId) return;
  const authoritativeWorkspaceId =
    getProjectWorkspaceStoreState().topicStatesById?.[topicId]?.snapshot?.workspaceId;
  if (authoritativeWorkspaceId) return authoritativeWorkspaceId;

  // The full chat store always owns topicDataMap; the guard also keeps this
  // read tolerant of lifecycle tests and transitional store hydration.
  if (!chatStore.topicDataMap) return;
  return topicSelectors.getTopicById(topicId)(chatStore)?.metadata?.executionSnapshot?.workspaceId;
};

const getGenerationRoute = (
  chatStore: ReturnType<typeof useChatStore.getState>,
  { groupId, topicId }: ConversationContext,
  selectedTools: RuntimeSelectedTool[] | undefined,
) => {
  const hasSelectedLocalMcp = selectedTools?.some(({ identifier }) =>
    isDeviceLocalMcpIdentifier(identifier),
  );
  const topicSnapshot =
    (groupId || hasSelectedLocalMcp) && topicId
      ? (getProjectWorkspaceStoreState().topicStatesById?.[topicId]?.snapshot ??
        (chatStore.topicDataMap
          ? topicSelectors.getTopicById(topicId)(chatStore)?.metadata?.executionSnapshot
          : undefined))
      : undefined;
  return { hasSelectedLocalMcp, topicSnapshot };
};

/**
 * Branch a hetero (Claude Code / Codex) turn off an existing user message.
 *
 * Used by regenerate (parent = user msg, prompt = original user content).
 * Pre-creates the assistant row so `executeHeterogeneousAgent` has a stable
 * `assistantMessageId` to stream into, then runs an `execHeterogeneousAgent`
 * op as a child of the caller's parent op so Stop cancels the executor
 * without killing the parent op early.
 */
const runHeterogeneousFromExistingMessage = async (
  chatStore: ReturnType<typeof useChatStore.getState>,
  params: {
    context: ConversationContext;
    heterogeneousProvider: HeterogeneousProviderConfig;
    /** Image attachments from the original user message — forwarded to the CLI for vision support */
    imageList?: ChatImageItem[];
    parentMessageId: string;
    parentOperationId: string;
    prompt: string;
  },
): Promise<string> => {
  const { context, heterogeneousProvider, imageList, parentMessageId, parentOperationId, prompt } =
    params;
  const agentId = context.agentId;
  if (!agentId) throw new Error('agentId is required for heterogeneous agent');

  // Resolve workingDirectory: topic-level pin (set when bound to a project)
  // wins over the agent-level default. Mirrors the sendMessage hetero branch
  // so regenerate stays on the same project as the original turn.
  const topic = context.topicId
    ? topicSelectors.getTopicById(context.topicId)(chatStore)
    : undefined;
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const agentWorkingDirectory = agentByIdSelectors.getAgentWorkingDirectoryById(
    agentId,
    currentDeviceId,
  )(getAgentStoreState());
  const workingDirectory = topic?.metadata?.workingDirectory || agentWorkingDirectory;

  // Drops the saved sessionId when its bound cwd disagrees with the current
  // one — without this CC emits "No conversation found with session ID".
  const { cwdChanged, resumeSessionId } = resolveHeteroResume(topic?.metadata, workingDirectory);
  if (cwdChanged) antdMessage.info(t('heteroAgent.resumeReset.cwdChanged', { ns: 'chat' }));

  const assistantMsg = await messageService.createMessage({
    agentId,
    content: LOADING_FLAT,
    parentId: parentMessageId,
    // External CLIs own model selection; persist only the runtime provider up
    // front. The adapter backfills the actual model later if the CLI reports it.
    provider: heterogeneousProvider.type,
    role: 'assistant',
    threadId: context.threadId ?? undefined,
    topicId: context.topicId ?? undefined,
  });

  // Pull the new row into the store so the loading bubble is visible while
  // the executor runs (the executor only dispatches updates, not creates).
  await chatStore.refreshMessages();

  if (context.topicId) chatStore.internal_updateTopicLoading(context.topicId, true);

  const { operationId: heteroOpId } = chatStore.startOperation({
    context,
    label: 'Heterogeneous Agent Execution',
    metadata: { heterogeneousType: heterogeneousProvider.type },
    parentOperationId,
    type: 'execHeterogeneousAgent',
  });
  chatStore.associateMessageWithOperation(assistantMsg.id, heteroOpId);

  try {
    const { executeHeterogeneousAgent } =
      await import('@/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor');
    await executeHeterogeneousAgent(() => useChatStore.getState(), {
      assistantMessageId: assistantMsg.id,
      context,
      heterogeneousProvider,
      imageList: imageList?.length ? imageList : undefined,
      message: prompt,
      operationId: heteroOpId,
      resumeSessionId,
      workingDirectory,
    });
  } finally {
    if (context.topicId)
      useChatStore.getState().internal_updateTopicLoading(context.topicId, false);
  }

  return assistantMsg.id;
};

/**
 * Generation Actions
 *
 * Handles generation control (stop, cancel, regenerate, continue)
 */
const checkRegenerationWorkspace = async (
  context: ConversationContext,
  chatStore: ReturnType<typeof useChatStore.getState>,
) => {
  if (!context.topicId) return true;
  try {
    await checkDesktopProjectSend({
      agentId: context.agentId,
      groupId: context.groupId,
      isNewTopic: false,
      topicId: context.topicId,
      topicMetadata: chatStore.topicDataMap
        ? topicSelectors.getTopicById(context.topicId)(chatStore)?.metadata
        : undefined,
    });
    return true;
  } catch (error) {
    if (error instanceof DesktopDeviceIdentityUnavailableError) {
      antdMessage.error(error.message);
    } else if (error instanceof ProjectDeviceMismatchError) {
      antdMessage.error(t('workspaceRuntime.otherDeviceProject', { ns: 'chat' }));
    } else {
      antdMessage.error(t('unknownError', { ns: 'common' }));
    }
    return false;
  }
};

const deleteReplacedMessage = async (
  chatStore: ReturnType<typeof useChatStore.getState>,
  context: ConversationContext,
  message: UIChatMessage,
  branchIndex: number,
) => {
  const { operationId } = chatStore.startOperation({
    context: { ...context, messageId: message.id },
    type: 'regenerate',
  });
  try {
    await chatStore.deleteMessage(message.id, { operationId }, message);
    if (message.role !== 'user' && message.parentId) {
      // Removing the old reply shifts the newest branch one place to the left.
      await chatStore.switchMessageBranch(message.parentId, Math.max(0, branchIndex - 1), {
        operationId,
      });
    }
    chatStore.completeOperation(operationId);
  } catch (error) {
    chatStore.failOperation(operationId, {
      message: error instanceof Error ? error.message : String(error),
      type: 'RegenerateError',
    });
    antdMessage.error(t('unknownError.title', { ns: 'error' }));
  }
};

export interface GenerationAction {
  /**
   * Cancel a specific operation
   */
  cancelOperation: (operationId: string, reason?: string) => void;

  /**
   * Clear all operations
   */
  clearOperations: () => void;

  /**
   * Clear translate for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearTranslate: (messageId: string) => Promise<void>;

  /**
   * Clear TTS for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearTTS: (messageId: string) => Promise<void>;

  /**
   * Continue generation from a message
   */
  continueGeneration: (displayMessageId: string) => Promise<void>;

  /**
   * Continue generation from a specific block
   */
  continueGenerationMessage: (displayMessageId: string, messageId: string) => Promise<void>;

  /**
   * Delete and regenerate a message
   */
  delAndRegenerateMessage: (messageId: string) => Promise<void>;

  /**
   * Delete and resend a thread message
   */
  delAndResendThreadMessage: (messageId: string) => Promise<void>;

  /**
   * Open thread creator
   * @deprecated Temporary bridge to ChatStore
   */
  openThreadCreator: (messageId: string) => void;

  /**
   * Regenerate an assistant message
   */
  regenerateAssistantMessage: (messageId: string) => Promise<void>;

  /**
   * Regenerate a user message
   */
  regenerateUserMessage: (messageId: string) => Promise<{ branchIndex: number } | void>;

  /**
   * Re-invoke a tool message
   * @deprecated Temporary bridge to ChatStore
   */
  reInvokeToolMessage: (messageId: string) => Promise<void>;

  /**
   * Resend a thread message
   */
  resendThreadMessage: (messageId: string) => Promise<void>;

  /**
   * Stop current generation
   */
  stopGenerating: () => void;

  /**
   * Translate a message
   * @deprecated Temporary bridge to ChatStore
   */
  translateMessage: (messageId: string, targetLang: string) => Promise<void>;

  /**
   * TTS a message
   * @deprecated Temporary bridge to ChatStore
   */
  ttsMessage: (
    messageId: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => Promise<void>;
}

export const generationSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  GenerationAction
> = (set, get) => ({
  cancelOperation: (operationId: string, reason?: string) => {
    const state = get();
    const { hooks } = state;

    const chatStore = useChatStore.getState();
    chatStore.cancelOperation(operationId, reason || 'User cancelled');

    // ===== Hook: onOperationCancelled =====
    if (hooks.onOperationCancelled) {
      hooks.onOperationCancelled(operationId);
    }
  },

  clearOperations: () => {
    // Operations are now managed by ChatStore, nothing to clear locally
  },

  clearTTS: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearTTS(messageId);
  },

  clearTranslate: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearTranslate(messageId);
  },

  continueGeneration: async (groupMessageId: string) => {
    const { displayMessages } = get();

    // Find the message
    const message = displayMessages.find((m) => m.id === groupMessageId);
    if (!message) return;

    // If it's an assistantGroup, find the last child's ID as blockId
    let lastBlockId: string | undefined;

    if (message.role !== 'assistantGroup') return;

    if (message.children && message.children.length > 0) {
      const lastChild = message.children.at(-1);

      if (lastChild) {
        lastBlockId = lastChild.id;
      }
    }

    if (!lastBlockId) return;

    await get().continueGenerationMessage(groupMessageId, lastBlockId);
  },

  continueGenerationMessage: async (displayMessageId: string, dbMessageId: string) => {
    const { context, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    // Find the message (blockId refers to the assistant message to continue from)
    const messageIndex = displayMessages.findIndex((m) => m.id === displayMessageId);
    const message = displayMessages[messageIndex];
    if (!message) return;

    // ===== Hook: onBeforeContinue =====
    if (hooks.onBeforeContinue) {
      const shouldProceed = await hooks.onBeforeContinue(displayMessageId);
      if (shouldProceed === false) return;
    }

    const agentConfig = agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState());
    const topicId = context.topicId ?? undefined;
    const previousUserMessage = displayMessages
      .slice(0, messageIndex + 1)
      .findLast((item) => item.role === 'user');
    const { hasSelectedLocalMcp, topicSnapshot } = getGenerationRoute(
      chatStore,
      context,
      parseSelectedToolsFromEditorData(previousUserMessage?.editorData ?? undefined),
    );
    const executionTarget = topicSnapshot?.target ?? agentConfig?.agencyConfig?.executionTarget;
    let runtimeType;
    try {
      runtimeType = await routeDesktopWorkspaceRuntime(
        await selectConversationRuntime({
          boundDeviceId:
            topicSnapshot?.boundDeviceId ??
            (isDesktop && context.groupId && executionTarget === 'local'
              ? undefined
              : agentConfig?.agencyConfig?.boundDeviceId),
          executionTarget,
          groupId: context.groupId,
          hasSelectedLocalMcp,
          heterogeneousProvider: agentConfig?.agencyConfig?.heterogeneousProvider,
          isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
        }),
        {
          topicId,
          workspaceId: getFrozenTopicWorkspaceId(context, chatStore),
        },
      );
    } catch (error) {
      if (!(error instanceof DesktopDeviceIdentityUnavailableError)) throw error;
      antdMessage.error(error.message);
      return;
    }

    // Hetero CLIs (CC / Codex) have no "continue a cut-off response" primitive
    // — each prompt is a fresh user turn from their perspective. Bail out
    // rather than synthesize a fake "please continue" turn that would pollute
    // the session and confuse the model. The button is a no-op in this mode.
    if (runtimeType === 'hetero') return;

    // Create continue operation with ConversationStore context (includes groupId)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId: displayMessageId },
      type: 'continue',
    });

    try {
      // ── Gateway mode: branch a server-side run from the cut-off message ──
      // `parentMessageId` triggers `resume: true` on the router, so the server
      // skips user-message creation and continues from the existing chain.
      // Empty prompt is intentional and matches the approve/reject resume path.
      if (runtimeType === 'gateway') {
        await chatStore.executeGatewayAgent({
          context,
          message: '',
          onComplete: () => {
            chatStore.completeOperation(operationId);
            if (hooks.onContinueComplete) hooks.onContinueComplete(displayMessageId);
          },
          parentMessageId: dbMessageId,
        });
        return;
      }

      // ── Client mode: run agent locally ──
      await chatStore.executeClientAgent({
        context,
        messages: displayMessages,
        parentMessageId: dbMessageId,
        parentMessageType: message.role as 'assistant' | 'tool' | 'user',
        parentOperationId: operationId,
      });

      chatStore.completeOperation(operationId);

      // ===== Hook: onContinueComplete =====
      if (hooks.onContinueComplete) {
        hooks.onContinueComplete(displayMessageId);
      }
    } catch (error) {
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'ContinueError',
      });
      throw error;
    }
  },

  delAndRegenerateMessage: async (messageId: string) => {
    const { context, displayMessages } = get();
    // Capture the original branch before retrying, since the replacement may hide it.
    const original = displayMessages.find((message) => message.id === messageId);
    if (!original?.parentId) return;
    const replacement = await get().regenerateUserMessage(original.parentId);
    if (!replacement) return;

    await deleteReplacedMessage(
      useChatStore.getState(),
      context,
      original,
      replacement.branchIndex,
    );
  },

  delAndResendThreadMessage: async (messageId: string) => {
    const { context, displayMessages } = get();
    const current = displayMessages.find((item) => item.id === messageId);
    const userMessage =
      current?.role === 'user'
        ? current
        : displayMessages.find((item) => item.id === current?.parentId);
    if (!current || !userMessage) return;
    const replacement = await get().regenerateUserMessage(userMessage.id);
    if (!replacement || current.role === 'user') return;
    await deleteReplacedMessage(useChatStore.getState(), context, current, replacement.branchIndex);
  },

  openThreadCreator: (messageId: string) => {
    const chatStore = useChatStore.getState();
    chatStore.openThreadCreator(messageId);
  },

  reInvokeToolMessage: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.reInvokeToolMessage(messageId);
  },

  regenerateAssistantMessage: async (messageId: string) => {
    const { displayMessages } = get();

    // Find the assistant message
    const currentIndex = displayMessages.findIndex((c) => c.id === messageId);
    const currentMessage = displayMessages[currentIndex];

    if (!currentMessage) return;

    // Find the parent user message
    const userId = currentMessage.parentId;
    if (!userId) return;

    // Delegate to regenerateUserMessage with the parent user message
    await get().regenerateUserMessage(userId);
  },

  regenerateUserMessage: async (messageId: string) => {
    const { context, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    // Check if already regenerating via operation system
    const isRegenerating = operationSelectors.isMessageProcessing(messageId)(chatStore);
    if (isRegenerating) return;

    // Find the message in current conversation messages
    const currentIndex = displayMessages.findIndex((c) => c.id === messageId);
    const item = displayMessages[currentIndex];
    if (!item || !validateMessageImages(item)) return;

    if (!(await checkRegenerationWorkspace(context, chatStore))) return;

    const initialContext = mergeAgentRuntimeInitialContexts(
      await resolveActiveTopicDocumentInitialContext(context),
      buildRetryInitialContext(item.editorData),
    );

    // Get context messages up to and including the target message
    const contextMessages = displayMessages.slice(0, currentIndex + 1);
    if (contextMessages.length <= 0) return;

    // ===== Hook: onBeforeRegenerate =====
    if (hooks.onBeforeRegenerate) {
      const shouldProceed = await hooks.onBeforeRegenerate(messageId);
      if (shouldProceed === false) return;
    }

    // Create regenerate operation with context
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });
    let restorePreviousBranch: (() => Promise<void>) | undefined;

    try {
      const agentConfig = agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState());
      const heterogeneousProvider = agentConfig?.agencyConfig?.heterogeneousProvider;
      const topicId = context.topicId ?? undefined;
      const { hasSelectedLocalMcp, topicSnapshot } = getGenerationRoute(
        chatStore,
        context,
        initialContext?.initialContext?.selectedTools,
      );
      const executionTarget = topicSnapshot?.target ?? agentConfig?.agencyConfig?.executionTarget;
      const runtimeType = await routeDesktopWorkspaceRuntime(
        await selectConversationRuntime({
          boundDeviceId:
            topicSnapshot?.boundDeviceId ??
            (isDesktop && context.groupId && executionTarget === 'local'
              ? undefined
              : agentConfig?.agencyConfig?.boundDeviceId),
          executionTarget,
          groupId: context.groupId,
          hasSelectedLocalMcp,
          heterogeneousProvider,
          isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
        }),
        {
          topicId,
          workspaceId: getFrozenTopicWorkspaceId(context, chatStore),
        },
      );

      // Calculate next branch index by counting children of this user message
      // We need to count how many assistant messages have this user message as parent
      const { dbMessages } = get();
      const branches = dbMessages.filter((m) => m.parentId === messageId && m.role !== 'tool');
      // New branch index = current children count (since index is 0-based)
      const nextBranchIndex = branches.length;
      if (branches.length) {
        const visibleReply = displayMessages[currentIndex + 1];
        const visibleBranchIndex = branches.findIndex(({ id }) => id === visibleReply?.id);
        const previousBranchIndex =
          item.metadata?.activeBranchIndex ??
          visibleReply?.branch?.activeBranchIndex ??
          (visibleBranchIndex >= 0
            ? visibleBranchIndex
            : Math.max(
                0,
                branches.findIndex(({ id }) =>
                  dbMessages.some((message) => message.parentId === id),
                ),
              ));
        restorePreviousBranch = async () => {
          const currentMessages = useChatStore.getState().dbMessagesMap[messageMapKey(context)];
          const selectedBranch = currentMessages?.find(({ id }) => id === messageId)?.metadata
            ?.activeBranchIndex;
          if (selectedBranch !== undefined && selectedBranch !== nextBranchIndex) return;
          await chatStore.switchMessageBranch(messageId, previousBranchIndex, { operationId });
        };
      }

      // Switch to the new branch so the UI shows the incoming response immediately
      await chatStore.switchMessageBranch(messageId, nextBranchIndex, {
        operationId,
      });

      // ── Gateway mode: trigger server-side regeneration ──
      if (runtimeType === 'gateway') {
        // Keep the regenerate operation running until the gateway session completes,
        // so isMessageRegenerating stays true and duplicate clicks are blocked.
        const result = await chatStore.executeGatewayAgent({
          context,
          message: item.content,
          onComplete: () => {
            chatStore.completeOperation(operationId);
            if (hooks.onRegenerateComplete) {
              hooks.onRegenerateComplete(messageId);
            }
          },
          parentMessageId: messageId,
        });

        if (!result.success) {
          const restore = restorePreviousBranch;
          restorePreviousBranch = undefined;
          await restore?.();
          chatStore.failOperation(operationId, {
            message: result.error || result.message,
            type: 'RegenerateError',
          });
          return;
        }
        return { branchIndex: nextBranchIndex };
      }

      // ── Hetero mode: re-run the local CLI against the original user prompt ──
      // Creates a fresh assistant row branched off the existing user message so
      // the CC / Codex turn replaces the previous attempt without rewriting
      // history, and resumes the same session id (when the cwd still matches)
      // so prior context is preserved.
      if (runtimeType === 'hetero' && heterogeneousProvider) {
        await runHeterogeneousFromExistingMessage(chatStore, {
          context,
          heterogeneousProvider,
          // Forward the original user message's images so regenerate re-runs
          // the CLI with the same vision input as the first attempt. Without
          // this, regenerate silently drops attachments (the send path reads
          // imageList off the persisted user message; this path must too).
          imageList: item.imageList,
          parentMessageId: messageId,
          parentOperationId: operationId,
          prompt: item.content,
        });
        chatStore.completeOperation(operationId);
        if (hooks.onRegenerateComplete) hooks.onRegenerateComplete(messageId);
        return { branchIndex: nextBranchIndex };
      }

      // ── Client mode: run agent locally ──
      // Execute agent runtime with full context from ConversationStore
      const result = await chatStore.executeClientAgent({
        context,
        initialContext,
        messages: contextMessages,
        parentMessageId: messageId,
        parentMessageType: 'user',
        parentOperationId: operationId,
      });

      const replaceable = result?.status === 'done' || result?.status === 'waiting_for_human';
      if (!replaceable) {
        const restore = restorePreviousBranch;
        restorePreviousBranch = undefined;
        await restore?.();
      }
      chatStore.completeOperation(operationId);

      // ===== Hook: onRegenerateComplete =====
      if (hooks.onRegenerateComplete) {
        hooks.onRegenerateComplete(messageId);
      }
      if (replaceable) return { branchIndex: nextBranchIndex };
    } catch (error) {
      await restorePreviousBranch?.().catch(() => {});
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'RegenerateError',
      });
      if (error instanceof DesktopDeviceIdentityUnavailableError) {
        antdMessage.error(error.message);
        return;
      }
      throw error;
    }
  },

  resendThreadMessage: async (messageId: string) => {
    // Resend is essentially regenerating the user message in thread context
    const { displayMessages } = get();
    const current = displayMessages.find((item) => item.id === messageId);
    const source =
      current?.role === 'user'
        ? current
        : displayMessages.find((item) => item.id === current?.parentId);
    if (source) await get().regenerateUserMessage(source.id);
  },

  stopGenerating: () => {
    const state = get();
    const { context, hooks } = state;
    const { agentId, topicId } = context;

    const chatStore = useChatStore.getState();

    // Cancel all running operations in this conversation context
    // Includes sendMessage, AI runtime (client-side and server-side), and agent mode stream
    chatStore.cancelOperations(
      { agentId, status: 'running', topicId, type: INPUT_LOADING_OPERATION_TYPES },
      MESSAGE_CANCEL_FLAT,
    );

    // Restore editor content if a sendMessage operation was cancelled
    chatStore.cancelSendMessageInServer(topicId ?? undefined);

    // ===== Hook: onGenerationStop =====
    if (hooks.onGenerationStop) {
      hooks.onGenerationStop();
    }
  },

  translateMessage: async (messageId: string, targetLang: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.translateMessage(messageId, targetLang);
  },

  ttsMessage: async (
    messageId: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => {
    const chatStore = useChatStore.getState();
    await chatStore.ttsMessage(messageId, state);
  },
});
