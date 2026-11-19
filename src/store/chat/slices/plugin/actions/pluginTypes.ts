import { isDeviceLocalMcpToolIdentifier } from '@lobechat/electron-client-ipc';
import {
  type BuiltinToolResult,
  type ChatToolPayload,
  type RuntimeStepContext,
  type SubAgentCallbacks,
} from '@lobechat/types';
import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import debug from 'debug';

import { type MCPToolCallResult } from '@/libs/mcp';
import { lambdaClient } from '@/libs/trpc/client';
import { mcpService } from '@/services/mcp';
import { messageService } from '@/services/message';
import { archiveToolResultViaServer } from '@/services/toolResultArchive';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation';
import { type ChatStore } from '@/store/chat/store';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';
import { useToolStore } from '@/store/tool';
import { composioStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { hasExecutor } from '@/store/tool/slices/builtin/executors';
import { type StoreSetter } from '@/store/types';
import { safeParseJSON } from '@/utils/safeParseJSON';

import { dbMessageSelectors } from '../../message/selectors';
import { type RemoteToolExecutor } from './exector';
import { composioExecutor, lobehubSkillExecutor } from './exector';

const log = debug('lobe-store:plugin-types');

type ToolResultProjection = 'builtin' | 'external';

const failedToolResult = (message: string, type: string): BuiltinToolResult => ({
  content: message,
  error: { message, type },
  success: false,
});

const normalizeExternalToolResult = (
  result: MCPToolCallResult | undefined,
  fallbackErrorType: string,
): BuiltinToolResult => {
  if (!result) return failedToolResult('Tool returned no result', fallbackErrorType);

  if (result.success) {
    return {
      content: result.content,
      state: result.state,
      success: true,
    };
  }

  const rawError = result.error;
  const message =
    typeof rawError === 'string'
      ? rawError
      : rawError?.message || result.content || 'Tool execution failed';

  return {
    content: result.content || message,
    error: {
      ...(rawError && typeof rawError === 'object' ? rawError : undefined),
      message,
      type: rawError?.type || fallbackErrorType,
    },
    state: result.state,
    success: false,
  };
};

/**
 * Plugin type-specific implementations
 * Each method handles a specific type of plugin invocation
 */

type Setter = StoreSetter<ChatStore>;
export const pluginTypes = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginTypesActionImpl(set, get, _api);

export class PluginTypesActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  invokeBuiltinTool = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ): Promise<any> => {
    const effectiveSource = this.#resolveEffectiveSource(payload);
    if (effectiveSource === 'composio') {
      return this.#get().invokeComposioTypePlugin(id, { ...payload, source: effectiveSource });
    }
    if (effectiveSource === 'lobehubSkill') {
      return this.#get().invokeLobehubSkillTypePlugin(id, { ...payload, source: effectiveSource });
    }

    const result = await this.#get().internal_executeBuiltinTool(
      id,
      payload.source ? payload : { ...payload, source: 'builtin' },
      stepContext,
    );
    await this.#persistToolResult(id, payload, result, 'builtin');
    return result;
  };

  internal_executeBuiltinTool = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
    signal?: AbortSignal,
  ): Promise<BuiltinToolResult> => {
    // When the tool call comes from a DB-stored message (e.g. after humanIntervention approval),
    // the `source` field is not persisted and arrives as undefined. Fall back to a live store
    // lookup so Composio / LobeHub Skill tools still route correctly.
    const effectiveSource = this.#resolveEffectiveSource(payload);

    if (effectiveSource === 'composio') {
      return await this.#get().internal_executeRemoteToolPlugin(
        id,
        { ...payload, source: effectiveSource },
        composioExecutor,
        'invokeComposioTypePlugin',
        signal,
      );
    }

    if (effectiveSource === 'lobehubSkill') {
      return await this.#get().internal_executeRemoteToolPlugin(
        id,
        { ...payload, source: effectiveSource },
        lobehubSkillExecutor,
        'invokeLobehubSkillTypePlugin',
        signal,
      );
    }

    const params = safeParseJSON(payload.arguments);
    if (!params) return failedToolResult('Invalid arguments', 'InvalidToolArguments');

    // Check if there's a registered executor in Tool Store (new architecture)
    if (hasExecutor(payload.identifier, payload.apiName)) {
      const { registerAfterCompletionCallback } = this.#get();

      // Get operation context
      const operationId = this.#get().messageOperationMap[id];
      const operation = operationId ? this.#get().operations[operationId] : undefined;
      let rootRuntimeOperationId: string | undefined;
      let rootRuntimeOperation = operation;
      let rootRuntimeOperationContext = operation?.context;
      if (operationId) {
        let currentOp = operation;
        while (currentOp) {
          if (AI_RUNTIME_OPERATION_TYPES.includes(currentOp.type)) {
            rootRuntimeOperationId = currentOp.id;
            rootRuntimeOperation = currentOp;
            rootRuntimeOperationContext = currentOp.context;
            break;
          }
          // Move up to parent operation
          const parentId = currentOp.parentOperationId;
          currentOp = parentId ? this.#get().operations[parentId] : undefined;
        }
      }

      // Get agent ID, group ID, topic ID, and page scope from operation context.
      // Prefer the concrete tool operation; fall back to the runtime root for
      // legacy operations created before child context inheritance was complete.
      let agentId = operation?.context?.agentId ?? rootRuntimeOperationContext?.agentId;
      let groupId = operation?.context?.groupId ?? rootRuntimeOperationContext?.groupId;
      const documentId = operation?.context?.documentId ?? rootRuntimeOperationContext?.documentId;
      const scope = operation?.context?.scope ?? rootRuntimeOperationContext?.scope;
      const viewedTask = operation?.context?.viewedTask ?? rootRuntimeOperationContext?.viewedTask;
      const taskId = viewedTask?.type === 'detail' ? viewedTask.taskId : undefined;
      const topicId = operation?.context?.topicId ?? rootRuntimeOperationContext?.topicId;
      const executionContext: ExecutionContext | undefined =
        rootRuntimeOperation?.metadata?.executionContext;
      const operationSkills = rootRuntimeOperation?.metadata?.operationSkills;
      const isSubAgent =
        operation?.context?.isSubAgent ?? rootRuntimeOperationContext?.isSubAgent ?? false;

      // For agent-builder tools, inject activeAgentId from store if not in context
      // This is needed because AgentBuilderProvider uses a separate scope for messages
      // but the tools need the correct agentId for execution
      if (payload.identifier === 'lobe-agent-builder') {
        const activeAgentId = this.#get().activeAgentId;
        if (activeAgentId) {
          agentId = activeAgentId;
        }
      }

      // For group-agent-builder tools, inject activeGroupId from store if not in context
      // This is needed because AgentBuilderProvider uses a separate scope for messages
      // but still needs groupId for tool execution
      if (!groupId && payload.identifier === 'lobe-group-agent-builder') {
        const { getChatGroupStoreState } = await import('@/store/agentGroup');
        groupId = getChatGroupStoreState().activeGroupId;
      }

      // Get group orchestration callbacks if available (for group management tools)
      const groupOrchestration = this.#get().getGroupOrchestrationCallbacks?.();

      // Sub-agent runner injected for sub-agent-spawning tools (lobe-agent.callSubAgent).
      // Runs the sub-agent in an isolated thread using the current client runtime
      // and resolves with its output, so the tool returns a normal tool result.
      const subAgentParentOperationId = rootRuntimeOperationId ?? operationId;
      const subAgent: SubAgentCallbacks = {
        run: (runParams) => {
          if (!agentId || !topicId) {
            return Promise.resolve({
              error: 'No agent context available for sub-agent execution',
              result: 'No agent context available for sub-agent execution',
              success: false,
              threadId: '',
            });
          }
          return this.#get().runClientSubAgent({
            ...runParams,
            agentId,
            parentOperationId: subAgentParentOperationId,
            topicId,
          });
        },
      };

      // Create registerAfterCompletion function that registers callback to root runtime operation
      const registerAfterCompletion = rootRuntimeOperationId
        ? (callback: Parameters<typeof registerAfterCompletionCallback>[1]) => {
            registerAfterCompletionCallback(rootRuntimeOperationId!, callback);
          }
        : undefined;

      log(
        '[invokeBuiltinTool] Using Tool Store executor: %s/%s, messageId=%s, agentId=%s, groupId=%s, hasGroupOrchestration=%s, rootRuntimeOp=%s, stepContext=%O',
        payload.identifier,
        payload.apiName,
        id,
        agentId,
        groupId,
        !!groupOrchestration,
        rootRuntimeOperationId,
        !!stepContext,
      );

      // Call Tool Store's invokeBuiltinTool
      log('[BuiltinToolCall] invoke:start', {
        agentId,
        apiName: payload.apiName,
        documentId,
        identifier: payload.identifier,
        messageId: id,
        operationId,
        rootRuntimeOperationId,
        isSubAgent,
        scope,
        taskId,
        topicId,
      });

      const result = await useToolStore
        .getState()
        .invokeBuiltinTool(payload.identifier, payload.apiName, params, {
          agentId,
          documentId,
          executionContext,
          groupId,
          groupOrchestration,
          isSubAgent,
          messageId: id,
          operationId,
          operationSkills,
          registerAfterCompletion,
          scope,
          signal: signal ?? operation?.abortController?.signal,
          sourceMessageId:
            operation?.context?.sourceMessageId ??
            rootRuntimeOperationContext?.sourceMessageId ??
            rootRuntimeOperationContext?.messageId,
          stepContext,
          subAgent,
          taskId,
          toolCallId: payload.id,
          topicId,
          workingDirectory: executionContext?.cwd,
        });

      // IPC tools may finish after the renderer has stopped the operation.
      // Never publish their late workspace binding (or result) into a cancelled run.
      signal?.throwIfAborted();
      operation?.abortController?.signal.throwIfAborted();
      rootRuntimeOperation?.abortController?.signal.throwIfAborted();

      if (
        result.success &&
        result.state?.localScratch &&
        executionContext?.plan.kind === 'device' &&
        executionContext.plan.target === 'local' &&
        topicId &&
        payload.id &&
        rootRuntimeOperationId
      ) {
        try {
          const bound = await lambdaClient.projectWorkspace.finalizeLocalScratch.mutate({
            deviceId: executionContext.plan.deviceId,
            operationId: executionContext.operationId ?? operationId!,
            toolCallId: payload.id,
            topicId,
          });
          const next = {
            ...executionContext,
            cwd: bound.workspace.rootPath,
            workspace: bound.workspace,
            snapshot: bound.snapshot,
            unresolvedReason: undefined,
            accessRoots: [
              ...(executionContext.accessRoots ?? []).filter((root) => root.scope !== 'primary'),
              {
                deviceId: bound.workspace.deviceId,
                rootPath: bound.workspace.rootPath,
                modes: ['read' as const, 'write' as const, 'exec' as const],
                scope: 'primary' as const,
                source: 'workspace' as const,
              },
            ],
          };
          this.#get().updateOperationMetadata(rootRuntimeOperationId, { executionContext: next });
          useProjectWorkspaceStore.setState((current) => ({
            topicStatesById: { ...current.topicStatesById, [topicId]: bound },
          }));
        } catch (error) {
          // The local command has already succeeded. Preserve that result so a
          // transient binding failure cannot cause the model to repeat its side effects.
          // The next cwd-dependent call will reuse the same per-topic scratch root
          // and retry persistence with fresh main-process execution evidence.
          log('Local scratch finalization is pending: %O', error);
          result.content = `${result.content ?? ''}\n\nThe tool completed successfully. Workspace synchronization is pending because the server could not confirm the local execution. Do not repeat this command solely to synchronize the workspace; reconnect the device before continuing.`;
          result.state = { ...result.state, workspaceSynchronizationPending: true };
        }
      }

      log('[BuiltinToolCall] invoke:end', {
        apiName: payload.apiName,
        errorType: result.error?.type,
        identifier: payload.identifier,
        messageId: id,
        operationId,
        success: result.success,
      });

      // If result.stop is true, the tool wants to stop execution flow
      // This is handled by returning from the function (no further processing)
      if (result.stop) {
        log('[invokeBuiltinTool] Executor returned stop=true, stopping execution');
      }

      // Return the result for call_tool executor to use
      return result;
    }

    // All builtin tools should be handled by the executor registry above
    // If we reach here, it means the tool is not registered
    console.error(
      `[invokeBuiltinTool] No executor found for: ${payload.identifier}/${payload.apiName}`,
    );
    return failedToolResult(
      `Tool ${payload.identifier}/${payload.apiName} is not available`,
      'ToolNotFound',
    );
  };

  invokeComposioTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    return this.#get().internal_invokeRemoteToolPlugin(
      id,
      payload,
      composioExecutor,
      'invokeComposioTypePlugin',
    );
  };

  invokeLobehubSkillTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    return this.#get().internal_invokeRemoteToolPlugin(
      id,
      payload,
      lobehubSkillExecutor,
      'invokeLobehubSkillTypePlugin',
    );
  };

  invokeMCPTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    let result: BuiltinToolResult;
    try {
      result = await this.#get().internal_executeMCPTypePlugin(id, payload);
    } catch (error) {
      console.error(error);
      const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
      const executionError = error as Error;
      if (executionError.message.includes('The user aborted a request.')) {
        log('[invokeMCPTypePlugin] Request aborted: messageId=%s, tool=%s', id, payload.apiName);
      } else {
        const updateResult = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (updateResult?.success && updateResult.messages) {
          this.#get().replaceMessages(updateResult.messages, {
            context: { agentId: message?.agentId || '', topicId: message?.topicId },
          });
        }
      }
      return;
    }
    return this.#persistToolResult(id, payload, result, 'external');
  };

  internal_executeMCPTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
    signal?: AbortSignal,
  ): Promise<BuiltinToolResult> => {
    // Get message to extract agentId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[invokeMCPTypePlugin] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    let executionContext: ExecutionContext | undefined;
    if (isDeviceLocalMcpToolIdentifier(payload.identifier)) {
      let current = operation;
      while (current && !executionContext) {
        executionContext = current.metadata.executionContext;
        current = current.parentOperationId
          ? this.#get().operations[current.parentOperationId]
          : undefined;
      }
    }

    const result = await mcpService.invokeMcpToolCall(payload, {
      ...(executionContext && { executionContext }),
      signal: signal ?? abortController?.signal,
      topicId: message?.topicId,
    });

    return normalizeExternalToolResult(result, 'MCPToolExecutionError');
  };

  internal_invokeRemoteToolPlugin = async (
    id: string,
    payload: ChatToolPayload,
    executor: RemoteToolExecutor,
    logPrefix: string,
  ): Promise<string | undefined> => {
    let result: BuiltinToolResult;
    try {
      result = await this.#get().internal_executeRemoteToolPlugin(id, payload, executor, logPrefix);
    } catch (error) {
      console.error(`[${logPrefix}] Error:`, error);
      const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
      const executionError = error as Error;
      if (executionError.message.includes('aborted')) {
        log('[%s] Request aborted: messageId=%s, tool=%s', logPrefix, id, payload.apiName);
      } else {
        const updateResult = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (updateResult?.success && updateResult.messages) {
          this.#get().replaceMessages(updateResult.messages, {
            context: { agentId: message?.agentId, topicId: message?.topicId },
          });
        }
      }
      return;
    }
    return this.#persistToolResult(id, payload, result, 'external');
  };

  internal_executeRemoteToolPlugin = async (
    id: string,
    payload: ChatToolPayload,
    executor: RemoteToolExecutor,
    logPrefix: string,
    signal?: AbortSignal,
  ): Promise<BuiltinToolResult> => {
    // Get message to extract sessionId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[%s] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      logPrefix,
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    // Pass topicId from message context, not global active state. This ensures tool calls use the
    // correct topic even if the user switches topics while the request is in flight.
    const result = await executor(payload, {
      signal: signal ?? abortController?.signal,
      topicId: message?.topicId,
    });

    return normalizeExternalToolResult(result, 'RemoteToolExecutionError');
  };

  #resolveEffectiveSource = (payload: ChatToolPayload): ChatToolPayload['source'] => {
    if (payload.source) return payload.source;

    const toolStoreState = useToolStore.getState();
    const composioTools = composioStoreSelectors.composioAsLobeTools(toolStoreState);
    if (composioTools.some((tool) => tool.identifier === payload.identifier)) return 'composio';

    const lobehubSkillTools = lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(toolStoreState);
    if (lobehubSkillTools.some((tool) => tool.identifier === payload.identifier)) {
      return 'lobehubSkill';
    }

    return undefined;
  };

  #persistToolResult = async (
    id: string,
    payload: ChatToolPayload,
    result: BuiltinToolResult,
    projection: ToolResultProjection,
  ): Promise<string> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;

    let rootOperationContext = operation?.context;
    let currentOperation = operation;
    while (currentOperation) {
      if (AI_RUNTIME_OPERATION_TYPES.includes(currentOperation.type)) {
        rootOperationContext = currentOperation.context;
        break;
      }
      currentOperation = currentOperation.parentOperationId
        ? this.#get().operations[currentOperation.parentOperationId]
        : undefined;
    }

    const agentId =
      operation?.context?.agentId ?? rootOperationContext?.agentId ?? message?.agentId;
    const topicId =
      operation?.context?.topicId ?? rootOperationContext?.topicId ?? message?.topicId;
    const rawContent = result.content || result.error?.message || '';
    const content = await archiveToolResultViaServer({
      agentId,
      content: rawContent,
      identifier: payload.identifier,
      toolCallId: payload.id,
      topicId,
    });
    const context = operationId ? { operationId } : undefined;

    if (projection === 'builtin') {
      await this.#get().optimisticUpdateToolMessage(
        id,
        {
          content,
          metadata: result.metadata,
          pluginError: result.error
            ? {
                body: result.error.body,
                message: result.error.message,
                type: result.error.type as any,
              }
            : undefined,
          pluginState: result.state,
        },
        context,
      );
      return content;
    }

    let pluginError = result.error;
    if (
      pluginError?.type === 'MCPToolExecutionError' ||
      pluginError?.type === 'RemoteToolExecutionError'
    ) {
      const { type: _, ...legacyError } = pluginError;
      pluginError = legacyError as BuiltinToolResult['error'];
    }

    await this.#get().optimisticUpdateToolMessage(
      id,
      {
        content,
        pluginError: result.success ? undefined : pluginError,
        pluginState: result.success ? result.state : undefined,
      },
      context,
    );

    return content;
  };
}

export type PluginTypesAction = Pick<PluginTypesActionImpl, keyof PluginTypesActionImpl>;
