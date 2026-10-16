import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserMemoryEmbeddingRuntime } from '../embedding';
import { embedUserMemoryTexts, resolveEmbeddingInputLimit } from '../embedding';

const mocks = vi.hoisted(() => ({
  agentExecutionEnv: { MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT: 3 },
  encodeAsync: vi.fn(async (text: string) => text.split(/\s+/).filter(Boolean).length),
  trimBasedOnBatchProbe: vi.fn(async (text: string, limit: number) =>
    text.split(/\s+/).filter(Boolean).slice(-limit).join(' '),
  ),
}));

vi.mock('@lobechat/env/agent', () => ({ agentExecutionEnv: mocks.agentExecutionEnv }));

vi.mock('@/utils/chunkers', () => ({
  trimBasedOnBatchProbe: mocks.trimBasedOnBatchProbe,
}));

vi.mock('@/utils/tokenizer', () => ({
  encodeAsync: mocks.encodeAsync,
}));

describe('resolveEmbeddingInputLimit', () => {
  it.each([
    [{ configuredLimit: 7500, contextWindowTokens: 8192 }, 7500],
    [{ configuredLimit: 100_000, contextWindowTokens: 128_000 }, 100_000],
    [{ configuredLimit: 1_800_000, contextWindowTokens: 2_000_000 }, 1_800_000],
    [{ configuredLimit: 10_000_000 }, 7500],
  ] as const)('resolves model-safe limit for %o', (input, expected) => {
    expect(resolveEmbeddingInputLimit(input).effectiveLimit).toBe(expected);
  });

  it('reserves eight percent or at least 512 tokens', () => {
    expect(
      resolveEmbeddingInputLimit({ configuredLimit: 100_000, contextWindowTokens: 8192 }),
    ).toMatchObject({ effectiveLimit: 7536, modelSafeInputLimit: 7536 });
  });
});

describe('embedUserMemoryTexts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trims each input and preserves output indexes', async () => {
    const runtime = {
      embeddings: vi.fn(async () => [
        Array.from({ length: 2048 }, () => 1),
        Array.from({ length: 2048 }, () => 2),
      ]),
    } satisfies UserMemoryEmbeddingRuntime;

    const result = await embedUserMemoryTexts({
      input: ['one two three four', '', null, 'short text'],
      model: 'text-embedding-3-large',
      provider: 'openai',
      runtime,
      source: 'test:source',
      userId: 'user-test',
    });

    expect(runtime.embeddings).toHaveBeenCalledWith(
      {
        dimensions: 2048,
        input: ['two three four', 'short text'],
        model: 'text-embedding-3-large',
      },
      {
        metadata: { trigger: 'memory' },
        signal: expect.any(AbortSignal),
        user: 'user-test',
      },
    );
    expect(result).toEqual([
      Array.from({ length: 2048 }, () => 1),
      undefined,
      undefined,
      Array.from({ length: 2048 }, () => 2),
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      '[user-memory] trimmed embedding input',
      expect.objectContaining({
        configuredLimit: 3,
        effectiveLimit: 3,
        model: 'text-embedding-3-large',
        originalTokens: 4,
        provider: 'openai',
        trimmedTokens: 3,
        userId: 'user-test',
      }),
    );
  });

  it('rejects an embedding output count mismatch', async () => {
    const runtime = {
      embeddings: vi.fn(async () => []),
    } satisfies UserMemoryEmbeddingRuntime;

    await expect(
      embedUserMemoryTexts({
        input: ['one two'],
        model: 'text-embedding-3-large',
        runtime,
        source: 'test:mismatch',
        userId: 'user-test',
      }),
    ).rejects.toThrow('Embedding output count mismatch');
  });

  it('rejects a wrong dimension or an empty vector from the gateway', async () => {
    const runtime = {
      embeddings: vi.fn(async () => [[1, 2, 3]]),
    } satisfies UserMemoryEmbeddingRuntime;
    const params = {
      input: ['one two'],
      model: 'text-embedding-3-large',
      runtime,
      source: 'test:dimension',
      userId: 'user-test',
    };

    await expect(embedUserMemoryTexts(params)).rejects.toThrow('expected 2048 finite values');
    runtime.embeddings.mockResolvedValueOnce([[]]);
    await expect(embedUserMemoryTexts(params)).rejects.toThrow('received 0');
  });

  it('rejects non-finite values and any model override', async () => {
    const runtime = {
      embeddings: vi.fn(async () => [Array.from({ length: 2048 }, () => Number.NaN)]),
    } satisfies UserMemoryEmbeddingRuntime;
    const params = {
      input: ['one two'],
      model: 'text-embedding-3-large',
      runtime,
      source: 'test:invalid',
      userId: 'user-test',
    };

    await expect(embedUserMemoryTexts(params)).rejects.toThrow('finite values');
    await expect(embedUserMemoryTexts({ ...params, model: 'glm-5.2' })).rejects.toThrow(
      'fixed model',
    );
    await expect(embedUserMemoryTexts({ ...params, dimensions: 1536 })).rejects.toThrow(
      '2048 dimensions',
    );
  });

  it('enforces the 120 second request deadline even if the runtime ignores abort', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const runtime = {
        embeddings: vi.fn((...args: unknown[]) => {
          signal = (args[1] as { signal: AbortSignal }).signal;
          return new Promise<number[][]>(() => {});
        }),
      } satisfies UserMemoryEmbeddingRuntime;
      const request = embedUserMemoryTexts({
        input: ['one two'],
        model: 'text-embedding-3-large',
        runtime,
        source: 'test:timeout',
        userId: 'user-test',
      });
      const result = expect(request).rejects.toThrow('exceeded 120 seconds');

      await vi.advanceTimersByTimeAsync(120_000);
      await result;
      expect(runtime.embeddings).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
