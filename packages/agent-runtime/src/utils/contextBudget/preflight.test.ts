import type { UIChatMessage } from '@lobechat/types';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';
import { describe, expect, it } from 'vitest';

import { ASSUMED_CONTEXT_WINDOW_TOKENS, resolveEffectiveContextWindow } from './effectiveWindow';
import { evaluateContextBudget, partitionContextMessages } from './preflight';
import { parseExceededContextWindowError } from './providerError';

const message = (
  id: string,
  role: UIChatMessage['role'],
  tokens: number,
  content = '',
): UIChatMessage =>
  ({
    content,
    createdAt: 0,
    id,
    metadata: role === 'assistant' ? { usage: { totalOutputTokens: tokens } } : undefined,
    role,
    updatedAt: 0,
  }) as UIChatMessage;

const catalogSnapshot = (
  windowTokens = 128_000,
  entryOverrides: Partial<ModelCatalogSnapshot['entry']> = {},
): ModelCatalogSnapshot => ({
  capturedAt: '2026-09-03T00:00:00.000Z',
  entry: {
    abilitySources: {},
    contextWindowSource: 'catalog',
    contextWindowTokens: windowTokens,
    inputModalities: {
      audio: 'unknown',
      file: 'unknown',
      image: 'unknown',
      text: 'supported',
      video: 'unknown',
    },
    kind: 'chat',
    kindSource: 'catalog',
    modelId: 'model-a',
    providerId: 'provider-a',
    ...entryOverrides,
  },
  operationId: 'operation-a',
  version: 1,
});

const baseInput = {
  driftMultiplier: 1,
  modelId: 'model-a',
  operationId: 'operation-a',
  providerId: 'provider-a',
} as const;

describe('effective context window', () => {
  it('uses a conservative assumed 32k window and emits a trace warning', () => {
    expect(resolveEffectiveContextWindow(baseInput)).toEqual({
      source: 'assumed',
      warnings: ['WINDOW_UNKNOWN'],
      windowTokens: ASSUMED_CONTEXT_WINDOW_TOKENS,
    });

    const evaluation = evaluateContextBudget({
      ...baseInput,
      messages: [message('latest', 'user', 0, 'hello')],
      trigger: 'final-preflight',
    });
    expect(evaluation.trace.warnings).toEqual(['WINDOW_UNKNOWN']);
    expect(evaluation.decision).toMatchObject({ kind: 'send', source: 'assumed' });
  });

  it('prefers an observed provider limit over a larger frozen catalog window', () => {
    expect(
      resolveEffectiveContextWindow({
        ...baseInput,
        catalogSnapshot: catalogSnapshot(),
        configuredWindowTokens: 256_000,
        observedWindowTokens: 32_000,
      }),
    ).toEqual({ source: 'observed', warnings: [], windowTokens: 32_000 });
  });

  it('keeps a matching frozen observed snapshot ahead of a larger legacy configured window', () => {
    expect(
      resolveEffectiveContextWindow({
        ...baseInput,
        catalogSnapshot: catalogSnapshot(32_000, { contextWindowSource: 'observed' }),
        configuredWindowTokens: 128_000,
      }),
    ).toEqual({ source: 'observed', warnings: [], windowTokens: 32_000 });
  });

  it('uses a smaller legacy configured cap instead of enlarging it to the catalog window', () => {
    expect(
      resolveEffectiveContextWindow({
        ...baseInput,
        catalogSnapshot: catalogSnapshot(128_000),
        configuredWindowTokens: 32_000,
      }),
    ).toEqual({ source: 'manual', warnings: [], windowTokens: 32_000 });
  });

  it('uses the legacy configured fallback for unknown or mismatched snapshots', () => {
    const expected = { source: 'manual', warnings: [], windowTokens: 128_000 };

    expect(
      resolveEffectiveContextWindow({
        ...baseInput,
        catalogSnapshot: catalogSnapshot(32_000, { contextWindowSource: 'unknown' }),
        configuredWindowTokens: 128_000,
      }),
    ).toEqual(expected);
    expect(
      resolveEffectiveContextWindow({
        ...baseInput,
        catalogSnapshot: catalogSnapshot(32_000, {
          contextWindowSource: 'observed',
          modelId: 'different-model',
        }),
        configuredWindowTokens: 128_000,
      }),
    ).toEqual(expected);
  });
});

describe('context partition and preflight', () => {
  it('keeps system and the latest user tail out of historical candidates', () => {
    const messages = [
      message('system', 'system', 0, 'rules'),
      message('old-user', 'user', 0, 'old question'),
      message('old-answer', 'assistant', 100),
      message('latest', 'user', 0, 'latest question'),
    ];

    expect(partitionContextMessages(messages)).toMatchObject({
      candidateIds: ['old-user', 'old-answer'],
      preservedIds: ['system', 'latest'],
    });
  });

  it('keeps a recent tool-ending turn and the complete turn preceding it together', () => {
    const evaluation = evaluateContextBudget({
      ...baseInput,
      catalogSnapshot: catalogSnapshot(128_000),
      messages: [
        message('old-question', 'user', 0, 'old question'),
        message('old-answer', 'assistant', 40_000),
        message('recent-question', 'user', 0, 'recent question'),
        message('recent-answer', 'assistant', 100),
        message('tool-question', 'user', 0, 'read the file'),
        message('tool-call', 'assistant', 0, 'reading'),
        message('tool-result', 'tool', 0, 'file read'),
        message('current-question', 'user', 0, 'continue'),
      ],
      trigger: 'final-preflight',
    });

    expect(evaluation.partition.candidateIds).toEqual(['old-question', 'old-answer']);
    expect(evaluation.partition.preservedIds).toEqual([
      'recent-question',
      'recent-answer',
      'tool-question',
      'tool-call',
      'tool-result',
      'current-question',
    ]);
  });

  it('returns TAIL_TOO_LARGE for a 200k latest attachment before compression', () => {
    const evaluation = evaluateContextBudget({
      ...baseInput,
      catalogSnapshot: catalogSnapshot(128_000),
      messages: [message('old', 'assistant', 1000), message('latest', 'user', 0, 'look')],
      providerMedia: [{ estimatedTokens: 200_000, id: 'huge', messageId: 'latest' }],
      trigger: 'final-preflight',
    });

    expect(evaluation.decision).toMatchObject({ code: 'TAIL_TOO_LARGE', kind: 'fail' });
    expect(evaluation.decision.kind === 'fail' && evaluation.decision.offending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: 'latest', source: 'attachment' }),
      ]),
    );
  });

  it('returns NO_CANDIDATES for a manual compact request with only a tail', () => {
    const evaluation = evaluateContextBudget({
      ...baseInput,
      catalogSnapshot: catalogSnapshot(),
      messages: [message('latest', 'user', 0, 'small request')],
      trigger: 'manual',
    });

    expect(evaluation.decision).toMatchObject({ code: 'NO_CANDIDATES', kind: 'fail' });
  });

  it('keeps traces redacted to ids, counts, model, provider, window, and fingerprint', () => {
    const secret = 'never-copy-this-secret';
    const evaluation = evaluateContextBudget({
      ...baseInput,
      catalogSnapshot: catalogSnapshot(100),
      messages: [message('old', 'user', 0, secret), message('latest', 'user', 0, 'tail')],
      tools: [{ description: secret, name: 'secret-tool' }],
      trigger: 'final-preflight',
    });

    expect(JSON.stringify(evaluation.trace)).not.toContain(secret);
    expect(evaluation.trace).toMatchObject({
      modelId: 'model-a',
      operationId: 'operation-a',
      providerId: 'provider-a',
    });
  });
});

describe('provider error parsing', () => {
  it('extracts structured and textual observed context limits', () => {
    expect(
      parseExceededContextWindowError({
        code: 'ExceededContextWindow',
        contextWindowTokens: 32_000,
      }),
    ).toEqual({ kind: 'exceeded-context-window', observedLimitTokens: 32_000 });
    expect(
      parseExceededContextWindowError(
        new Error('maximum context length is 16,384 tokens; request is too large'),
      ),
    ).toEqual({ kind: 'exceeded-context-window', observedLimitTokens: 16_384 });
  });

  it('does not classify unrelated provider errors', () => {
    expect(parseExceededContextWindowError(new Error('network timeout'))).toBeUndefined();
  });
});
