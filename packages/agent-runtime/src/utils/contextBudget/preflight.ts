import { countContextTokens } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import type {
  ContextBudgetDecision,
  ContextBudgetOffendingItem,
  ContextCompressionOutcome,
} from '@lobechat/types/src/contextBudget';
import {
  canContinueAfterCompression,
  decideContextBudget,
} from '@lobechat/types/src/contextBudget';

import { resolveEffectiveContextWindow } from './effectiveWindow';
import type {
  ContextBudgetEvaluation,
  ContextMessagePartition,
  EvaluateContextBudgetInput,
  FinalPayloadMediaEstimate,
} from './types';
import { normalizeCompressionAttempt } from './types';

const getMessageId = (message: UIChatMessage, index: number): string =>
  typeof message.id === 'string' && message.id ? message.id : `payload-message-${index}`;

const isPinned = (message: UIChatMessage): boolean =>
  Boolean((message as UIChatMessage & { pinned?: boolean }).pinned || message.metadata?.pinned);

export const partitionContextMessages = (
  messages: UIChatMessage[],
  options: { candidateIds?: readonly string[]; preservedIds?: readonly string[] } = {},
): ContextMessagePartition => {
  const indexed = messages.map((message, index) => ({ id: getMessageId(message, index), message }));
  const explicitCandidates = options.candidateIds ? new Set(options.candidateIds) : undefined;
  const explicitPreserved = options.preservedIds ? new Set(options.preservedIds) : undefined;

  if (explicitCandidates || explicitPreserved) {
    const candidateIds: string[] = [];
    const candidateMessages: UIChatMessage[] = [];
    const preservedIds: string[] = [];
    const preservedMessages: UIChatMessage[] = [];

    for (const item of indexed) {
      if (
        explicitCandidates?.has(item.id) &&
        !explicitPreserved?.has(item.id) &&
        item.message.role !== 'system' &&
        !isPinned(item.message)
      ) {
        candidateIds.push(item.id);
        candidateMessages.push(item.message);
      } else {
        preservedIds.push(item.id);
        preservedMessages.push(item.message);
      }
    }

    return { candidateIds, candidateMessages, preservedIds, preservedMessages };
  }

  let tailStart = indexed.findLastIndex(({ message }) => message.role === 'user');
  if (tailStart < 0) tailStart = Math.max(0, indexed.length - 1);

  const candidateIds: string[] = [];
  const candidateMessages: UIChatMessage[] = [];
  const preservedIds: string[] = [];
  const preservedMessages: UIChatMessage[] = [];

  indexed.forEach((item, index) => {
    const nonCompressible =
      index >= tailStart || item.message.role === 'system' || isPinned(item.message);
    if (nonCompressible) {
      preservedIds.push(item.id);
      preservedMessages.push(item.message);
    } else {
      candidateIds.push(item.id);
      candidateMessages.push(item.message);
    }
  });

  return { candidateIds, candidateMessages, preservedIds, preservedMessages };
};

const mediaForTail = (
  providerMedia: FinalPayloadMediaEstimate[],
  candidateIds: readonly string[],
): FinalPayloadMediaEstimate[] => {
  const candidates = new Set(candidateIds);
  return providerMedia.filter((item) => !item.messageId || !candidates.has(item.messageId));
};

const scaled = (tokens: number, driftMultiplier: number): number =>
  Math.ceil(tokens * driftMultiplier);

const collectOffendingItems = (
  input: EvaluateContextBudgetInput,
  accounting: ReturnType<typeof countContextTokens>,
): ContextBudgetOffendingItem[] => {
  const items: ContextBudgetOffendingItem[] = accounting.messages
    .filter((message) => message.total > 0)
    .map((message) => {
      const original = input.messages[message.index];
      const source =
        original.role === 'system' ? 'system' : original.role === 'tool' ? 'tool-result' : 'text';
      return {
        estimatedTokens: scaled(message.total, accounting.driftMultiplier),
        messageId: getMessageId(original, message.index),
        source,
      };
    });

  items.push(
    ...accounting.attachments
      .filter((attachment) => attachment.estimatedTokens > 0)
      .map((attachment) => ({
        estimatedTokens: scaled(attachment.estimatedTokens, accounting.driftMultiplier),
        messageId: attachment.messageId,
        source: 'attachment' as const,
      })),
  );

  items.push(
    ...accounting.tools
      .filter((tool) => tool.total > 0)
      .map((tool) => ({
        estimatedTokens: scaled(tool.total, accounting.driftMultiplier),
        source: 'tools' as const,
      })),
  );

  return items.sort((a, b) => b.estimatedTokens - a.estimatedTokens).slice(0, 12);
};

function protectRecentTurns(
  input: EvaluateContextBudgetInput,
  accounting: ReturnType<typeof countContextTokens>,
  partition: ContextMessagePartition,
  availableTokens: number,
): ContextMessagePartition {
  if (input.candidateIds || input.preservedIds || input.trigger === 'manual') return partition;

  const candidates = new Set(partition.candidateIds);
  const latestUser = input.messages.findLastIndex((message) => message.role === 'user');
  const mediaTokens = new Map<string, number>();
  for (const attachment of accounting.attachments) {
    if (!attachment.messageId) continue;
    mediaTokens.set(
      attachment.messageId,
      (mediaTokens.get(attachment.messageId) ?? 0) + attachment.estimatedTokens,
    );
  }

  let remaining = availableTokens;
  let end = latestUser;
  for (let start = end - 1; start >= 0; start--) {
    if (input.messages[start].role !== 'user') continue;
    const turnIds: string[] = [];
    let turnTokens = 0;
    for (let index = start; index < end; index++) {
      const id = getMessageId(input.messages[index], index);
      if (!candidates.has(id)) continue;
      turnIds.push(id);
      turnTokens += accounting.messages[index].total + (mediaTokens.get(id) ?? 0);
    }
    const estimated = scaled(turnTokens, accounting.driftMultiplier);
    if (estimated > remaining) break;
    for (const id of turnIds) candidates.delete(id);
    remaining -= estimated;
    end = start;
  }

  // Provider rejection takes precedence over the recent-history preference
  // when the previous turn is the only history available to compact.
  if (input.trigger === 'provider-error' && candidates.size === 0) return partition;
  return candidates.size === partition.candidateIds.length
    ? partition
    : partitionContextMessages(input.messages, { candidateIds: [...candidates] });
}

export const evaluateContextBudget = (
  input: EvaluateContextBudgetInput,
): ContextBudgetEvaluation => {
  const window = resolveEffectiveContextWindow(input);
  const initialPartition = partitionContextMessages(input.messages, input);
  const providerMedia = input.providerMedia ?? [];
  const tools = input.tools ?? [];
  const accounting = countContextTokens({
    messages: input.messages,
    options: { driftMultiplier: input.driftMultiplier },
    providerMedia,
    tools,
  });
  const availablePromptTokens = Math.max(
    1,
    window.windowTokens - Math.max(0, Math.floor(input.outputReserveTokens ?? 0)),
  );
  const countTail = (partition: ContextMessagePartition) =>
    countContextTokens({
      messages: partition.preservedMessages,
      options: { driftMultiplier: input.driftMultiplier },
      providerMedia: mediaForTail(providerMedia, partition.candidateIds),
      tools,
    });
  const requiredTailTokens = countTail(initialPartition).adjustedTotal;
  const partition = protectRecentTurns(
    input,
    accounting,
    initialPartition,
    Math.max(
      0,
      Math.min(
        20_000,
        Math.floor(availablePromptTokens * 0.25),
        availablePromptTokens - requiredTailTokens,
      ),
    ),
  );
  const tailTokens =
    partition === initialPartition ? requiredTailTokens : countTail(partition).adjustedTotal;
  const softBudget = Math.max(1, Math.floor(availablePromptTokens * (input.thresholdRatio ?? 0.5)));
  const useSoftBudget =
    input.trigger === 'threshold' && tailTokens < softBudget && partition.candidateIds.length > 0;
  const budgetTokens = useSoftBudget ? softBudget : availablePromptTokens;
  const offending = collectOffendingItems(input, accounting);
  const compressionAttempt = normalizeCompressionAttempt(input.attemptState?.compressionAttempt);
  const sentPayloadFingerprints = input.attemptState?.sentPayloadFingerprints ?? [];

  const decision = decideContextBudget({
    budgetTokens,
    candidateIds: partition.candidateIds,
    compressionAttempt,
    offending,
    payloadFingerprint: accounting.payloadFingerprint,
    preservedIds: partition.preservedIds,
    promptTokens: accounting.adjustedTotal,
    sentPayloadFingerprints,
    source: window.source,
    tailTokens,
    trigger: input.trigger,
    windowTokens: window.windowTokens,
  });

  return {
    budgetTokens,
    decision,
    estimatedPromptTokens: accounting.adjustedTotal,
    partition,
    payloadFingerprint: accounting.payloadFingerprint,
    tailTokens,
    trace: {
      attempt: compressionAttempt,
      decision,
      effectiveWindowSource: window.source,
      effectiveWindowTokens: window.windowTokens,
      estimatedPromptTokens: accounting.adjustedTotal,
      modelId: input.modelId,
      offending,
      operationId: input.operationId,
      payloadFingerprint: accounting.payloadFingerprint,
      providerId: input.providerId,
      warnings: window.warnings,
    },
    window,
  };
};

const ACTIONS_BY_OUTCOME_CODE = {
  DUPLICATE_REQUEST: [],
  NO_CANDIDATES: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
  RETRY_EXHAUSTED: ['switch_model', 'fork_topic'],
  SUMMARY_FAILED: ['switch_model', 'fork_topic'],
  TAIL_TOO_LARGE: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
} as const;

export const failureAfterCompression = (
  outcome: ContextCompressionOutcome,
  offending: readonly ContextBudgetOffendingItem[] = [],
): ContextBudgetDecision | undefined => {
  if (canContinueAfterCompression(outcome)) return undefined;

  if (outcome.outcome === 'skipped') {
    return {
      actions: [...ACTIONS_BY_OUTCOME_CODE.NO_CANDIDATES],
      code: outcome.code,
      kind: 'fail',
      offending: [...offending],
    };
  }

  if (outcome.outcome === 'failed') {
    return {
      actions: [...ACTIONS_BY_OUTCOME_CODE[outcome.code]],
      code: outcome.code,
      kind: 'fail',
      offending: [...offending],
    };
  }

  return decideContextBudget({
    budgetTokens: 1,
    candidateIds: [],
    compressionAttempt: 1,
    offending,
    payloadFingerprint: outcome.payloadFingerprint,
    preservedIds: [],
    promptTokens: outcome.afterTokens,
    source: 'compression',
    tailTokens: 0,
    trigger: 'provider-error',
    windowTokens: 1,
  });
};
