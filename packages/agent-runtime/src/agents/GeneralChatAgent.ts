import {
  type ChatToolPayload,
  type ExtendedHumanInterventionConfig,
  type HumanInterventionConfig,
  type HumanInterventionPolicy,
} from '@lobechat/types';
import type {
  ContextBudgetDecision,
  ContextBudgetTrigger,
  ContextCompressionOutcome,
} from '@lobechat/types/src/contextBudget';

import { createDefaultGlobalAudits, DEFAULT_SECURITY_BLACKLIST } from '../audit';
import { InterventionChecker } from '../core';
import {
  type Agent,
  type AgentInstruction,
  type AgentRuntimeContext,
  type AgentState,
  type GeneralAgentCallingToolInstructionPayload,
  type GeneralAgentCallLLMInstructionPayload,
  type GeneralAgentCallLLMResultPayload,
  type GeneralAgentCallToolResultPayload,
  type GeneralAgentCallToolsBatchInstructionPayload,
  type GeneralAgentConfig,
  type HumanAbortPayload,
  type SubAgentResultPayload,
  type SubAgentsBatchResultPayload,
} from '../types';
import {
  type BudgetedCompressionResultPayload,
  createCompressionInstruction,
  createContextBudgetFailure,
  evaluateContextBudget,
  failureAfterCompression,
  getRuntimeContextBudgetInput,
  parseExceededContextWindowError,
  type RuntimeContextBudgetInput,
} from '../utils/contextBudget';

/**
 * ChatAgent - The "Brain" of the chat agent
 *
 * This agent implements a simple but powerful decision loop:
 * 1. user_input → call_llm (with optional RAG/Search preprocessing)
 * 2. llm_result → check for tool_calls and intervention requirements
 *    - Tools not requiring intervention → call_tools_batch (execute immediately)
 *    - Tools requiring intervention → request_human_approve (wait for approval)
 *    - Mixed (both types) → [call_tools_batch, request_human_approve] (execute safe ones first, then request approval)
 *    - No tool_calls → finish
 * 3. tools_batch_result → call_llm (process tool results)
 *
 */
export class GeneralChatAgent implements Agent {
  private config: GeneralAgentConfig;

  constructor(config: GeneralAgentConfig) {
    this.config = config;
  }

  /**
   * Get intervention configuration for a specific tool call
   */
  private getToolInterventionConfig(
    toolCalling: ChatToolPayload,
    state: AgentState,
  ): ExtendedHumanInterventionConfig | undefined {
    const { identifier, apiName } = toolCalling;
    const manifest = state.toolManifestMap[identifier];

    if (!manifest) return undefined;

    // Find the specific API in the manifest
    const api = manifest.api?.find((a: any) => a.name === apiName);

    // API-level config takes precedence over tool-level config
    return api?.humanIntervention ?? manifest.humanIntervention;
  }

  private isDynamicInterventionConfig(
    config: ExtendedHumanInterventionConfig | undefined,
  ): config is {
    dynamic: { default?: HumanInterventionPolicy; policy?: HumanInterventionPolicy; type: string };
  } {
    return !!config && typeof config === 'object' && !Array.isArray(config) && 'dynamic' in config;
  }

  private matchesAlwaysPolicy(
    config: HumanInterventionConfig | undefined,
    toolArgs: Record<string, any>,
  ): boolean {
    if (!config) return false;
    if (config === 'always') return true;
    if (!Array.isArray(config)) return false;

    return config.some((rule) => {
      if (rule.policy !== 'always') return false;
      if (!rule.match) return true;

      return Object.entries(rule.match).every(([paramName, matcher]) => {
        const paramValue = toolArgs[paramName];
        if (paramValue === undefined) return false;

        if (typeof matcher === 'string') {
          return String(paramValue).includes(matcher) || matcher.includes('*');
        }

        return true;
      });
    });
  }

  private resolveDynamicPolicy(
    config: ExtendedHumanInterventionConfig | undefined,
    toolArgs: Record<string, any>,
    metadata?: Record<string, any>,
  ): Promise<HumanInterventionPolicy | undefined> {
    if (!this.isDynamicInterventionConfig(config)) {
      return Promise.resolve(undefined);
    }

    const { dynamic } = config;
    const resolver = this.config.dynamicInterventionAudits?.[dynamic.type];

    if (!resolver) return Promise.resolve(dynamic.default ?? 'never');

    return Promise.resolve(resolver(toolArgs, metadata)).then((shouldIntervene) =>
      shouldIntervene ? (dynamic.policy ?? 'always') : (dynamic.default ?? 'never'),
    );
  }

  /**
   * Check if tool calls need human intervention
   * Combines user's global config with tool's own config
   * Returns [toolsNeedingIntervention, toolsToExecute]
   */
  private async checkInterventionNeeded(
    toolsCalling: ChatToolPayload[],
    state: AgentState,
  ): Promise<[ChatToolPayload[], ChatToolPayload[]]> {
    const toolsNeedingIntervention: ChatToolPayload[] = [];
    const toolsToExecute: ChatToolPayload[] = [];

    // Get security blacklist for resolver metadata
    const securityBlacklist = state.securityBlacklist ?? DEFAULT_SECURITY_BLACKLIST;

    // Build resolver metadata: merge state.metadata with security blacklist
    const resolverMetadata = { ...state.metadata, securityBlacklist };

    // Get user config (default to 'manual' mode)
    const userConfig = state.userInterventionConfig || { approvalMode: 'manual' };
    const { approvalMode, allowList = [] } = userConfig;

    // Global audits: default to security blacklist audit if not provided
    const globalResolvers = this.config.globalInterventionAudits ?? createDefaultGlobalAudits();

    for (const toolCalling of toolsCalling) {
      const { identifier, apiName } = toolCalling;
      const toolKey = `${identifier}/${apiName}`;
      const toolResolverMetadata = {
        ...resolverMetadata,
        toolApiName: apiName,
        toolIdentifier: identifier,
      };

      // Parse arguments for intervention checking
      let toolArgs: Record<string, any> = {};
      try {
        toolArgs = JSON.parse(toolCalling.arguments || '{}');
      } catch {
        // Invalid JSON, treat as empty args
      }

      // Phase 1: Run global resolvers (e.g., security blacklist)
      let globalBlocked = false;
      let globalPolicy: HumanInterventionPolicy = 'always';

      // Default global audits are ordered so always-block rules match first
      for (const globalResolver of globalResolvers) {
        if (await globalResolver.resolver(toolArgs, toolResolverMetadata)) {
          globalBlocked = true;
          globalPolicy = globalResolver.policy ?? 'always';
          break;
        }
      }

      // For non-headless modes: 'always' global block requires intervention unconditionally
      if (globalBlocked && globalPolicy === 'always') {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 2.5: Get manifest for later use
      const manifest = state.toolManifestMap?.[identifier];

      // Phase 3: Per-tool dynamic resolver
      const config = this.getToolInterventionConfig(toolCalling, state);
      const isDynamicConfig = this.isDynamicInterventionConfig(config);
      const dynamicPolicy = await this.resolveDynamicPolicy(config, toolArgs, toolResolverMetadata);
      const staticConfig = isDynamicConfig
        ? undefined
        : (config as HumanInterventionConfig | undefined);

      if (dynamicPolicy !== undefined) {
        if (dynamicPolicy === 'never') {
          toolsToExecute.push(toolCalling);
        } else if (approvalMode === 'headless' && dynamicPolicy !== 'always') {
          toolsToExecute.push(toolCalling);
        } else {
          toolsNeedingIntervention.push(toolCalling);
        }
        continue;
      }

      // Phase 3.5: Headless mode auto-runs global blocks with non-always policy
      if (approvalMode === 'headless' && globalBlocked && globalPolicy !== 'always') {
        toolsToExecute.push(toolCalling);
        continue;
      }

      // Phase 3.5: Handle overridable global block (policy !== 'always')
      if (globalBlocked && globalPolicy !== 'always') {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 4: Check 'always' policy - overrides auto-run mode
      if (this.matchesAlwaysPolicy(staticConfig, toolArgs)) {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Headless/CLI has no approval UI. Auto-run overridable tool-level policies,
      // while preserving non-bypassable `always` blocks handled above.
      if (approvalMode === 'headless') {
        toolsToExecute.push(toolCalling);
        continue;
      }

      // Phase 5: User config is 'auto-run', all tools execute directly
      if (approvalMode === 'auto-run') {
        toolsToExecute.push(toolCalling);
        continue;
      }

      // Phase 5.5: Unknown tool guard — require intervention for tools not in manifest
      // Only applies to manual/allow-list modes; auto-run users accept the risk
      if (!manifest) {
        console.warn(
          `[InterventionGuard] Unknown tool "${identifier}/${apiName}" not found in toolManifestMap (keys: ${Object.keys(state.toolManifestMap ?? {}).join(', ')}), requiring intervention`,
        );
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 6: User config is 'allow-list', check if tool is in whitelist
      if (approvalMode === 'allow-list') {
        if (allowList.includes(toolKey)) {
          toolsToExecute.push(toolCalling);
        } else {
          toolsNeedingIntervention.push(toolCalling);
        }
        continue;
      }

      // Phase 7: User config is 'manual' (default), use tool's own config
      const policy = InterventionChecker.shouldIntervene({
        config: staticConfig,
        securityBlacklist,
        toolArgs,
      });

      if (policy === 'never') {
        toolsToExecute.push(toolCalling);
      } else {
        toolsNeedingIntervention.push(toolCalling);
      }
    }

    return [toolsNeedingIntervention, toolsToExecute];
  }

  /**
   * Extract abort information from current context and state
   * Returns the necessary data to handle abort scenario
   */
  private extractAbortInfo(context: AgentRuntimeContext, state: AgentState) {
    let hasToolsCalling = false;
    let toolsCalling: ChatToolPayload[] = [];
    let parentMessageId = '';

    // Extract abort info based on current phase
    switch (context.phase) {
      case 'llm_result': {
        const payload = context.payload as GeneralAgentCallLLMResultPayload;
        hasToolsCalling = payload.hasToolsCalling || false;
        toolsCalling = payload.toolsCalling || [];
        parentMessageId = payload.parentMessageId;
        break;
      }
      case 'human_abort': {
        // When user cancels during LLM streaming, we enter human_abort phase
        // The payload contains tool calls info if LLM had started returning them
        const payload = context.payload as any;
        hasToolsCalling = payload.hasToolsCalling || false;
        toolsCalling = payload.toolsCalling || [];
        parentMessageId = payload.parentMessageId;
        break;
      }
      case 'tool_result':
      case 'tools_batch_result': {
        const payload = context.payload as GeneralAgentCallToolResultPayload;
        parentMessageId = payload.parentMessageId;
        // Check if there are pending tool messages
        const pendingToolMessages = state.messages.filter(
          (m: any) => m.role === 'tool' && m.pluginIntervention?.status === 'pending',
        );
        if (pendingToolMessages.length > 0) {
          hasToolsCalling = true;
          toolsCalling = pendingToolMessages.map((m: any) => m.plugin).filter(Boolean);
        }
        break;
      }
    }

    return { hasToolsCalling, parentMessageId, toolsCalling };
  }

  /**
   * Pending-tool scope guard for the main loop.
   *
   * The pending-approval check must only count tool messages produced by the
   * **current** assistant turn. Stale `pluginIntervention.status === 'pending'`
   * rows from a previous turn (e.g. an abandoned approval flow whose user
   * never clicked approve/reject) get loaded back into `state.messages` via
   * `historyMessages` and would otherwise hijack every subsequent
   * `tool_result` / `tools_batch_result` phase, parking the loop in
   * `waiting_for_human` forever.
   *
   * "Current turn" = the most recent assistant message that emitted tool calls,
   * stored as either model-native `tool_calls` or persisted `tools`. All pending
   * tool messages legitimately belonging to this turn have
   * `parentId === currentAssistantId`.
   */
  private getCurrentTurnPendingToolMessages(state: AgentState): any[] {
    let currentAssistantId: string | undefined;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i] as any;
      if (m.role === 'assistant' && (m.tool_calls?.length > 0 || m.tools?.length > 0)) {
        currentAssistantId = m.id;
        break;
      }
    }

    if (!currentAssistantId) return [];

    return state.messages.filter(
      (m: any) =>
        m.role === 'tool' &&
        m.pluginIntervention?.status === 'pending' &&
        m.parentId === currentAssistantId,
    );
  }

  /**
   * Find existing compression summary from messages
   * Looks for MessageGroup with type 'compression' and extracts its content
   */
  private findExistingSummary(messages: any[]): string | undefined {
    // Look for compression group summary in messages
    // The summary is typically stored as a system message with compression metadata
    // or as a MessageGroup content field
    for (const msg of messages) {
      if (msg.role === 'system' && msg.metadata?.compressionSummary) {
        return msg.content;
      }
      // Check for MessageGroup type compression
      if (msg.messageGroupType === 'compression' && msg.content) {
        return msg.content;
      }
    }
    return undefined;
  }

  /**
   * Proceed to the next LLM call, inserting compression first when needed.
   */
  private toLLMCall(
    payload: GeneralAgentCallLLMInstructionPayload,
    state: AgentState,
    trigger: ContextBudgetTrigger = 'threshold',
    runtimeOverride?: RuntimeContextBudgetInput,
  ): AgentInstruction {
    const compressionEnabled = this.config.compressionConfig?.enabled ?? true;
    // Mirror RuntimeExecutors.callLlm: when state.forceFinish is set, the
    // executor strips all tools via buildStepToolDelta (deactivatedToolIds: ['*']),
    // so they must not count against the compression budget either — otherwise
    // we'd burn an extra summarization pass on tool tokens that won't be sent.
    if (!compressionEnabled) return { payload, type: 'call_llm' };

    const runtimeInput = {
      ...getRuntimeContextBudgetInput(payload, state.metadata),
      ...runtimeOverride,
    };
    const attemptState = runtimeInput.attemptState ?? {
      compressionAttempt: 0,
      payloadFingerprint: '',
      sentPayloadFingerprints: runtimeInput.sentPayloadFingerprints ?? [],
    };
    const modelId = payload.model ?? this.config.modelRuntimeConfig?.model ?? '';
    const providerId = payload.provider ?? this.config.modelRuntimeConfig?.provider ?? '';
    const evaluation = evaluateContextBudget({
      attemptState,
      candidateIds: runtimeInput.candidateIds,
      catalogSnapshot: runtimeInput.catalogSnapshot,
      configuredWindowTokens: this.config.compressionConfig?.maxWindowToken,
      messages: payload.messages,
      modelId,
      observedWindowTokens: runtimeInput.observedWindowTokens,
      operationId: this.config.operationId,
      outputReserveTokens: runtimeInput.outputReserveTokens,
      preservedIds: runtimeInput.preservedIds,
      providerId,
      providerMedia: runtimeInput.providerMedia,
      thresholdRatio: this.config.compressionConfig?.thresholdRatio,
      tools: state.forceFinish ? undefined : payload.tools,
      trigger,
    });

    if (evaluation.decision.kind === 'compress') {
      return createCompressionInstruction(
        evaluation,
        payload.messages,
        runtimeInput,
        this.findExistingSummary(payload.messages),
      );
    }
    if (evaluation.decision.kind === 'fail') {
      return createContextBudgetFailure(evaluation.decision, evaluation.trace);
    }

    return {
      payload,
      type: 'call_llm',
    };
  }

  /**
   * Handle abort scenario - unified abort handling logic
   */
  private handleAbort(
    context: AgentRuntimeContext,
    state: AgentState,
  ): AgentInstruction | AgentInstruction[] {
    const { hasToolsCalling, parentMessageId, toolsCalling } = this.extractAbortInfo(
      context,
      state,
    );

    // If there are pending tool calls, resolve them
    if (hasToolsCalling && toolsCalling.length > 0) {
      return {
        payload: { parentMessageId, toolsCalling },
        type: 'resolve_aborted_tools',
      };
    }

    // No tools to resolve, directly finish
    return {
      reason: 'user_requested',
      reasonDetail: 'Operation cancelled by user',
      type: 'finish',
    };
  }

  async runner(
    context: AgentRuntimeContext,
    state: AgentState,
  ): Promise<AgentInstruction | AgentInstruction[]> {
    // Unified abort check: if operation is interrupted, handle abort scenario
    // This check is placed before phase handling to ensure consistent abort behavior
    if (state.status === 'interrupted') {
      return this.handleAbort(context, state);
    }

    switch (context.phase) {
      case 'init':
      case 'user_input': {
        return this.toLLMCall(
          {
            ...(context.payload as any),
            messages: state.messages,
            ...(state.tools ? { tools: state.tools } : {}),
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'llm_result': {
        // LLM response received, check if it contains tool calls
        const { hasToolsCalling, toolsCalling, parentMessageId, result } =
          context.payload as GeneralAgentCallLLMResultPayload;

        if (hasToolsCalling && toolsCalling && toolsCalling.length > 0) {
          // Check which tools need human intervention
          const [toolsNeedingIntervention, toolsToExecute] = await this.checkInterventionNeeded(
            toolsCalling,
            state,
          );

          const instructions: AgentInstruction[] = [];

          // Execute tools that don't need intervention first
          // These will run immediately before any approval requests
          if (toolsToExecute.length > 0) {
            if (toolsToExecute.length > 1) {
              instructions.push({
                payload: {
                  parentMessageId,
                  toolsCalling: toolsToExecute,
                } as GeneralAgentCallToolsBatchInstructionPayload,
                type: 'call_tools_batch',
              });
            } else {
              instructions.push({
                payload: {
                  parentMessageId,
                  toolCalling: toolsToExecute[0],
                } as GeneralAgentCallingToolInstructionPayload,
                type: 'call_tool',
              });
            }
          }

          // Request approval for tools that need intervention
          // Non-headless mode waits for human approval; headless mode returns blocked tool results.
          if (toolsNeedingIntervention.length > 0) {
            if (state.userInterventionConfig?.approvalMode === 'headless') {
              instructions.push({
                payload: {
                  parentMessageId,
                  toolsCalling: toolsNeedingIntervention,
                },
                type: 'resolve_blocked_tools',
              } satisfies AgentInstruction);
            } else {
              instructions.push({
                pendingToolsCalling: toolsNeedingIntervention,
                reason: 'human_intervention_required',
                type: 'request_human_approve',
              });
            }
          }

          return instructions;
        }

        // Silent-drop diagnostic: LLM emitted raw tool_calls but every one
        // failed to resolve to a known tool (e.g. malformed names without the
        // `____` separator). Surface this in reasonDetail so dashboards can
        // distinguish it from a genuine no-tool completion. See .
        const rawToolCallCount = result?.tool_calls?.length ?? 0;
        const hasUnresolvedToolCalls = rawToolCallCount > 0;

        // No tool calls, conversation is complete
        return {
          reason: state.forceFinish ? 'max_steps_completed' : 'completed',
          reasonDetail: hasUnresolvedToolCalls
            ? `LLM returned ${rawToolCallCount} unresolvable tool_calls: ${(
                result?.tool_calls ?? []
              )
                .map((tc) => tc.function?.name)
                .filter(Boolean)
                .join(', ')}`
            : state.forceFinish
              ? 'Force finish: LLM produced final text response after max steps'
              : 'LLM response completed without tool calls',
          type: 'finish',
        };
      }

      case 'tool_result': {
        const { data, parentMessageId, stop } =
          context.payload as GeneralAgentCallToolResultPayload;

        // Legacy async agent invocation path. `callAgent({ runAsTask: true })`
        // emits state.type=execSubAgent* with stop=true so the runtime can fork
        // a background agent run after the tool call is persisted.
        if (stop && data?.state) {
          const stateType = data.state.type;

          // Server-side legacy agent invocation (single)
          if (stateType === 'execSubAgent') {
            const { parentMessageId: execParentId, task } = data.state as {
              parentMessageId: string;
              task: any;
            };
            return {
              payload: { parentMessageId: execParentId, task },
              type: 'exec_sub_agent',
            };
          }

          // Server-side legacy agent invocations (multiple)
          if (stateType === 'execSubAgents') {
            const { parentMessageId: execParentId, tasks } = data.state as {
              parentMessageId: string;
              tasks: any[];
            };
            return {
              payload: { parentMessageId: execParentId, tasks },
              type: 'exec_sub_agents',
            };
          }

          // Client-side sub-agent (single, desktop only)
          if (stateType === 'execClientSubAgent') {
            const { parentMessageId: execParentId, task } = data.state as {
              parentMessageId: string;
              task: any;
            };
            return {
              payload: { parentMessageId: execParentId, task },
              type: 'exec_client_sub_agent',
            };
          }

          // Client-side sub-agents (multiple, desktop only)
          if (stateType === 'execClientSubAgents') {
            const { parentMessageId: execParentId, tasks } = data.state as {
              parentMessageId: string;
              tasks: any[];
            };
            return {
              payload: { parentMessageId: execParentId, tasks },
              type: 'exec_client_sub_agents',
            };
          }
        }

        // Scope pending check to the current assistant turn so stale
        // `pending` rows from prior turns can never block the loop.
        const pendingToolMessages = this.getCurrentTurnPendingToolMessages(state);

        // If there are pending tools, wait for human approval
        if (pendingToolMessages.length > 0) {
          const pendingTools = pendingToolMessages.map((m: any) => m.plugin).filter(Boolean);

          return {
            pendingToolsCalling: pendingTools,
            reason: 'Some tools still pending approval',
            skipCreateToolMessage: true,
            type: 'request_human_approve',
          };
        }

        if (context.stepContext?.hasQueuedMessages) {
          return { reason: 'queued_message_interrupt', type: 'finish' };
        }

        // No pending tools, continue to call LLM with tool results
        return this.toLLMCall(
          {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'tools_batch_result': {
        const { parentMessageId } = context.payload as GeneralAgentCallToolResultPayload;

        // Scope pending check to the current assistant turn so stale
        // `pending` rows from prior turns can never block the loop.
        const pendingToolMessages = this.getCurrentTurnPendingToolMessages(state);

        // If there are pending tools, wait for human approval
        if (pendingToolMessages.length > 0) {
          const pendingTools = pendingToolMessages.map((m: any) => m.plugin).filter(Boolean);

          return {
            pendingToolsCalling: pendingTools,
            reason: 'Some tools still pending approval',
            skipCreateToolMessage: true,
            type: 'request_human_approve',
          };
        }

        // If there are queued user messages, finish early so the queue
        // can be processed as a new operation with full context
        if (context.stepContext?.hasQueuedMessages) {
          return { reason: 'queued_message_interrupt', type: 'finish' };
        }

        // No pending tools, continue to call LLM with tool results
        return this.toLLMCall(
          {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'sub_agent_result': {
        // Single sub-agent completed, continue to call LLM with result
        const { parentMessageId } = context.payload as SubAgentResultPayload;

        // Continue to call LLM with updated messages (task message is already in state)
        return this.toLLMCall(
          {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'sub_agents_batch_result': {
        // Sub-agents batch completed, continue to call LLM with results
        const { parentMessageId } = context.payload as SubAgentsBatchResultPayload;

        if (context.stepContext?.hasQueuedMessages) {
          return { reason: 'queued_message_interrupt', type: 'finish' };
        }

        // Inject a virtual user message to force the model to summarize or continue
        // This fixes an issue where some models (e.g., Kimi K2) return empty content
        // when the last message is a task result, thinking the task is already done
        const messagesWithPrompt = [
          ...state.messages,
          {
            content:
              'All tasks above have been completed. Please summarize the results or continue with your response following user query language.',
            role: 'user' as const,
          },
        ];

        // Continue to call LLM with updated messages (task messages are already in state)
        return this.toLLMCall(
          {
            messages: messagesWithPrompt,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'compression_result': {
        const compressionPayload = context.payload as BudgetedCompressionResultPayload;
        const runtimeInput = getRuntimeContextBudgetInput(compressionPayload, state.metadata);
        const validOutcome =
          compressionPayload.attempt === 1 &&
          typeof compressionPayload.beforeTokens === 'number' &&
          typeof compressionPayload.afterTokens === 'number' &&
          typeof compressionPayload.payloadFingerprint === 'string' &&
          typeof compressionPayload.outcome === 'string' &&
          typeof compressionPayload.trigger === 'string';
        let outcome: ContextCompressionOutcome;
        if (validOutcome) {
          outcome = compressionPayload as ContextCompressionOutcome;
        } else if (compressionPayload.skipped) {
          outcome = {
            afterTokens: 0,
            attempt: 1,
            beforeTokens: 0,
            code: 'NO_CANDIDATES',
            outcome: 'skipped',
            payloadFingerprint: '',
            trigger: 'final-preflight',
          };
        } else {
          outcome = {
            afterTokens: 0,
            attempt: 1,
            beforeTokens: 0,
            code: 'SUMMARY_FAILED',
            outcome: 'failed',
            payloadFingerprint: '',
            trigger: 'final-preflight',
          };
        }
        const outcomeFailure = failureAfterCompression(outcome);
        if (outcomeFailure?.kind === 'fail') return createContextBudgetFailure(outcomeFailure);

        const llmPayload = {
          createAssistantMessage: true,
          messages: compressionPayload.compressedMessages,
          model: this.config.modelRuntimeConfig?.model,
          parentMessageId: compressionPayload.parentMessageId,
          provider: this.config.modelRuntimeConfig?.provider,
          tools: state.tools,
        } as GeneralAgentCallLLMInstructionPayload;
        const postCompression = evaluateContextBudget({
          attemptState: {
            compressionAttempt: 1,
            payloadFingerprint: outcome.payloadFingerprint,
            sentPayloadFingerprints: runtimeInput.sentPayloadFingerprints ?? [],
          },
          catalogSnapshot: runtimeInput.catalogSnapshot,
          configuredWindowTokens: this.config.compressionConfig?.maxWindowToken,
          messages: compressionPayload.compressedMessages,
          modelId: llmPayload.model ?? '',
          observedWindowTokens: runtimeInput.observedWindowTokens,
          operationId: this.config.operationId,
          outputReserveTokens: runtimeInput.outputReserveTokens,
          providerId: llmPayload.provider ?? '',
          providerMedia: runtimeInput.providerMedia,
          tools: state.forceFinish ? undefined : state.tools,
          trigger: 'final-preflight',
        });
        const measuredOutcome = { ...outcome, afterTokens: postCompression.estimatedPromptTokens };
        const measuredFailure = failureAfterCompression(measuredOutcome);
        if (
          postCompression.payloadFingerprint === outcome.payloadFingerprint ||
          measuredFailure?.kind === 'fail'
        ) {
          return createContextBudgetFailure(
            (measuredFailure ??
              failureAfterCompression({
                ...measuredOutcome,
                afterTokens: measuredOutcome.beforeTokens,
              })) as Extract<ContextBudgetDecision, { kind: 'fail' }>,
            postCompression.trace,
          );
        }
        if (postCompression.decision.kind === 'fail') {
          return createContextBudgetFailure(postCompression.decision, postCompression.trace);
        }
        if (postCompression.decision.kind !== 'send') {
          return createContextBudgetFailure(
            failureAfterCompression({
              ...measuredOutcome,
              afterTokens: measuredOutcome.beforeTokens,
            }) as Extract<ContextBudgetDecision, { kind: 'fail' }>,
            postCompression.trace,
          );
        }

        return { payload: llmPayload, type: 'call_llm' };
      }

      case 'human_abort': {
        // User aborted the operation
        const { hasToolsCalling, parentMessageId, toolsCalling, reason } =
          context.payload as HumanAbortPayload;

        // If there are pending tool calls, resolve them
        if (hasToolsCalling && toolsCalling && toolsCalling.length > 0) {
          return {
            payload: { parentMessageId, toolsCalling },
            type: 'resolve_aborted_tools',
          };
        }

        // No tools to resolve, directly finish
        return { reason: 'user_requested', reasonDetail: reason, type: 'finish' };
      }

      case 'error': {
        const { error } = context.payload as { error: any };
        const providerError = parseExceededContextWindowError(error);
        if (providerError) {
          const runtimeInput = getRuntimeContextBudgetInput(context.payload, state.metadata);
          if (providerError.observedLimitTokens && this.config.onContextWindowObserved) {
            const snapshot =
              runtimeInput.catalogSnapshot ??
              (state.metadata
                ?.modelCatalogSnapshot as RuntimeContextBudgetInput['catalogSnapshot']);
            const modelId = snapshot?.entry.modelId ?? this.config.modelRuntimeConfig?.model;
            const providerId =
              snapshot?.entry.providerId ?? this.config.modelRuntimeConfig?.provider;
            if (modelId && providerId) {
              try {
                await this.config.onContextWindowObserved({
                  contextWindowRejectionTokens: providerError.observedLimitTokens,
                  modelId,
                  modelVersion: snapshot?.entry.modelVersion,
                  providerId,
                });
              } catch {
                // Evidence persistence is a side channel and must not block recovery.
              }
            }
          }
          if (!(this.config.compressionConfig?.enabled ?? true)) {
            return {
              reason: 'error_recovery',
              reasonDetail: error?.message || 'Unknown error occurred',
              type: 'finish',
            };
          }
          return this.toLLMCall(
            {
              messages: state.messages,
              model: this.config.modelRuntimeConfig?.model,
              provider: this.config.modelRuntimeConfig?.provider,
              tools: state.tools,
            } as GeneralAgentCallLLMInstructionPayload,
            state,
            'provider-error',
            {
              ...runtimeInput,
              observedWindowTokens:
                providerError.observedLimitTokens ?? runtimeInput.observedWindowTokens,
            },
          );
        }

        return {
          reason: 'error_recovery',
          reasonDetail: error?.message || 'Unknown error occurred',
          type: 'finish',
        };
      }

      default: {
        // Unknown phase, finish execution
        return {
          reason: 'agent_decision',
          reasonDetail: `Unknown phase: ${context.phase}`,
          type: 'finish',
        };
      }
    }
  }
}
