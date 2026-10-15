import type { ChatMessageError } from '@lobechat/types';

export interface StreamRecoveryState {
  attempt: number;
  delayMs: number;
  maxAttempts: number;
  offline: boolean;
}

export interface StreamRecoveryOptions {
  delayMs?: number;
  /** At most three attempts of this model call, never a replay of the agent run. */
  maxAttempts?: number;
  onAttemptReset?: () => Promise<void> | void;
  onRetry?: (state: StreamRecoveryState) => Promise<void> | void;
}

export const getRetryDelay = (error: ChatMessageError, response?: Response): number | undefined => {
  const body = error.body as
    | {
        name?: string;
        reason?: string;
        retryable?: boolean;
        retryAfterMs?: number;
        error?: {
          code?: string;
          status?: number;
          statusCode?: number;
          message?: string;
          cause?: { code?: string; status?: number };
        };
      }
    | undefined;
  const upstream = body?.error;
  const status =
    upstream?.status ?? upstream?.statusCode ?? upstream?.cause?.status ?? response?.status;
  if (/quota|balance|billing|deactivated/i.test(String(error.type))) return;
  // The route classifies pre-response errors using the same policy as its retry wrapper.
  if (body?.retryable === false) return;
  if (body?.retryAfterMs !== undefined)
    return Number.isFinite(body.retryAfterMs) &&
      body.retryAfterMs >= 0 &&
      body.retryAfterMs <= 30_000
      ? body.retryAfterMs
      : undefined;
  if (status === 429) {
    // A quota error may also use 429. Only a bounded Retry-After proves temporary rate limiting.
    const value = response?.headers.get('retry-after');
    if (!value) return;
    const delay = /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now();
    return Number.isFinite(delay) && delay >= 0 && delay <= 30_000 ? delay : undefined;
  }
  if (body?.retryable === true) return 0;
  if (status !== undefined && [400, 401, 403, 413].includes(status)) return;
  if ([502, 503, 504].includes(Number(error.type)) || [502, 503, 504].includes(status ?? 0))
    return 0;
  if (body?.reason === 'unexpected_end') return 0;
  if (
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'UND_ERR_SOCKET',
      'UPSTREAM_FIRST_BYTE_TIMEOUT',
    ].includes(upstream?.code ?? upstream?.cause?.code ?? '')
  )
    return 0;
  if (
    /connection reset|connect timeout|headers timeout|socket hang up|upstream first byte timeout/i.test(
      upstream?.message ?? '',
    )
  )
    return 0;
  if (error.type === 'UnknownChatFetchError' && body?.name === 'TypeError') return 0;
};

/** Backoff and offline recovery are interruptible; no request is sent while offline. */
export const waitForStreamRetry = async (delayMs: number, signal?: AbortSignal | null) => {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      signal?.addEventListener('abort', finish, { once: true });
      if (signal?.aborted) finish();
    });
  await sleep(delayMs);
  const deadline = Date.now() + 30_000;
  while (!signal?.aborted && typeof navigator !== 'undefined' && !navigator.onLine) {
    if (Date.now() >= deadline) return false;
    await sleep(250);
  }
  return !signal?.aborted;
};
