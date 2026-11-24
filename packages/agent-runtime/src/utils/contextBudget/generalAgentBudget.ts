import type {
  ContextBudgetAttemptState,
  ContextBudgetDecision,
  ContextCompressionOutcome,
} from '@lobechat/types/src/contextBudget';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';

import type {
  AgentInstruction,
  GeneralAgentCallLLMInstructionPayload,
  GeneralAgentCompressionResultPayload,
} from '../../types';
import type { evaluateContextBudget } from './preflight';
import type { FinalPayloadMediaEstimate } from './types';

export interface RuntimeContextBudgetInput {
  attemptState?: Partial<ContextBudgetAttemptState>;
  candidateIds?: readonly string[];
  catalogSnapshot?: ModelCatalogSnapshot;
  observedWindowTokens?: number;
  outputReserveTokens?: number;
  preservedIds?: readonly string[];
  providerMedia?: FinalPayloadMediaEstimate[];
  sentPayloadFingerprints?: readonly string[];
}

export type BudgetedCompressionResultPayload = GeneralAgentCompressionResultPayload &
  Partial<ContextCompressionOutcome> &
  RuntimeContextBudgetInput;

export type ContextBudgetFailureInstruction = AgentInstruction & {
  contextBudget: {
    decision: Extract<ContextBudgetDecision, { kind: 'fail' }>;
    trace?: ReturnType<typeof evaluateContextBudget>['trace'];
  };
};

export const getRuntimeContextBudgetInput = (
  payload: unknown,
  stateMetadata?: Record<string, unknown>,
): RuntimeContextBudgetInput => {
  const stateInput = (stateMetadata?.contextBudget ?? {}) as RuntimeContextBudgetInput;
  const payloadInput =
    payload && typeof payload === 'object'
      ? (((payload as Record<string, unknown>).contextBudget ??
          payload) as RuntimeContextBudgetInput)
      : {};

  return { ...stateInput, ...payloadInput };
};

export const createContextBudgetFailure = (
  decision: Extract<ContextBudgetDecision, { kind: 'fail' }>,
  trace?: ReturnType<typeof evaluateContextBudget>['trace'],
): ContextBudgetFailureInstruction =>
  ({
    contextBudget: { decision, trace },
    reason: 'error_recovery',
    reasonDetail: decision.code,
    type: 'finish',
  }) as ContextBudgetFailureInstruction;

export const createCompressionInstruction = (
  evaluation: ReturnType<typeof evaluateContextBudget>,
  messages: GeneralAgentCallLLMInstructionPayload['messages'],
  runtimeInput: RuntimeContextBudgetInput,
  existingSummary?: string,
  parentMessageId?: string,
): AgentInstruction => {
  const decision = evaluation.decision;
  if (decision.kind !== 'compress') {
    throw new Error('createCompressionInstruction requires a compress decision');
  }
  const sentPayloadFingerprints = [
    ...(runtimeInput.attemptState?.sentPayloadFingerprints ??
      runtimeInput.sentPayloadFingerprints ??
      []),
  ];
  if (
    decision.trigger === 'provider-error' &&
    !sentPayloadFingerprints.includes(evaluation.payloadFingerprint)
  ) {
    sentPayloadFingerprints.push(evaluation.payloadFingerprint);
  }

  return {
    payload: {
      attempt: decision.attempt,
      budgetTokens: evaluation.budgetTokens,
      candidateIds: decision.candidateIds,
      catalogSnapshot: runtimeInput.catalogSnapshot,
      currentTokenCount: evaluation.estimatedPromptTokens,
      existingSummary,
      messages,
      observedWindowTokens: runtimeInput.observedWindowTokens,
      outputReserveTokens: runtimeInput.outputReserveTokens,
      parentMessageId,
      payloadFingerprint: evaluation.payloadFingerprint,
      preservedIds: decision.preservedIds,
      providerMedia: runtimeInput.providerMedia,
      sentPayloadFingerprints,
      trace: evaluation.trace,
      trigger: decision.trigger,
      windowTokens: evaluation.window.windowTokens,
    },
    type: 'compress_context',
  } as AgentInstruction;
};
