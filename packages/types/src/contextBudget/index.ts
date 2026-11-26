export type ContextBudgetFailCode =
  | 'NO_CANDIDATES'
  | 'DUPLICATE_REQUEST'
  | 'RETRY_EXHAUSTED'
  | 'SUMMARY_FAILED'
  | 'TAIL_TOO_LARGE';

export type ContextBudgetTrigger = 'final-preflight' | 'manual' | 'provider-error' | 'threshold';
export type ContextBudgetOffendingSource =
  | 'attachment'
  | 'system'
  | 'text'
  | 'tool-result'
  | 'tools';
export type ContextBudgetAction =
  | 'detach_attachments'
  | 'fork_topic'
  | 'switch_model'
  | 'truncate_tool_results';

export interface ContextBudgetOffendingItem {
  estimatedTokens: number;
  messageId?: string;
  source: ContextBudgetOffendingSource;
}

export type ContextBudgetDecision =
  | {
      kind: 'send';
      promptTokens: number;
      source: string;
      windowTokens: number;
    }
  | {
      attempt: 1;
      candidateIds: string[];
      kind: 'compress';
      preservedIds: string[];
      trigger: ContextBudgetTrigger;
    }
  | {
      actions: ContextBudgetAction[];
      code: ContextBudgetFailCode;
      kind: 'fail';
      offending: ContextBudgetOffendingItem[];
    };

export type ContextPayloadFingerprint = string;
export type CompressionAttempt = 0 | 1;

export interface ContextBudgetAttemptState {
  compressionAttempt: CompressionAttempt;
  payloadFingerprint: ContextPayloadFingerprint;
  sentPayloadFingerprints: readonly ContextPayloadFingerprint[];
}

export interface DecideContextBudgetInput {
  /** Threshold/final/provider-specific effective prompt budget; never larger than windowTokens. */
  budgetTokens: number;
  candidateIds: readonly string[];
  compressionAttempt: CompressionAttempt;
  offending: readonly ContextBudgetOffendingItem[];
  payloadFingerprint: ContextPayloadFingerprint;
  preservedIds: readonly string[];
  promptTokens: number;
  sentPayloadFingerprints?: readonly ContextPayloadFingerprint[];
  source: string;
  /** Tokens that cannot be reduced by summarizing candidateIds. */
  tailTokens: number;
  trigger: ContextBudgetTrigger;
  windowTokens: number;
}

export interface ContextCompressionOutcomeBase {
  afterTokens: number;
  attempt: 1;
  beforeTokens: number;
  payloadFingerprint: ContextPayloadFingerprint;
  trigger: ContextBudgetTrigger;
}

export type ContextCompressionOutcome =
  | (ContextCompressionOutcomeBase & { outcome: 'compressed' })
  | (ContextCompressionOutcomeBase & {
      code: 'NO_CANDIDATES';
      outcome: 'skipped';
    })
  | (ContextCompressionOutcomeBase & {
      code: Exclude<ContextBudgetFailCode, 'NO_CANDIDATES'>;
      outcome: 'failed';
    });

/** Redacted observability record: it carries ids/counts, never message or attachment content. */
export interface ContextBudgetTrace {
  attempt: CompressionAttempt;
  decision: ContextBudgetDecision;
  effectiveWindowSource: string;
  effectiveWindowTokens: number;
  estimatedPromptTokens: number;
  modelId: string;
  operationId: string;
  payloadFingerprint: ContextPayloadFingerprint;
  providerId: string;
}

const actionsForFailure = (code: ContextBudgetFailCode): ContextBudgetAction[] => {
  switch (code) {
    case 'DUPLICATE_REQUEST': {
      return [];
    }
    case 'TAIL_TOO_LARGE': {
      return ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'];
    }
    case 'NO_CANDIDATES': {
      return ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'];
    }
    case 'SUMMARY_FAILED': {
      return ['switch_model', 'fork_topic'];
    }
    case 'RETRY_EXHAUSTED': {
      return ['switch_model', 'fork_topic'];
    }
  }
};

const fail = (
  code: ContextBudgetFailCode,
  offending: readonly ContextBudgetOffendingItem[],
): ContextBudgetDecision => ({
  actions: actionsForFailure(code),
  code,
  kind: 'fail',
  offending: [...offending],
});

/**
 * Pure decision boundary. Token/media accounting and summary execution are supplied by the
 * context-budget lane; this function only enforces bounded attempts and identical-payload rules.
 */
export const decideContextBudget = (input: DecideContextBudgetInput): ContextBudgetDecision => {
  if (input.trigger === 'provider-error' && input.compressionAttempt >= 1) {
    return fail('RETRY_EXHAUSTED', input.offending);
  }

  if (input.tailTokens > input.budgetTokens) return fail('TAIL_TOO_LARGE', input.offending);

  if (input.trigger === 'provider-error') {
    if (input.candidateIds.length === 0) return fail('NO_CANDIDATES', input.offending);
    return {
      attempt: 1,
      candidateIds: [...input.candidateIds],
      kind: 'compress',
      preservedIds: [...input.preservedIds],
      trigger: input.trigger,
    };
  }

  if (input.trigger !== 'manual' && input.promptTokens <= input.budgetTokens) {
    if (input.sentPayloadFingerprints?.includes(input.payloadFingerprint)) {
      return fail('DUPLICATE_REQUEST', input.offending);
    }
    return {
      kind: 'send',
      promptTokens: input.promptTokens,
      source: input.source,
      windowTokens: input.windowTokens,
    };
  }

  if (input.compressionAttempt >= 1) return fail('RETRY_EXHAUSTED', input.offending);
  if (input.candidateIds.length === 0) return fail('NO_CANDIDATES', input.offending);

  return {
    attempt: 1,
    candidateIds: [...input.candidateIds],
    kind: 'compress',
    preservedIds: [...input.preservedIds],
    trigger: input.trigger,
  };
};

export const hasPayloadBeenSent = (
  fingerprint: ContextPayloadFingerprint,
  sentPayloadFingerprints: readonly ContextPayloadFingerprint[],
): boolean => sentPayloadFingerprints.includes(fingerprint);

/** Only a material token reduction authorizes the next call_llm transition. */
export const canContinueAfterCompression = (outcome: ContextCompressionOutcome): boolean =>
  outcome.outcome === 'compressed' && outcome.afterTokens < outcome.beforeTokens;
