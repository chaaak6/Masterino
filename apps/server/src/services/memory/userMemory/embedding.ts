import { DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS } from '@lobechat/const';
import { agentExecutionEnv } from '@lobechat/env/agent';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { RequestTrigger } from '@lobechat/types';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { trimBasedOnBatchProbe } from '@/utils/chunkers';
import { encodeAsync } from '@/utils/tokenizer';

const UNKNOWN_MODEL_SAFE_LIMIT = 7500;
const warnedEmbeddingLimits = new Set<string>();

export class EmbeddingOutputCountMismatchError extends Error {
  constructor(expected: number, received: number) {
    super(`Embedding output count mismatch: expected ${expected}, received ${received}`);
    this.name = 'EmbeddingOutputCountMismatchError';
  }
}

export interface EmbeddingInputLimit {
  configuredLimit: number;
  effectiveLimit: number;
  modelContextWindow?: number;
  modelSafeInputLimit: number;
}

export const resolveEmbeddingInputLimit = ({
  configuredLimit,
  contextWindowTokens,
}: {
  configuredLimit: number;
  contextWindowTokens?: number;
}): EmbeddingInputLimit => {
  const modelSafeInputLimit = contextWindowTokens
    ? Math.max(1, contextWindowTokens - Math.max(512, Math.ceil(contextWindowTokens * 0.08)))
    : UNKNOWN_MODEL_SAFE_LIMIT;

  return {
    configuredLimit,
    effectiveLimit: Math.min(configuredLimit, modelSafeInputLimit),
    modelContextWindow: contextWindowTokens,
    modelSafeInputLimit,
  };
};

export const getEmbeddingInputLimit = (model: string, provider?: string): EmbeddingInputLimit => {
  const normalizedModel = model.toLowerCase();
  const normalizedProvider = provider?.toLowerCase();
  const embeddingModels = LOBE_DEFAULT_MODEL_LIST.filter(
    (item) => item.type === 'embedding' && item.id.toLowerCase() === normalizedModel,
  );
  const modelCard =
    embeddingModels.find(
      (item) => !normalizedProvider || item.providerId.toLowerCase() === normalizedProvider,
    ) ?? embeddingModels[0];
  const limit = resolveEmbeddingInputLimit({
    configuredLimit: agentExecutionEnv.MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT,
    contextWindowTokens: modelCard?.contextWindowTokens,
  });

  if (limit.configuredLimit > limit.modelSafeInputLimit) {
    const warningKey = [
      provider ?? 'unknown',
      model,
      limit.configuredLimit,
      limit.modelSafeInputLimit,
    ]
      .join(':')
      .toLowerCase();
    if (!warnedEmbeddingLimits.has(warningKey)) {
      warnedEmbeddingLimits.add(warningKey);
      console.warn('[user-memory] embedding input limit constrained by model capability', {
        configuredLimit: limit.configuredLimit,
        effectiveLimit: limit.effectiveLimit,
        model,
        modelContextWindow: limit.modelContextWindow,
        modelSafeInputLimit: limit.modelSafeInputLimit,
        provider,
      });
    }
  }

  return limit;
};

export interface UserMemoryEmbeddingRuntime {
  /**
   * Runtime embedding method used by memory-specific call sites.
   */
  embeddings: ModelRuntime['embeddings'];
}

/**
 * Options for embedding user-memory text with memory-specific trimming.
 */
export interface EmbedUserMemoryTextsParams {
  /**
   * Embedding dimension requested by the memory table schema.
   *
   * @default DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS
   */
  dimensions?: number;
  /**
   * User memory texts to embed. Empty values keep their output slot as `undefined`.
   */
  input: Array<string | null | undefined>;
  /**
   * Embedding model name passed to the runtime.
   */
  model: string;
  /** Operation id for diagnostics when memory work belongs to an agent operation. */
  operationId?: string;
  /** Provider id used to disambiguate model-bank capability metadata. */
  provider?: string;
  /**
   * Runtime that performs the provider request.
   */
  runtime: UserMemoryEmbeddingRuntime;
  /**
   * Stable call-site label used for trim diagnostics.
   */
  source: string;
  /**
   * User id passed to runtime billing/tracing metadata.
   */
  userId: string;
}

/**
 * Embeds user-memory text after applying the memory embedding context limit.
 *
 * Use when:
 * - User memory search, tools, or maintenance jobs call an embedding model
 * - Inputs may contain long chat/tool payloads or stored memory text
 *
 * Expects:
 * - `input` order must be meaningful to the caller
 * - `runtime.embeddings` returns vectors in request input order
 *
 * Returns:
 * - An output array with the same length as `input`
 * - `undefined` for empty values or values trimmed to empty text
 */
export const embedUserMemoryTexts = async (
  params: EmbedUserMemoryTextsParams,
): Promise<Array<number[] | undefined>> => {
  const inputLimit = getEmbeddingInputLimit(params.model, params.provider);
  const tokenLimit = inputLimit.effectiveLimit;
  const requests: Array<{ index: number; text: string }> = [];

  for (const [index, value] of params.input.entries()) {
    if (typeof value !== 'string') continue;

    const trimmedValue = value.trim();
    if (!trimmedValue) continue;

    const text = await trimBasedOnBatchProbe(trimmedValue, tokenLimit);
    const normalizedText = text.trim();
    if (!normalizedText) continue;

    const [originalTokens, trimmedTokens] = await Promise.all([
      encodeAsync(trimmedValue),
      encodeAsync(normalizedText),
    ]);

    if (trimmedTokens < originalTokens) {
      console.warn('[user-memory] trimmed embedding input', {
        configuredLimit: inputLimit.configuredLimit,
        effectiveLimit: inputLimit.effectiveLimit,
        model: params.model,
        modelContextWindow: inputLimit.modelContextWindow,
        operationId: params.operationId,
        originalTokens,
        provider: params.provider,
        source: params.source,
        trimmedTokens,
        userId: params.userId,
      });
    }

    requests.push({ index, text: normalizedText });
  }

  const outputs = params.input.map<number[] | undefined>(() => undefined);
  if (requests.length === 0) return outputs;

  const embeddings = await params.runtime.embeddings(
    {
      dimensions: params.dimensions ?? DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: requests.map((item) => item.text),
      model: params.model,
    },
    {
      metadata: { trigger: RequestTrigger.Memory },
      signal: AbortSignal.timeout(120_000),
      user: params.userId,
    },
  );

  if (!embeddings || embeddings.length !== requests.length) {
    throw new EmbeddingOutputCountMismatchError(requests.length, embeddings?.length ?? 0);
  }

  for (const [requestIndex, embeddingVector] of (embeddings ?? []).entries()) {
    const request = requests[requestIndex];
    if (!request || !embeddingVector) continue;

    outputs[request.index] = embeddingVector;
  }

  return outputs;
};
