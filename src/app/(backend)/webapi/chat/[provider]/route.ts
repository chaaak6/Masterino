import { randomUUID } from 'node:crypto';

import { parseExceededContextWindowError } from '@lobechat/agent-runtime';
import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { AiModelModel } from '@/database/models/aiModel';
import { getLangfuseConfig } from '@/envs/langfuse';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';
import { serializeProviderError } from './providerError';
import {
  callWithUpstreamTimeouts,
  getProviderRetryAfterMs,
  isRetryableProviderError,
  runWithTransientRetry,
} from './resilience';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

export const POST = checkAuth(async (req: Request, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;
  const inboundTracePayload = getTracePayload(req);
  const operationId = inboundTracePayload?.traceId || randomUUID();
  let traceOptions: ReturnType<typeof createTraceOptions> | undefined;
  let requestedModel: string | undefined;
  const recordedLimits = new Set<number>();
  const recordContextWindowRejection = async (error: unknown) => {
    const observed = parseExceededContextWindowError(error);
    if (!requestedModel || !observed?.observedLimitTokens) return;
    if (recordedLimits.has(observed.observedLimitTokens)) return;
    recordedLimits.add(observed.observedLimitTokens);
    try {
      await new AiModelModel(serverDB, userId).recordContextWindowRejection({
        contextWindowRejectionTokens: observed.observedLimitTokens,
        modelId: requestedModel,
        providerId: provider,
      });
    } catch (persistenceError) {
      console.warn('[context_window_evidence_failed]', {
        error: serializeProviderError(persistenceError),
        model: requestedModel,
        operationId,
        provider,
      });
    }
  };

  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // ============  1. init chat model   ============ //
    const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, workspaceId);

    // ============  2. create chat completion   ============ //

    const data = (await req.json()) as ChatStreamPayload;
    requestedModel = data.model;

    const { ENABLE_LANGFUSE } = getLangfuseConfig();
    if (inboundTracePayload?.enabled || ENABLE_LANGFUSE) {
      traceOptions = createTraceOptions(data, {
        metadata: { operationId },
        provider,
        trace: {
          ...inboundTracePayload,
          enabled: true,
          traceId: operationId,
          userId,
        },
      });
    }

    const responseHeaders = new Headers(traceOptions?.headers);
    responseHeaders.set('X-Request-ID', operationId);

    const execute = () =>
      callWithUpstreamTimeouts({
        operation: (signal, abortSignals) =>
          modelRuntime.chat(data, {
            ...traceOptions,
            abortSignals,
            callback: {
              ...traceOptions?.callback,
              onError: async (error) => {
                await recordContextWindowRejection(error);
                await traceOptions?.callback?.onError?.(error);
              },
            },
            headers: Object.fromEntries(responseHeaders.entries()),
            metadata: { operationId, provider },
            requestHeaders: { 'X-Request-ID': operationId },
            signal,
            user: userId,
          }),
        requestSignal: req.signal,
      });

    // A recovering client owns the three-attempt budget for this model call.
    // Avoid multiplying its retries by the provider's three attempts.
    return provider === 'newapi'
      ? await runWithTransientRetry({
          maxAttempts: req.headers.get('X-Masterino-Client-Recovery') === '1' ? 1 : 3,
          onRetry: (error, attempt, delayMs) =>
            console.warn('[newapi_retry]', {
              attempt,
              delayMs,
              error: serializeProviderError(error),
              operationId,
              provider,
            }),
          operation: execute,
          provider,
        })
      : await execute();
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;
    const safeError = serializeProviderError(error);
    const retryAfterMs = provider === 'newapi' ? getProviderRetryAfterMs(e) : undefined;

    await recordContextWindowRejection(error);
    await traceOptions?.callback?.onError?.({ ...safeError, operationId, provider });
    await traceOptions?.callback?.onFinal?.({} as any);

    const logMethod = AGENT_RUNTIME_ERROR_SET.has(errorType as string) ? 'warn' : 'error';
    // track the error at server side
    // eslint-disable-next-line no-console
    console[logMethod](`Route: [${provider}] ${errorType}:`, {
      error: safeError,
      operationId,
      provider,
    });

    return createErrorResponse(
      errorType,
      {
        error: safeError,
        ...res,
        provider,
        ...(provider === 'newapi' && {
          retryable: retryAfterMs !== undefined || isRetryableProviderError(e),
          ...(retryAfterMs !== undefined && { retryAfterMs }),
        }),
        requestId: operationId,
        traceId: operationId,
      },
      {
        headers: {
          'X-Request-ID': operationId,
          ...(retryAfterMs !== undefined && { 'Retry-After': String(retryAfterMs / 1000) }),
        },
      },
    );
  }
});
