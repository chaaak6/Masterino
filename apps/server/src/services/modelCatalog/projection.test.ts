// @vitest-environment node
import {
  getModelCatalogFromSettings,
  mergeModelCatalogEntry,
  type ModelCatalogMergeInput,
  recordContextWindowRejectionEvidence,
} from '@lobechat/business-model-bank';
import { createEmptyModelDescription, type ManagedModelRecord } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { projectPublishedDescription } from './projection';

const now = '2026-11-09T08:00:00Z';
const runtimeModel = (input: Partial<ModelCatalogMergeInput> = {}) => {
  const catalog = mergeModelCatalogEntry({
    modelId: 'kimi-k3.1-pro',
    providerId: 'newapi',
    now,
    ...input,
  });
  return {
    id: catalog.entry.modelId,
    enabled: true,
    type: 'chat' as const,
    abilities: { vision: true, functionCall: true },
    contextWindowTokens: catalog.entry.contextWindowTokens,
    settings: { modelCatalog: catalog },
  };
};
const publication = (tokens: number | null): ManagedModelRecord => {
  const description = {
    ...createEmptyModelDescription('kimi-k3.1-pro'),
    contextWindowTokens: tokens,
  };
  return {
    modelId: 'kimi-k3.1-pro',
    draft: description,
    published: description,
    publishedRevision: 'published-capacity',
    version: 1,
    updatedAt: new Date(now),
  };
};

afterEach(() => vi.useRealTimers());

describe('published chat context capacity', () => {
  it.each([64_000, 1_000_000])('uses maintained %i instead of a built-in capacity', (tokens) => {
    const original = runtimeModel({ catalog: { contextWindowTokens: 128_000 } });
    const projected = projectPublishedDescription(original, publication(tokens));
    expect(projected.contextWindowTokens).toBe(tokens);
    expect(getModelCatalogFromSettings(projected.settings)?.entry.contextWindowTokens).toBe(tokens);
    expect(projected.abilities).toEqual(original.abilities);
    expect(original.contextWindowTokens).toBe(128_000);
  });

  it.each([
    [1_000_000, 128_000],
    [64_000, 64_000],
  ])('caps maintained %i at an explicit provider ceiling', (published, effective) => {
    const original = runtimeModel({ providerMetadata: { contextWindowTokens: 128_000 } });
    const projected = projectPublishedDescription(original, publication(published));
    expect(projected.contextWindowTokens).toBe(effective);
    expect(getModelCatalogFromSettings(projected.settings)?.entry.contextWindowTokens).toBe(
      effective,
    );
  });

  it('retains an explicit manual override', () => {
    const original = runtimeModel({
      manual: {
        contextWindowTokens: 256_000,
        owner: 'operator',
        reason: 'verified',
        createdAt: now,
      },
    });
    const projected = projectPublishedDescription(original, publication(1_000_000));
    expect(projected.contextWindowTokens).toBe(256_000);
    expect(getModelCatalogFromSettings(projected.settings)?.entry.contextWindowSource).toBe(
      'manual',
    );
  });

  it.each([
    ['2026-11-09T07:00:00Z', 'v1', 64_000],
    ['2026-09-01T00:00:00Z', 'v1', 1_000_000],
    ['2026-11-09T07:00:00Z', 'v0', 1_000_000],
  ])(
    'respects only a fresh rejection for the current model version (%s, %s)',
    (verifiedAt, modelVersion, effective) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const original = runtimeModel({
        observed: { contextWindowRejectionTokens: 64_000, modelVersion, verifiedAt },
        providerMetadata: { modelVersion: 'v1' },
      });
      const projected = projectPublishedDescription(original, publication(1_000_000));
      expect(projected.contextWindowTokens).toBe(effective);
      expect(getModelCatalogFromSettings(projected.settings)?.entry.contextWindowTokens).toBe(
        effective,
      );
    },
  );

  it('keeps an audited force override when a rejection is recorded', () => {
    const original = runtimeModel({
      manual: {
        contextWindowTokens: 256_000,
        forceContextWindow: true,
        owner: 'operator',
        reason: 'verified upstream correction',
        createdAt: now,
      },
      observed: { contextWindowRejectionTokens: 64_000, verifiedAt: now },
    });
    expect(projectPublishedDescription(original, publication(1_000_000)).contextWindowTokens).toBe(
      256_000,
    );
  });

  it('retains a provider ceiling across repeated projection and later publication', () => {
    const original = runtimeModel({ providerMetadata: { contextWindowTokens: 128_000 } });
    const first = projectPublishedDescription(original, publication(64_000));
    const repeated = projectPublishedDescription(first, publication(64_000));
    expect(repeated.contextWindowTokens).toBe(64_000);
    const next = projectPublishedDescription(repeated, publication(1_000_000));
    expect(next.contextWindowTokens).toBe(128_000);
  });

  it('restores the runtime baseline when maintained capacity is cleared', () => {
    const original = runtimeModel({ catalog: { contextWindowTokens: 128_000 } });
    const maintained = projectPublishedDescription(original, publication(1_000_000));
    expect(projectPublishedDescription(maintained, publication(null)).contextWindowTokens).toBe(
      128_000,
    );
    expect(projectPublishedDescription(maintained).contextWindowTokens).toBe(128_000);
  });

  it('records a new provider rejection against the maintained candidate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const maintained = projectPublishedDescription(runtimeModel(), publication(1_000_000));
    const catalog = getModelCatalogFromSettings(maintained.settings)!;
    const rejected = recordContextWindowRejectionEvidence(catalog, {
      contextWindowRejectionTokens: 64_000,
      verifiedAt: now,
    });
    const next = projectPublishedDescription(
      { ...maintained, settings: { modelCatalog: rejected } },
      publication(1_000_000),
    );
    expect(next.contextWindowTokens).toBe(64_000);
    expect(getModelCatalogFromSettings(next.settings)?.contextWindowCandidate?.tokens).toBe(
      1_000_000,
    );
  });

  it.each(['embedding', 'image'] as const)('does not apply chat capacity to %s models', (type) => {
    const original = {
      ...runtimeModel({ catalog: { contextWindowTokens: 8192, kind: type } }),
      type,
    };
    const projected = projectPublishedDescription(original, publication(1_000_000));
    expect(projected.type).toBe(type);
    expect(projected.contextWindowTokens).toBe(8192);
    expect(getModelCatalogFromSettings(projected.settings)?.entry.contextWindowTokens).toBe(8192);
  });
});
