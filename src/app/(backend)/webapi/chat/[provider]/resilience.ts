const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 45_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 300_000;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_FAILURE_WINDOW_MS = 30_000;
const CIRCUIT_OPEN_MS = 15_000;

const RETRYABLE_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'UPSTREAM_FIRST_BYTE_TIMEOUT',
]);
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

interface CircuitState {
  failures: number[];
  openUntil?: number;
}

interface RetryOptions<T> {
  maxAttempts?: number;
  now?: () => number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  operation: (attempt: number) => Promise<T>;
  provider: string;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

interface TimeoutOptions<T> {
  firstByteTimeoutMs?: number;
  operation: (
    signal: AbortSignal,
    sources: { requestSignal: AbortSignal; totalSignal: AbortSignal },
  ) => Promise<T>;
  requestSignal: AbortSignal;
  totalSignal?: AbortSignal;
}

const circuitStates = new Map<string, CircuitState>();

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const readStatus = (error: unknown): number | undefined => {
  const record = asRecord(error);
  const nested = asRecord(record?.error);
  const cause = asRecord(record?.cause);

  for (const value of [record?.status, record?.statusCode, nested?.status, cause?.status]) {
    if (typeof value === 'number') return value;
  }
};
const readCode = (error: unknown): string | undefined => {
  const record = asRecord(error);
  const nested = asRecord(record?.error);
  const cause = asRecord(record?.cause);

  for (const value of [record?.code, nested?.code, cause?.code]) {
    if (typeof value === 'string' && value) return value;
  }
};

export const isRetryableProviderError = (error: unknown) => {
  const status = readStatus(error);
  if (status !== undefined) return RETRYABLE_STATUSES.has(status);

  const code = readCode(error);
  if (code && RETRYABLE_CODES.has(code)) return true;

  const name = asRecord(error)?.name;
  if (name === 'AbortError') return false;

  const message = String(asRecord(error)?.message || '').toLowerCase();
  return (
    message.includes('connection reset') ||
    message.includes('connect timeout') ||
    message.includes('headers timeout') ||
    message.includes('socket hang up') ||
    message.includes('upstream first byte timeout')
  );
};

/** Only a short, explicit upstream rate-limit delay is safe to replay automatically. */
export const getProviderRetryAfterMs = (error: unknown): number | undefined => {
  if (readStatus(error) !== 429) return;
  const record = asRecord(error);
  const nested = asRecord(record?.error);
  for (const headers of [record?.headers, nested?.headers]) {
    const value =
      headers instanceof Headers
        ? headers.get('retry-after')
        : (asRecord(headers)?.['retry-after'] ?? asRecord(headers)?.['Retry-After']);
    if (typeof value !== 'string') continue;
    const delay = /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now();
    if (Number.isFinite(delay) && delay >= 0 && delay <= 30_000) return delay;
  }
};

export class UpstreamCircuitOpenError extends Error {
  code = 'UPSTREAM_CIRCUIT_OPEN';
  status = 503;

  constructor(provider: string) {
    super(`Provider circuit is temporarily open for ${provider}`);
    this.name = 'UpstreamCircuitOpenError';
  }
}

export class UpstreamFirstByteTimeoutError extends Error {
  code = 'UPSTREAM_FIRST_BYTE_TIMEOUT';
  status = 504;

  constructor() {
    super('Upstream first byte timeout');
    this.name = 'UpstreamFirstByteTimeoutError';
  }
}

const pruneFailures = (state: CircuitState, now: number) => {
  state.failures = state.failures.filter((time) => now - time <= CIRCUIT_FAILURE_WINDOW_MS);
  if (state.openUntil && state.openUntil <= now) state.openUntil = undefined;
};

const getCircuitState = (provider: string, now: number) => {
  const state = circuitStates.get(provider) || { failures: [] };
  pruneFailures(state, now);
  circuitStates.set(provider, state);
  return state;
};

const recordTransientFailure = (provider: string, now: number) => {
  const state = getCircuitState(provider, now);
  state.failures.push(now);
  if (state.failures.length >= CIRCUIT_FAILURE_THRESHOLD) state.openUntil = now + CIRCUIT_OPEN_MS;
};

const recordSuccess = (provider: string) => circuitStates.delete(provider);

export const resetProviderCircuitForTest = () => circuitStates.clear();

export const runWithTransientRetry = async <T>({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = Date.now,
  onRetry,
  operation,
  provider,
  random = Math.random,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}: RetryOptions<T>): Promise<T> => {
  const initialState = getCircuitState(provider, now());
  if (initialState.openUntil && initialState.openUntil > now()) {
    throw new UpstreamCircuitOpenError(provider);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation(attempt);
      recordSuccess(provider);
      return result;
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error)) throw error;
      if (attempt >= maxAttempts) break;

      const delayMs = Math.round(100 * 2 ** (attempt - 1) + random() * 100);
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  recordTransientFailure(provider, now());
  throw lastError;
};

export const callWithUpstreamTimeouts = async <T>({
  firstByteTimeoutMs = DEFAULT_FIRST_BYTE_TIMEOUT_MS,
  operation,
  requestSignal,
  totalSignal = AbortSignal.timeout(DEFAULT_TOTAL_TIMEOUT_MS),
}: TimeoutOptions<T>) => {
  const firstByteController = new AbortController();
  const timeout = setTimeout(
    () => firstByteController.abort(new UpstreamFirstByteTimeoutError()),
    firstByteTimeoutMs,
  );

  try {
    return await operation(
      AbortSignal.any([requestSignal, totalSignal, firstByteController.signal]),
      { requestSignal, totalSignal },
    );
  } catch (error) {
    if (firstByteController.signal.aborted && !requestSignal.aborted && !totalSignal.aborted) {
      throw new UpstreamFirstByteTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
