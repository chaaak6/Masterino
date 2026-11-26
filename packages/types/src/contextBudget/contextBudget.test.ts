import { describe, expect, it } from 'vitest';

import type { DecideContextBudgetInput } from './index';
import { canContinueAfterCompression, decideContextBudget, hasPayloadBeenSent } from './index';

const input = (over: Partial<DecideContextBudgetInput> = {}): DecideContextBudgetInput => ({
  budgetTokens: 28_000,
  candidateIds: ['old-1'],
  compressionAttempt: 0,
  offending: [],
  payloadFingerprint: 'payload-a',
  preservedIds: ['tail-1'],
  promptTokens: 20_000,
  source: 'catalog',
  tailTokens: 5_000,
  trigger: 'final-preflight',
  windowTokens: 32_000,
  ...over,
});

describe('decideContextBudget', () => {
  it('sends a payload that fits the effective budget', () => {
    expect(decideContextBudget(input())).toEqual({
      kind: 'send',
      promptTokens: 20_000,
      source: 'catalog',
      windowTokens: 32_000,
    });
  });

  it('compresses once when the final payload exceeds budget', () => {
    expect(decideContextBudget(input({ promptTokens: 30_000 }))).toEqual({
      attempt: 1,
      candidateIds: ['old-1'],
      kind: 'compress',
      preservedIds: ['tail-1'],
      trigger: 'final-preflight',
    });
  });

  it('lets a manual request compact a fitting payload when candidates exist', () => {
    expect(decideContextBudget(input({ trigger: 'manual' }))).toMatchObject({
      kind: 'compress',
      trigger: 'manual',
    });
  });

  it('fails a non-compressible tail before any provider call', () => {
    expect(
      decideContextBudget(
        input({
          offending: [{ estimatedTokens: 40_000, messageId: 'tail-1', source: 'attachment' }],
          promptTokens: 45_000,
          tailTokens: 40_000,
        }),
      ),
    ).toMatchObject({
      code: 'TAIL_TOO_LARGE',
      kind: 'fail',
      offending: [{ messageId: 'tail-1', source: 'attachment' }],
    });
  });

  it('compares a non-compressible tail with effective budget, not the raw window', () => {
    expect(
      decideContextBudget(
        input({
          offending: [{ estimatedTokens: 30_000, messageId: 'tail-1', source: 'text' }],
          promptTokens: 31_000,
          tailTokens: 30_000,
        }),
      ),
    ).toMatchObject({ code: 'TAIL_TOO_LARGE', kind: 'fail' });
  });

  it('returns NO_CANDIDATES with actionable alternatives', () => {
    const decision = decideContextBudget(input({ candidateIds: [], promptTokens: 30_000 }));
    expect(decision).toMatchObject({ code: 'NO_CANDIDATES', kind: 'fail' });
    expect(decision.kind === 'fail' && decision.actions).not.toContain('compress');
  });

  it('rejects a second compression attempt', () => {
    expect(
      decideContextBudget(input({ compressionAttempt: 1, promptTokens: 30_000 })),
    ).toMatchObject({ code: 'RETRY_EXHAUSTED', kind: 'fail' });
  });

  it('rejects an identical payload fingerprint even if token accounting says it fits', () => {
    expect(decideContextBudget(input({ sentPayloadFingerprints: ['payload-a'] }))).toMatchObject({
      code: 'DUPLICATE_REQUEST',
      kind: 'fail',
    });
    expect(hasPayloadBeenSent('payload-a', ['payload-a'])).toBe(true);
  });

  it('may compress a previously sent provider payload before deciding whether to resend', () => {
    expect(
      decideContextBudget(
        input({
          promptTokens: 20_000,
          sentPayloadFingerprints: ['payload-a'],
          trigger: 'provider-error',
        }),
      ),
    ).toMatchObject({ kind: 'compress', trigger: 'provider-error' });
  });

  it('terminates a second provider-error recovery even when the old estimate fits', () => {
    expect(
      decideContextBudget(
        input({ compressionAttempt: 1, promptTokens: 20_000, trigger: 'provider-error' }),
      ),
    ).toMatchObject({ code: 'RETRY_EXHAUSTED', kind: 'fail' });
  });

  it('prioritizes second provider-error exhaustion over tail and candidate classification', () => {
    expect(
      decideContextBudget(
        input({
          candidateIds: [],
          compressionAttempt: 1,
          offending: [{ estimatedTokens: 40_000, messageId: 'tail-1', source: 'attachment' }],
          promptTokens: 45_000,
          tailTokens: 40_000,
          trigger: 'provider-error',
        }),
      ),
    ).toMatchObject({ code: 'RETRY_EXHAUSTED', kind: 'fail' });
  });
});

describe('canContinueAfterCompression', () => {
  const common = {
    afterTokens: 10_000,
    attempt: 1 as const,
    beforeTokens: 20_000,
    payloadFingerprint: 'payload-a',
    trigger: 'final-preflight' as const,
  };

  it('continues only after a material compressed outcome', () => {
    expect(canContinueAfterCompression({ ...common, outcome: 'compressed' })).toBe(true);
    expect(
      canContinueAfterCompression({ ...common, afterTokens: 20_000, outcome: 'compressed' }),
    ).toBe(false);
  });

  it('never continues after skipped or failed compression', () => {
    expect(
      canContinueAfterCompression({ ...common, code: 'NO_CANDIDATES', outcome: 'skipped' }),
    ).toBe(false);
    expect(
      canContinueAfterCompression({ ...common, code: 'SUMMARY_FAILED', outcome: 'failed' }),
    ).toBe(false);
  });
});
