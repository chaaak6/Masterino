import type {
  CompressionAttempt,
  ContextBudgetAction,
  ContextBudgetDecision,
  ContextBudgetFailCode,
  ContextBudgetOffendingSource,
} from '@lobechat/types/src/contextBudget';

import type defaultError from '@/locales/default/error';

/**
 * Pure `ContextBudgetDecision` / trace → view model adapter for the context recovery UI.
 *
 * This module never re-implements the budget decision (see `decideContextBudget` in the
 * accepted contract). It only:
 *   1. extracts and whitelists a typed `fail` decision plus redacted diagnostics from an
 *      error body, dropping everything else (raw messages, attachments, URLs, tool results);
 *   2. maps the fail code to the action / hint / note matrix the card renders;
 *   3. resolves the pending → success → failure presentation without leaking a stale error.
 */

export type ContextBudgetFailDecision = Extract<ContextBudgetDecision, { kind: 'fail' }>;

/** Redacted diagnostics accepted by the UI: identifiers and counts only, never content. */
export interface ContextBudgetDiagnosticsInput {
  attempt?: CompressionAttempt;
  effectiveWindowSource?: string;
  effectiveWindowTokens?: number;
  estimatedPromptTokens?: number;
  modelId?: string;
  operationId?: string;
  providerId?: string;
  warnings?: string[];
}

export interface ContextBudgetFailurePayload {
  decision: ContextBudgetFailDecision;
  trace?: ContextBudgetDiagnosticsInput;
}

/** Contract actions plus the two UI-only recovery actions for summary failures. */
export type ContextBudgetUIAction =
  | ContextBudgetAction
  | 'retry_compression'
  | 'switch_compression_model';

export type ContextBudgetTranslationKey = Extract<
  keyof typeof defaultError,
  `contextBudget.${string}`
>;

export interface ContextBudgetErrorActionView {
  disabled: boolean;
  /** Present only when the action is rendered disabled on purpose (e.g. no candidates). */
  disabledReasonKey?: ContextBudgetTranslationKey;
  id: ContextBudgetUIAction;
  labelKey: ContextBudgetTranslationKey;
  primary: boolean;
}

export interface ContextBudgetSourceShare {
  estimatedTokens: number;
  labelKey: ContextBudgetTranslationKey;
  /** Share of the aggregated offending tokens, in `[0, 1]`. */
  share: number;
  source: ContextBudgetOffendingSource;
}

export interface ContextBudgetLargestSource {
  estimatedTokens: number;
  labelKey: ContextBudgetTranslationKey;
  source: ContextBudgetOffendingSource;
}

export interface ContextBudgetDiagnosticsView {
  attempt?: CompressionAttempt;
  attemptLimit: 1;
  dominantSources: ContextBudgetSourceShare[];
  estimatedPromptTokens?: number;
  hasDiagnostics: boolean;
  modelId?: string;
  operationId?: string;
  providerId?: string;
  windowSource?: string;
  /** Localized label for the well-known window sources; raw `windowSource` otherwise. */
  windowSourceLabelKey?: ContextBudgetTranslationKey;
  windowTokens?: number;
  windowUnknown: boolean;
}

export interface ContextBudgetErrorViewModel {
  actions: ContextBudgetErrorActionView[];
  /** The UI never schedules another automatic retry; recovery is bounded by the runtime. */
  allowsAutoRetry: false;
  code: ContextBudgetFailCode;
  descKey: ContextBudgetTranslationKey;
  diagnostics: ContextBudgetDiagnosticsView;
  hintKeys: ContextBudgetTranslationKey[];
  largestSource?: ContextBudgetLargestSource;
  noteKey?: ContextBudgetTranslationKey;
  /** Whether the user's original messages are guaranteed untouched by this failure. */
  originalMessagesPreserved: boolean;
  titleKey: ContextBudgetTranslationKey;
}

export interface BuildContextBudgetErrorViewModelOptions {
  /** Actions that have a handler. Omitted → every matrix action is considered available. */
  availableActions?: Iterable<ContextBudgetUIAction>;
  /** Actions that exist but cannot run right now (no topic, no permission, …). */
  disabledActions?: Iterable<ContextBudgetUIAction>;
}

export const CONTEXT_BUDGET_FAIL_CODES: readonly ContextBudgetFailCode[] = [
  'DUPLICATE_REQUEST',
  'NO_CANDIDATES',
  'RETRY_EXHAUSTED',
  'SUMMARY_FAILED',
  'TAIL_TOO_LARGE',
];

const CONTRACT_ACTIONS: readonly ContextBudgetAction[] = [
  'detach_attachments',
  'fork_topic',
  'switch_model',
  'truncate_tool_results',
];

const OFFENDING_SOURCES: readonly ContextBudgetOffendingSource[] = [
  'attachment',
  'system',
  'text',
  'tool-result',
  'tools',
];

export const WINDOW_UNKNOWN_WARNING = 'WINDOW_UNKNOWN';

const MAX_IDENTIFIER_LENGTH = 120;
const MAX_DOMINANT_SOURCES = 3;

const SOURCE_LABEL_KEYS: Record<ContextBudgetOffendingSource, ContextBudgetTranslationKey> = {
  'attachment': 'contextBudget.source.attachment',
  'system': 'contextBudget.source.system',
  'text': 'contextBudget.source.text',
  'tool-result': 'contextBudget.source.toolResult',
  'tools': 'contextBudget.source.tools',
};

const ACTION_LABEL_KEYS: Record<ContextBudgetUIAction, ContextBudgetTranslationKey> = {
  detach_attachments: 'contextBudget.action.detachAttachments',
  fork_topic: 'contextBudget.action.forkTopic',
  retry_compression: 'contextBudget.action.retryCompression',
  switch_compression_model: 'contextBudget.action.switchCompressionModel',
  switch_model: 'contextBudget.action.switchModel',
  truncate_tool_results: 'contextBudget.action.truncateToolResults',
};

const HINT_KEYS = {
  detachAttachments: 'contextBudget.hint.detachAttachments',
  forkTopic: 'contextBudget.hint.forkTopic',
  shortenMessage: 'contextBudget.hint.shortenMessage',
  switchCompressionModel: 'contextBudget.hint.switchCompressionModel',
  switchModel: 'contextBudget.hint.switchModel',
  truncateToolResults: 'contextBudget.hint.truncateToolResults',
} as const;

const WINDOW_SOURCE_LABEL_KEYS: Record<string, ContextBudgetTranslationKey> = {
  assumed: 'contextBudget.diagnostics.windowSource.assumed',
  manual: 'contextBudget.diagnostics.windowSource.manual',
  observed: 'contextBudget.diagnostics.windowSource.observed',
};

/**
 * The contract action that most directly resolves the dominant offending source. Message text has
 * no button of its own (the hint says "shorten"), so a larger-window model is the one-click fix.
 */
const ACTION_FOR_SOURCE: Record<ContextBudgetOffendingSource, ContextBudgetAction> = {
  'attachment': 'detach_attachments',
  'system': 'switch_model',
  'text': 'switch_model',
  'tool-result': 'truncate_tool_results',
  'tools': 'switch_model',
};

const HINT_FOR_SOURCE: Record<ContextBudgetOffendingSource, ContextBudgetTranslationKey> = {
  'attachment': HINT_KEYS.detachAttachments,
  'system': HINT_KEYS.switchModel,
  'text': HINT_KEYS.shortenMessage,
  'tool-result': HINT_KEYS.truncateToolResults,
  'tools': HINT_KEYS.switchModel,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeIdentifier = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_IDENTIFIER_LENGTH ? trimmed.slice(0, MAX_IDENTIFIER_LENGTH) : trimmed;
};

const sanitizeCount = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
};

const sanitizeAttempt = (value: unknown): CompressionAttempt | undefined => {
  if (value === 0 || value === 1) return value;
  return undefined;
};

const uniqueInOrder = <T>(items: readonly T[]): T[] => [...new Set(items)];

const moveToFront = <T>(items: readonly T[], first?: T): T[] =>
  first === undefined ? [...items] : [first, ...items.filter((item) => item !== first)];

const sanitizeFailDecision = (value: unknown): ContextBudgetFailDecision | undefined => {
  if (!isRecord(value) || value.kind !== 'fail') return undefined;
  if (!CONTEXT_BUDGET_FAIL_CODES.includes(value.code as ContextBudgetFailCode)) return undefined;

  const actions = uniqueInOrder(
    (Array.isArray(value.actions) ? value.actions : []).filter(
      (action): action is ContextBudgetAction =>
        typeof action === 'string' && CONTRACT_ACTIONS.includes(action as ContextBudgetAction),
    ),
  );

  const offending = (Array.isArray(value.offending) ? value.offending : []).flatMap((item) => {
    if (!isRecord(item)) return [];
    const estimatedTokens = sanitizeCount(item.estimatedTokens);
    const source = item.source;
    if (
      estimatedTokens === undefined ||
      typeof source !== 'string' ||
      !OFFENDING_SOURCES.includes(source as ContextBudgetOffendingSource)
    ) {
      return [];
    }
    // Ids and counts only: message ids are intentionally not carried into the view model.
    return [{ estimatedTokens, source: source as ContextBudgetOffendingSource }];
  });

  return { actions, code: value.code as ContextBudgetFailCode, kind: 'fail', offending };
};

const sanitizeDiagnostics = (value: unknown): ContextBudgetDiagnosticsInput | undefined => {
  if (!isRecord(value)) return undefined;

  const warnings = (Array.isArray(value.warnings) ? value.warnings : []).filter(
    (warning): warning is string => warning === WINDOW_UNKNOWN_WARNING,
  );

  const diagnostics: ContextBudgetDiagnosticsInput = {
    attempt: sanitizeAttempt(value.attempt),
    effectiveWindowSource: sanitizeIdentifier(value.effectiveWindowSource),
    effectiveWindowTokens: sanitizeCount(value.effectiveWindowTokens),
    estimatedPromptTokens: sanitizeCount(value.estimatedPromptTokens),
    modelId: sanitizeIdentifier(value.modelId),
    operationId: sanitizeIdentifier(value.operationId),
    providerId: sanitizeIdentifier(value.providerId),
    warnings: warnings.length > 0 ? uniqueInOrder(warnings) : undefined,
  };

  const present = Object.fromEntries(
    Object.entries(diagnostics).filter(([, field]) => field !== undefined),
  ) as ContextBudgetDiagnosticsInput;

  return Object.keys(present).length > 0 ? present : undefined;
};

/**
 * Extract the typed failure the runtime attached to a chat message error.
 *
 * Accepts `body.contextBudget = { decision, trace }`, the same fields spread directly
 * onto the body, and the short-lived legacy shape where `contextBudget` was the decision.
 * Returns `undefined` for legacy errors so callers keep the generic exceeded-context fallback.
 */
export const getContextBudgetFailureFromErrorBody = (
  body: unknown,
): ContextBudgetFailurePayload | undefined => {
  if (!isRecord(body)) return undefined;

  const container = isRecord(body.contextBudget) ? body.contextBudget : body;
  const decision = sanitizeFailDecision(container.decision ?? container);
  if (!decision) return undefined;

  const trace = sanitizeDiagnostics(container.trace);
  return trace ? { decision, trace } : { decision };
};

const getLargestSource = (
  decision: ContextBudgetFailDecision,
): ContextBudgetLargestSource | undefined => {
  let largest: ContextBudgetLargestSource | undefined;
  for (const item of decision.offending) {
    if (!largest || item.estimatedTokens > largest.estimatedTokens) {
      largest = {
        estimatedTokens: item.estimatedTokens,
        labelKey: SOURCE_LABEL_KEYS[item.source],
        source: item.source,
      };
    }
  }
  return largest;
};

const getDominantSources = (decision: ContextBudgetFailDecision): ContextBudgetSourceShare[] => {
  const totals = new Map<ContextBudgetOffendingSource, number>();
  for (const item of decision.offending) {
    totals.set(item.source, (totals.get(item.source) ?? 0) + item.estimatedTokens);
  }
  const total = [...totals.values()].reduce((sum, tokens) => sum + tokens, 0);

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_DOMINANT_SOURCES)
    .map(([source, estimatedTokens]) => ({
      estimatedTokens,
      labelKey: SOURCE_LABEL_KEYS[source],
      share: total > 0 ? estimatedTokens / total : 0,
      source,
    }));
};

const buildDiagnostics = (payload: ContextBudgetFailurePayload): ContextBudgetDiagnosticsView => {
  const trace = payload.trace ?? {};
  const dominantSources = getDominantSources(payload.decision);
  const windowSource = trace.effectiveWindowSource;
  const windowUnknown =
    windowSource === 'assumed' || (trace.warnings ?? []).includes(WINDOW_UNKNOWN_WARNING);

  const hasDiagnostics =
    dominantSources.length > 0 ||
    [
      trace.attempt,
      trace.effectiveWindowTokens,
      trace.estimatedPromptTokens,
      trace.modelId,
      trace.providerId,
    ].some((field) => field !== undefined);

  return {
    attempt: trace.attempt,
    attemptLimit: 1,
    dominantSources,
    estimatedPromptTokens: trace.estimatedPromptTokens,
    hasDiagnostics,
    modelId: trace.modelId,
    operationId: trace.operationId,
    providerId: trace.providerId,
    windowSource,
    windowSourceLabelKey: windowSource ? WINDOW_SOURCE_LABEL_KEYS[windowSource] : undefined,
    windowTokens: trace.effectiveWindowTokens,
    windowUnknown,
  };
};

interface MatrixAction {
  disabled: boolean;
  disabledReasonKey?: ContextBudgetTranslationKey;
  id: ContextBudgetUIAction;
}

const enabled = (id: ContextBudgetUIAction): MatrixAction => ({ disabled: false, id });

/**
 * Strict per-code action matrix (spec §8.3):
 * - TAIL_TOO_LARGE: remove attachments / larger-window model / new branch; the action matching the
 *   largest source leads, and tool-result truncation is offered only when a tool result is largest.
 * - NO_CANDIDATES: "compress again" is visible but disabled; truncate / detach / model / branch.
 * - SUMMARY_FAILED: retry the summary or change the compression model; model / branch.
 * - RETRY_EXHAUSTED: model / branch only, never another compression.
 */
const getActionMatrix = (
  decision: ContextBudgetFailDecision,
  largestSource?: ContextBudgetOffendingSource,
): MatrixAction[] => {
  const offered = new Set<ContextBudgetAction>(decision.actions);
  const contractActions = (order: readonly ContextBudgetAction[]) =>
    order.filter((action) => offered.has(action)).map(enabled);

  switch (decision.code) {
    case 'DUPLICATE_REQUEST': {
      return [];
    }
    case 'TAIL_TOO_LARGE': {
      const base: ContextBudgetAction[] = ['detach_attachments', 'switch_model', 'fork_topic'];
      if (largestSource === 'tool-result') base.unshift('truncate_tool_results');
      return contractActions(
        moveToFront(base, largestSource ? ACTION_FOR_SOURCE[largestSource] : undefined),
      );
    }
    case 'NO_CANDIDATES': {
      return [
        {
          disabled: true,
          disabledReasonKey: 'contextBudget.action.retryCompressionUnavailable',
          id: 'retry_compression',
        },
        ...contractActions([
          'truncate_tool_results',
          'detach_attachments',
          'switch_model',
          'fork_topic',
        ]),
      ];
    }
    case 'SUMMARY_FAILED': {
      return [
        enabled('retry_compression'),
        enabled('switch_compression_model'),
        ...contractActions(['switch_model', 'fork_topic']),
      ];
    }
    case 'RETRY_EXHAUSTED': {
      return contractActions(['switch_model', 'fork_topic']);
    }
  }
};

const getHintKeys = (
  code: ContextBudgetFailCode,
  largestSource?: ContextBudgetOffendingSource,
): ContextBudgetTranslationKey[] => {
  switch (code) {
    case 'DUPLICATE_REQUEST': {
      return [];
    }
    case 'TAIL_TOO_LARGE': {
      return moveToFront(
        [
          HINT_KEYS.detachAttachments,
          HINT_KEYS.shortenMessage,
          HINT_KEYS.switchModel,
          HINT_KEYS.forkTopic,
        ],
        largestSource ? HINT_FOR_SOURCE[largestSource] : undefined,
      );
    }
    case 'NO_CANDIDATES': {
      return [
        HINT_KEYS.truncateToolResults,
        HINT_KEYS.detachAttachments,
        HINT_KEYS.switchModel,
        HINT_KEYS.forkTopic,
      ];
    }
    case 'SUMMARY_FAILED': {
      return [HINT_KEYS.switchCompressionModel, HINT_KEYS.switchModel, HINT_KEYS.forkTopic];
    }
    case 'RETRY_EXHAUSTED': {
      return [HINT_KEYS.switchModel, HINT_KEYS.forkTopic];
    }
  }
};

const NOTE_KEYS: Partial<Record<ContextBudgetFailCode, ContextBudgetTranslationKey>> = {
  RETRY_EXHAUSTED: 'contextBudget.note.autoRetryStopped',
  SUMMARY_FAILED: 'contextBudget.note.originalsPreserved',
};

/** RETRY_EXHAUSTED means history was already compressed once, so "untouched" would be a false claim. */
const ORIGINALS_PRESERVED: Record<ContextBudgetFailCode, boolean> = {
  DUPLICATE_REQUEST: true,
  NO_CANDIDATES: true,
  RETRY_EXHAUSTED: false,
  SUMMARY_FAILED: true,
  TAIL_TOO_LARGE: true,
};

export const buildContextBudgetErrorViewModel = (
  payload: ContextBudgetFailurePayload,
  options: BuildContextBudgetErrorViewModelOptions = {},
): ContextBudgetErrorViewModel => {
  const { decision } = payload;
  const largestSource = getLargestSource(decision);
  const available = options.availableActions ? new Set(options.availableActions) : undefined;
  const disabledActions = new Set(options.disabledActions ?? []);

  const actions = getActionMatrix(decision, largestSource?.source)
    // A purposely disabled action stays visible so the user learns it will not help.
    .filter((action) => action.disabled || !available || available.has(action.id))
    .map<ContextBudgetErrorActionView>((action) => ({
      disabled: action.disabled || disabledActions.has(action.id),
      disabledReasonKey: action.disabledReasonKey,
      id: action.id,
      labelKey: ACTION_LABEL_KEYS[action.id],
      primary: false,
    }));

  const primary = actions.find((action) => !action.disabled);
  if (primary) primary.primary = true;

  return {
    actions,
    allowsAutoRetry: false,
    code: decision.code,
    descKey: `contextBudget.desc.${decision.code}`,
    diagnostics: buildDiagnostics(payload),
    hintKeys: getHintKeys(decision.code, largestSource?.source),
    largestSource,
    noteKey: NOTE_KEYS[decision.code],
    originalMessagesPreserved: ORIGINALS_PRESERVED[decision.code],
    titleKey: `contextBudget.title.${decision.code}`,
  };
};

export type ContextRecoveryPresentation =
  | { kind: 'progress' }
  | { failure: ContextBudgetFailurePayload; kind: 'error' }
  | { kind: 'none' };

/**
 * While automatic compression is still running only the non-blocking progress is shown, even if a
 * stale failure is attached. Once it finishes, a success leaves nothing behind but the compressed
 * group and the answer; only a terminal failure yields the error card.
 */
export const resolveContextRecoveryPresentation = ({
  failure,
  isCompressing,
}: {
  failure?: ContextBudgetFailurePayload | null;
  isCompressing: boolean;
}): ContextRecoveryPresentation => {
  if (isCompressing) return { kind: 'progress' };
  if (failure) return { failure, kind: 'error' };
  return { kind: 'none' };
};
