import { LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID, MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { parseToolCalls } from '@lobechat/model-runtime';
import type {
  ChatImageChunk,
  ChatMessageError,
  GroundingSearch,
  MessageToolCall,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
  ResponseAnimation,
  ResponseAnimationStyle,
} from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { nanoid } from '@lobechat/utils/uuid';
import { t } from 'i18next';

import { getMessageError } from './parseError';
import { getRetryDelay, type StreamRecoveryOptions, waitForStreamRetry } from './recovery';

type SSEFinishType = 'done' | 'error' | 'abort' | string;

export type OnFinishHandler = (
  text: string,
  context: {
    grounding?: GroundingSearch;
    images?: ChatImageChunk[];
    observationId?: string | null;
    reasoning?: ModelReasoning;
    speed?: ModelPerformance;
    toolCalls?: MessageToolCall[];
    traceId?: string | null;
    type?: SSEFinishType;
    usage?: ModelUsage;
  },
) => Promise<void>;

export interface MessageUsageChunk {
  type: 'usage';
  usage: ModelUsage;
}

export interface MessageSpeedChunk {
  speed: ModelPerformance;
  type: 'speed';
}

export interface MessageTextChunk {
  text: string;
  type: 'text';
}
export interface MessageStopChunk {
  reason: string;
  type: 'stop';
}

export interface MessageBase64ImageChunk {
  id: string;
  image: ChatImageChunk;
  images: ChatImageChunk[];
  type: 'base64_image';
}

export interface MessageReasoningChunk {
  signature?: string;
  text?: string;
  type: 'reasoning';
}

export interface MessageGroundingChunk {
  grounding: GroundingSearch;
  type: 'grounding';
}

export interface MessageReasoningPartChunk {
  content: string;
  mimeType?: string;
  partType: 'text' | 'image';
  thoughtSignature?: string;
  type: 'reasoning_part';
}

export interface MessageContentPartChunk {
  content: string;
  mimeType?: string;
  partType: 'text' | 'image';
  thoughtSignature?: string;
  type: 'content_part';
}

interface MessageToolCallsChunk {
  isAnimationActives?: boolean[];
  tool_calls: MessageToolCall[];
  type: 'tool_calls';
}

export interface FetchSSERequestContext {
  apiMode?: string;
  fetchOnClient?: boolean;
  model?: string;
  provider?: string;
}

export interface FetchSSEOptions {
  fetcher?: typeof fetch;
  onAbort?: (text: string) => Promise<void>;
  onErrorHandle?: (error: ChatMessageError) => Promise<void> | void;
  onFinish?: OnFinishHandler;
  onMessageHandle?: (
    chunk:
      | MessageTextChunk
      | MessageToolCallsChunk
      | MessageReasoningChunk
      | MessageReasoningPartChunk
      | MessageContentPartChunk
      | MessageGroundingChunk
      | MessageUsageChunk
      | MessageBase64ImageChunk
      | MessageSpeedChunk
      | MessageStopChunk,
  ) => void;
  recovery?: StreamRecoveryOptions;
  requestContext?: FetchSSERequestContext;
  requireTerminalEvent?: boolean;
  responseAnimation?: ResponseAnimation;
}

const START_ANIMATION_SPEED = 10; // Default starting speed

const createSmoothMessage = (params: {
  onTextUpdate: (delta: string, text: string) => void;
  startSpeed?: number;
}) => {
  const { startSpeed = START_ANIMATION_SPEED } = params;

  let buffer = '';
  const outputQueue: string[] = [];
  let isAnimationActive = false;
  let animationFrameId: number | null = null;
  let lastFrameTime = 0;
  let accumulatedTime = 0;
  let currentSpeed = startSpeed;
  let lastQueueLength = 0; // Record the queue length from the previous frame

  const stopAnimation = () => {
    isAnimationActive = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const startAnimation = (speed = startSpeed) => {
    return new Promise<void>((resolve) => {
      if (isAnimationActive) {
        resolve();
        return;
      }

      isAnimationActive = true;
      lastFrameTime = performance.now();
      accumulatedTime = 0;
      currentSpeed = speed;
      lastQueueLength = 0; // Reset previous frame queue length

      const updateText = (timestamp: number) => {
        if (!isAnimationActive) {
          if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
          }
          resolve();
          return;
        }

        const frameDuration = timestamp - lastFrameTime;
        lastFrameTime = timestamp;
        accumulatedTime += frameDuration;

        let charsToProcess = 0;
        if (outputQueue.length > 0) {
          // Smoother speed adjustment
          const targetSpeed = Math.max(speed, outputQueue.length);
          // Adjust speed change rate based on queue length changes
          const speedChangeRate = Math.abs(outputQueue.length - lastQueueLength) * 0.0008 + 0.005;
          currentSpeed += (targetSpeed - currentSpeed) * speedChangeRate;

          charsToProcess = Math.floor((accumulatedTime * currentSpeed) / 1000);
        }

        if (charsToProcess > 0) {
          accumulatedTime -= (charsToProcess * 1000) / currentSpeed;

          const actualChars = Math.min(charsToProcess, outputQueue.length);
          // actualChars = Math.min(speed, actualChars); // Speed upper limit

          // if (actualChars * 2 < outputQueue.length && /[\dA-Za-z]/.test(outputQueue[actualChars])) {
          //   actualChars *= 2;
          // }

          const charsToAdd = outputQueue.splice(0, actualChars).join('');
          buffer += charsToAdd;
          params.onTextUpdate(charsToAdd, buffer);
        }

        lastQueueLength = outputQueue.length; // Update previous frame queue length

        if (outputQueue.length > 0 && isAnimationActive) {
          animationFrameId = requestAnimationFrame(updateText);
        } else {
          isAnimationActive = false;
          animationFrameId = null;
          resolve();
        }
      };

      animationFrameId = requestAnimationFrame(updateText);
    });
  };

  const pushToQueue = (text: string) => {
    outputQueue.push(...text.split(''));
  };

  const flushQueue = () => {
    if (outputQueue.length === 0) return;
    const remaining = outputQueue.splice(0).join('');
    buffer += remaining;
    params.onTextUpdate(remaining, buffer);
  };

  return {
    flushQueue,
    isAnimationActive,
    isTokenRemain: () => outputQueue.length > 0,
    pushToQueue,
    startAnimation,
    stopAnimation,
  };
};

export const standardizeAnimationStyle = (
  animationStyle?: ResponseAnimation,
): Exclude<ResponseAnimation, ResponseAnimationStyle> => {
  return typeof animationStyle === 'object' ? animationStyle : { text: animationStyle };
};

/**
 * Fetch data using stream method
 */

const fetchSSEAttempt = async (url: string, options: RequestInit & FetchSSEOptions = {}) => {
  let toolCalls: undefined | MessageToolCall[];
  let triggerOnMessageHandler = false;

  let finishedType: SSEFinishType = 'done';
  let response!: Response;
  let sawTerminalEvent = false;
  const fetchStartTime = Date.now();

  const { text, speed: smoothingSpeed } = standardizeAnimationStyle(
    options.responseAnimation ?? {},
  );
  const shouldSkipTextProcessing = text === 'none';
  const textSmoothing = text === 'smooth';

  // Add text buffer and timer related variables
  let textBuffer = '';
  let bufferTimer: ReturnType<typeof setTimeout> | null = null;
  const BUFFER_INTERVAL = 300; // 300ms

  const flushTextBuffer = () => {
    if (textBuffer) {
      options.onMessageHandle?.({ text: textBuffer, type: 'text' });
      textBuffer = '';
    }
  };

  let output = '';
  const textController = createSmoothMessage({
    onTextUpdate: (delta, text) => {
      output = text;
      options.onMessageHandle?.({ text: delta, type: 'text' });
    },
    startSpeed: smoothingSpeed,
  });

  let thinking = '';
  let thinkingSignature: string | undefined;

  const thinkingController = createSmoothMessage({
    onTextUpdate: (delta, text) => {
      thinking = text;
      options.onMessageHandle?.({ text: delta, type: 'reasoning' });
    },
    startSpeed: smoothingSpeed,
  });

  let thinkingBuffer = '';
  let thinkingBufferTimer: ReturnType<typeof setTimeout> | null = null;

  // Create a function to handle buffer flushing
  const flushThinkingBuffer = () => {
    if (thinkingBuffer) {
      options.onMessageHandle?.({ text: thinkingBuffer, type: 'reasoning' });
      thinkingBuffer = '';
    }
  };

  let grounding: GroundingSearch | undefined = undefined;
  let usage: ModelUsage | undefined = undefined;
  const images: ChatImageChunk[] = [];
  let speed: ModelPerformance | undefined = undefined;

  await fetchEventSource(url, {
    body: options.body,
    fetch: options?.fetcher,
    headers: options.headers as Record<string, string>,
    method: options.method,
    onerror: async (error) => {
      if (error === MESSAGE_CANCEL_FLAT || (error as TypeError).name === 'AbortError') {
        finishedType = 'abort';
        await options?.onAbort?.(output);
        textController.stopAnimation();
      } else {
        // The model already confirmed completion. Losing only the trailing
        // transport/usage frame must not replay a completed generation.
        if (
          sawTerminalEvent &&
          finishedType === 'done' &&
          error?.name === 'TypeError' &&
          /fetch|network|load failed|connection|terminated/i.test(error.message)
        )
          return;
        finishedType = 'error';

        const elapsedMs = Date.now() - fetchStartTime;
        const networkStatus = typeof navigator !== 'undefined' ? navigator.onLine : undefined;

        const contextBody = {
          ...options.requestContext,
          elapsedMs,
          networkStatus,
        };

        await options.onErrorHandle?.(
          error.type
            ? error
            : {
                body: {
                  message: error.message,
                  name: error.name,
                  ...contextBody,
                },
                message: error.message,
                type: ChatErrorType.UnknownChatFetchError,
              },
        );
        return;
      }
    },
    onmessage: (ev) => {
      if (options.signal?.aborted || finishedType === 'error' || finishedType === 'abort') return;
      triggerOnMessageHandler = true;
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        finishedType = 'error';
        console.warn('parse error:', e);
        options.onErrorHandle?.({
          body: {
            context: {
              chunk: ev.data,
              error: { message: (e as Error).message, name: (e as Error).name },
            },
            message:
              'chat response streaming chunk parse error, please contact your API Provider to fix it.',
          },
          message: 'parse error',
          type: 'StreamChunkError',
        });

        return;
      }

      switch (ev.event) {
        case 'error': {
          finishedType = 'error';
          options.onErrorHandle?.(data);
          break;
        }

        case 'base64_image': {
          const id = 'tmp_img_' + nanoid();
          const item = { data, id, isBase64: true };
          images.push(item);

          options.onMessageHandle?.({ id, image: item, images, type: 'base64_image' });
          break;
        }

        case 'text': {
          // skip empty text
          if (!data) break;

          if (shouldSkipTextProcessing) {
            output += data;
            options.onMessageHandle?.({ text: data, type: 'text' });
          } else if (textSmoothing) {
            textController.pushToQueue(data);

            if (!textController.isAnimationActive) textController.startAnimation();
          } else {
            output += data;

            // Use buffer mechanism
            textBuffer += data;

            // If timer not set yet, create one
            if (!bufferTimer) {
              bufferTimer = setTimeout(() => {
                flushTextBuffer();
                bufferTimer = null;
              }, BUFFER_INTERVAL);
            }
          }

          break;
        }

        case 'usage': {
          usage = data;
          options.onMessageHandle?.({ type: 'usage', usage: data });
          break;
        }

        case 'speed': {
          speed = data;
          options.onMessageHandle?.({ speed: data, type: 'speed' });
          break;
        }

        case 'grounding': {
          grounding = data;
          options.onMessageHandle?.({ grounding: data, type: 'grounding' });
          break;
        }

        case 'reasoning_signature': {
          thinkingSignature = data;
          break;
        }

        case 'stop': {
          sawTerminalEvent = true;
          if (data === 'abort') finishedType = 'abort';
          if (['length', 'max_tokens', 'MAX_TOKENS', 'content_filter', 'SAFETY'].includes(data)) {
            finishedType = 'error';
            options.onErrorHandle?.({
              body: { reason: data },
              message:
                data === 'content_filter' || data === 'SAFETY'
                  ? t('streamProviderBlocked', {
                      ns: 'error',
                      defaultValue:
                        'Generation was blocked by the provider. Please adjust your request.',
                    })
                  : t('streamOutputLimit', {
                      ns: 'error',
                      defaultValue:
                        'Generation reached the output limit before completing. Please shorten the request or increase the output limit.',
                    }),
              type: 'StreamChunkError',
            });
          }
          options.onMessageHandle?.({ reason: data, type: 'stop' });
          break;
        }

        case 'reasoning': {
          if (textSmoothing) {
            thinkingController.pushToQueue(data);

            if (!thinkingController.isAnimationActive) thinkingController.startAnimation();
          } else {
            thinking += data;

            // Use buffer mechanism
            thinkingBuffer += data;

            // If timer not set yet, create one
            if (!thinkingBufferTimer) {
              thinkingBufferTimer = setTimeout(() => {
                flushThinkingBuffer();
                thinkingBufferTimer = null;
              }, BUFFER_INTERVAL);
            }
          }

          break;
        }

        case 'reasoning_part': {
          // For reasoning_part, accumulate thinking content
          if (data.partType === 'text' && data.content) {
            thinking += data.content;
          }
          options.onMessageHandle?.({
            content: data.content,
            mimeType: data.mimeType,
            partType: data.partType,
            thoughtSignature: data.thoughtSignature,
            type: ev.event,
          });
          break;
        }

        case 'content_part': {
          // For content_part, accumulate text content to output
          // This is critical for Gemini 2.5 models which use content_part instead of text events
          if (data.partType === 'text' && data.content) {
            output += data.content;
          }
          options.onMessageHandle?.({
            content: data.content,
            mimeType: data.mimeType,
            partType: data.partType,
            thoughtSignature: data.thoughtSignature,
            type: ev.event,
          });
          break;
        }

        case 'tool_calls': {
          // get finial
          // if there is no tool calls, we should initialize the tool calls
          if (!toolCalls) toolCalls = [];
          toolCalls = parseToolCalls(toolCalls, data);
          options.onMessageHandle?.({ tool_calls: toolCalls, type: 'tool_calls' });
        }
      }
    },
    onopen: async (res) => {
      response = res.clone();
      // If not ok, it means there is a request error
      if (!response.ok) {
        throw await getMessageError(res);
      }
    },
    signal: options.signal,
  });

  // only call onFinish when response is available
  // so like abort, we don't need to call onFinish
  {
    textController.stopAnimation();
    thinkingController.stopAnimation();

    // Ensure all buffered data is processed
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      if (!options.signal?.aborted) flushTextBuffer();
    }

    if (thinkingBufferTimer) {
      clearTimeout(thinkingBufferTimer);
      if (!options.signal?.aborted) flushThinkingBuffer();
    }

    if (response?.ok) {
      const isEventStream = response.headers.get('content-type')?.includes('text/event-stream');
      if (
        options.requireTerminalEvent &&
        isEventStream &&
        !sawTerminalEvent &&
        finishedType === 'done'
      ) {
        finishedType = 'error';
        await options.onErrorHandle?.({
          message: t('streamInterrupted', {
            ns: 'error',
            defaultValue: 'The connection ended before generation completed. Please retry.',
          }),
          body: { reason: 'unexpected_end' },
          type: 'StreamChunkError',
        });
      }
      // if there is no onMessageHandler, we should call onHandleMessage first
      if (!triggerOnMessageHandler && finishedType === 'done') {
        output = await response.clone().text();
        options.onMessageHandle?.({ text: output, type: 'text' });
      }

      const traceId = response.headers.get(LOBE_CHAT_TRACE_ID);
      const observationId = response.headers.get(LOBE_CHAT_OBSERVATION_ID);

      if (!options.signal?.aborted) {
        textController.flushQueue();
        thinkingController.flushQueue();
      }

      await options?.onFinish?.(output, {
        grounding,
        images: images.length > 0 ? images : undefined,
        observationId,
        reasoning: !!thinking ? { content: thinking, signature: thinkingSignature } : undefined,
        speed,
        toolCalls,
        traceId,
        type: finishedType,
        usage,
      });
    }
  }

  return response;
};

/** Keep recovery inside a single model call; errors are committed only after its budget is spent. */
export const fetchSSE = async (url: string, options: RequestInit & FetchSSEOptions = {}) => {
  const maxAttempts = options.recovery
    ? Math.max(1, Math.min(3, options.recovery.maxAttempts ?? 3))
    : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      await options.onFinish?.('', { type: 'abort' });
      return undefined;
    }
    let error: ChatMessageError | undefined;
    let finish: Parameters<OnFinishHandler> | undefined;
    let mediaDelivered = false;
    const response = await fetchSSEAttempt(url, {
      ...options,
      headers: options.recovery
        ? {
            ...Object.fromEntries(new Headers(options.headers).entries()),
            'X-Masterino-Client-Recovery': '1',
          }
        : options.headers,
      onErrorHandle: (value) => {
        error = value;
      },
      onFinish: async (...args) => {
        finish = args;
      },
      onMessageHandle: (chunk) => {
        if (options.signal?.aborted) return;
        if (
          chunk.type === 'base64_image' ||
          chunk.type === 'content_part' ||
          chunk.type === 'reasoning_part'
        )
          mediaDelivered = true;
        options.onMessageHandle?.(chunk);
      },
    });
    const delay = error && getRetryDelay(error, response);
    if (
      error &&
      options.recovery &&
      attempt < maxAttempts &&
      delay !== undefined &&
      !mediaDelivered &&
      !options.signal?.aborted
    ) {
      const delayMs = Math.max(
        delay,
        options.recovery.delayMs ?? (attempt === 1 ? 1000 : 3000) + Math.floor(Math.random() * 250),
      );
      await options.recovery.onRetry?.({
        attempt,
        delayMs,
        maxAttempts,
        offline: typeof navigator !== 'undefined' && !navigator.onLine,
      });
      if (await waitForStreamRetry(delayMs, options.signal)) {
        await options.recovery.onAttemptReset?.();
        continue;
      }
    }
    if (options.signal?.aborted) {
      await options.onFinish?.(finish?.[0] ?? '', { ...finish?.[1], type: 'abort' });
      return response;
    }
    if (error) await options.onErrorHandle?.(error);
    if (finish) await options.onFinish?.(...finish);
    return response;
  }
};
