import { INBOX_SESSION_ID, LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamCallbacks, type ChatStreamPayload } from '@lobechat/model-runtime';
import { type TracePayload } from '@lobechat/types';
import { TraceTagMap } from '@lobechat/types';
import { after } from 'next/server';

import { TraceClient } from '@/libs/traces';

import { sanitizeTraceData } from './sanitizeTraceData';

export interface AgentChatOptions {
  enableTrace?: boolean;
  includeInput?: boolean;
  metadata?: Record<string, unknown>;
  provider: string;
  shutdownMode?: 'deferred' | 'immediate';
  trace?: TracePayload;
}

const normalizeModelParameters = (parameters: Record<string, unknown>) => {
  const normalized: Record<string, boolean | number | string | string[]> = {};

  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      normalized[key] = value.flatMap((item) => {
        if (typeof item === 'string') return [item];

        const serialized = JSON.stringify(item);
        return serialized ? [serialized] : [];
      });
      continue;
    }

    if (!value || typeof value !== 'object') continue;

    try {
      normalized[key] = JSON.stringify(value);
    } catch {
      // Ignore parameters that cannot be serialized rather than dropping the trace.
    }
  }

  return normalized;
};

export const createTraceOptions = (
  payload: ChatStreamPayload,
  {
    includeInput = true,
    metadata,
    trace: tracePayload,
    provider,
    shutdownMode = 'deferred',
  }: AgentChatOptions,
) => {
  const { messages, model, tools, ...parameters } = sanitizeTraceData(payload);
  // create a trace to monitor the completion
  const traceClient = new TraceClient();
  const messageLength = messages.length;
  const systemRole = messages.find((message) => message.role === 'system')?.content;

  const trace = traceClient.createTrace({
    id: tracePayload?.traceId,
    input: includeInput ? messages : undefined,
    metadata: {
      ...sanitizeTraceData(metadata),
      messageLength,
      model,
      provider,
      ...(includeInput ? { systemRole, tools } : {}),
    },
    name: tracePayload?.traceName,
    sessionId: tracePayload?.topicId
      ? tracePayload.topicId
      : `${tracePayload?.sessionId || INBOX_SESSION_ID}@default`,
    tags: tracePayload?.tags,
    userId: tracePayload?.userId,
  });

  const generation = trace?.generation({
    input: includeInput ? messages : undefined,
    metadata: { messageLength, model, provider },
    model,
    modelParameters: normalizeModelParameters(parameters),
    name: `Chat Completion (${provider})`,
    startTime: new Date(),
  });

  const headers = new Headers();
  let generationFinished = false;

  const finishGeneration = (update: Parameters<NonNullable<typeof generation>['update']>[0]) => {
    if (generationFinished) return;
    generationFinished = true;
    generation?.update(sanitizeTraceData({ endTime: new Date(), ...update }));
  };

  const getTimeoutMetadata = (error: unknown) => {
    if (!error || typeof error !== 'object') return undefined;

    const errorRecord = error as { body?: unknown; type?: unknown };
    const body =
      errorRecord.body && typeof errorRecord.body === 'object'
        ? (errorRecord.body as Record<string, unknown>)
        : undefined;

    if (errorRecord.type !== 'upstream_timeout' && body?.timeoutType !== 'upstream_total_timeout') {
      return undefined;
    }

    return {
      errorType: 'upstream_timeout',
      operationId: typeof body?.operationId === 'string' ? body.operationId : metadata?.operationId,
      timeoutType: 'upstream_total_timeout',
    };
  };

  if (trace?.id) {
    headers.set(LOBE_CHAT_TRACE_ID, trace.id);
  }

  if (generation?.id) {
    headers.set(LOBE_CHAT_OBSERVATION_ID, generation.id);
  }

  return {
    callback: {
      onCompletion: async ({ error, text, thinking, usage, grounding, toolsCalling }) => {
        if (getTimeoutMetadata(error)) return;

        const output =
          // if the toolsCalling is not empty, we need to return the toolsCalling
          !!toolsCalling && toolsCalling.length > 0
            ? !!text
              ? // tools calling with thinking and text
                { text, thinking, toolsCalling }
              : toolsCalling
            : !!thinking
              ? { text, thinking }
              : text;

        finishGeneration({
          metadata: { grounding, thinking },
          output,
          usage: usage
            ? {
                completionTokens: usage.outputTextTokens,
                input: usage.totalInputTokens,
                output: usage.totalOutputTokens,
                promptTokens: usage.inputTextTokens,
                totalTokens: usage.totalTokens,
              }
            : undefined,
        });

        trace?.update(sanitizeTraceData({ output }));
      },

      onError: async (error) => {
        const message =
          error && typeof error === 'object' && typeof error.message === 'string'
            ? error.message
            : 'Provider request failed';
        const output = { error: message };
        const timeoutMetadata = getTimeoutMetadata(error);

        finishGeneration({
          level: 'ERROR',
          ...(timeoutMetadata ? { metadata: timeoutMetadata } : {}),
          output,
          statusMessage: message,
        });
        trace?.update(
          sanitizeTraceData({ ...(timeoutMetadata ? { metadata: timeoutMetadata } : {}), output }),
        );
      },

      onFinal: trace
        ? async () => {
            const shutdown = async () => {
              try {
                await traceClient.shutdownAsync();
              } catch (e) {
                console.error('TraceClient shutdown error:', e);
              }
            };

            if (shutdownMode === 'immediate') {
              await shutdown();
              return;
            }

            after(shutdown);
          }
        : undefined,

      onStart: () => {
        generation?.update({ completionStartTime: new Date() });
      },

      onToolsCalling: async () => {
        trace?.update({
          tags: [...(tracePayload?.tags || []), TraceTagMap.ToolsCalling],
        });
      },
    } as ChatStreamCallbacks,
    headers,
  };
};
