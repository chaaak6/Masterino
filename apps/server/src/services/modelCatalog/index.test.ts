// @vitest-environment node
import { randomUUID } from 'node:crypto';

import {
  createModelCatalogSnapshot,
  getModelCatalogFromSettings,
} from '@lobechat/business-model-bank';
import { createEmptyModelDescription, type ManagedModelRecord } from '@lobechat/types';
import type { AiProviderModelListItem } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EffectiveModelCatalog } from './index';
import { matchesEmbeddingKind, projectPublishedDescription } from './projection';

const model = (id: string): AiProviderModelListItem => ({
  id,
  enabled: true,
  type: 'chat',
  abilities: {},
  source: 'remote',
});
const record = (id: string): ManagedModelRecord => ({
  modelId: id,
  version: 1,
  updatedAt: new Date('2026-10-13T00:00:00Z'),
  draft: createEmptyModelDescription(id),
  published: null,
  publishedRevision: null,
});
const fixture = () => {
  const identity = randomUUID();
  const source = {
    settings: { enabled: true, silentRefreshEnabled: true, generation: 'a' },
    records: [] as ManagedModelRecord[],
    models: [model('a')],
    now: 1000,
    async readModels() {
      return structuredClone(this.models);
    },
  };
  const service = new EffectiveModelCatalog({
    settings: async () => source.settings,
    identity: async () => identity,
    records: async () => source.records,
    readModels: () => source.readModels(),
    now: () => source.now,
  });
  return { source, service };
};
afterEach(() => vi.unstubAllEnvs());
describe('effective catalog business scenarios', () => {
  it('Given unchanged metadata, When another client checks, Then it returns unchanged without upstream reads', async () => {
    const { source, service } = fixture();
    const reads = vi.spyOn(source, 'readModels');
    const first = await service.read();
    expect(first.status).toBe('changed');
    if (first.status !== 'changed') throw new Error('missing snapshot');
    expect(await service.read(first.revision)).toEqual({
      status: 'unchanged',
      revision: first.revision,
      stale: false,
    });
    expect(reads).toHaveBeenCalledTimes(1);
  });
  it('Given a draft, When saved then published, Then only publication changes the visible description', async () => {
    const { source, service } = fixture();
    const entry = record('a');
    entry.draft.displayName = 'A maintained';
    source.records = [entry];
    const draft = await service.read();
    expect(draft.status === 'changed' && draft.models[0].displayName).not.toBe('A maintained');
    entry.published = entry.draft;
    entry.publishedRevision = 'published-v1';
    source.settings.generation = 'b';
    const published = await service.read(draft.status === 'changed' ? draft.revision : undefined);
    expect(published.status === 'changed' && published.models[0].displayName).toBe('A maintained');
    expect(source.models[0].displayName).toBeUndefined();
  });
  it('Given revoked permissions, When cache expires, Then an authoritative empty list replaces old models', async () => {
    const { source, service } = fixture();
    await service.read();
    source.models = [];
    source.now += 300001;
    const empty = await service.read();
    expect(empty.status === 'changed' && empty.models).toEqual([]);
  });
  it('Given a bridge outage after publication, Then last successful data remains stale rather than becoming empty', async () => {
    const { source, service } = fixture();
    await service.read();
    source.settings.generation = 'new';
    vi.spyOn(source, 'readModels').mockRejectedValue(new Error('bridge offline'));
    const stale = await service.read();
    expect(stale.status === 'changed' && stale.stale).toBe(true);
    expect(stale.status === 'changed' && stale.models.map((m) => m.id)).toEqual(['a']);
  });
  it('Given a disabled switch, Then no upstream request happens', async () => {
    const { source, service } = fixture();
    const read = vi.spyOn(source, 'readModels');
    source.settings.silentRefreshEnabled = false;
    expect(await service.read()).toEqual({ status: 'disabled' });
    expect(read).not.toHaveBeenCalled();
    vi.stubEnv('MASTERINO_MODEL_CATALOG_ENABLED', 'false');
    expect(await service.read(undefined, false)).toEqual({ status: 'disabled' });
  });
  it('Given simultaneous cache misses, Then only one source request rebuilds the snapshot', async () => {
    const { source, service } = fixture();
    const reads = vi.spyOn(source, 'readModels');
    const results = await Promise.all([service.read(), service.read(), service.read()]);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[2]);
  });
  it('Given a disabled personal model and reference price, Then publication preserves the preference and actual tariff', () => {
    const previous = {
      ...model('a'),
      enabled: false,
      sort: 7,
      pricing: { currency: 'CNY' as const, units: [] },
    };
    const entry = record('a');
    entry.published = {
      ...entry.draft,
      referencePricing: {
        currency: 'USD',
        input: 99,
        output: 99,
        cacheRead: null,
        cacheWrite: null,
        source: 'official',
      },
    };
    entry.publishedRevision = 'v1';
    const projected = projectPublishedDescription(previous, entry);
    expect(projected.enabled).toBe(false);
    expect(projected.sort).toBe(7);
    expect(projected.pricing).toEqual(previous.pricing);
    expect(projected.abilities?.functionCall).toBeUndefined();
  });
  it('Given published tool capabilities, Then a running snapshot keeps them when the description is later changed', () => {
    const entry = record('a');
    entry.published = {
      ...entry.draft,
      capabilities: { ...entry.draft.capabilities, functionCall: 'supported' },
    };
    entry.publishedRevision = 'v1';
    const projected = projectPublishedDescription(model('a'), entry);
    const catalog = getModelCatalogFromSettings(projected.settings)!;
    const snapshot = createModelCatalogSnapshot(catalog.entry, 'operation');
    catalog.entry.capabilities!.functionCall = 'unsupported';
    expect(snapshot.entry.capabilities?.functionCall).toBe('supported');
    expect(projected.abilities?.functionCall).toBe(true);
  });
});

it('keeps rerank and moderation models out of embedding consumers despite the legacy DTO type', () => {
  for (const kind of ['rerank', 'moderation', 'embedding'] as const) {
    const item = record('a');
    item.published = { ...item.draft, kind };
    item.publishedRevision = 'v1';
    const projected = projectPublishedDescription(model('a'), item);
    expect(projected.type).toBe('embedding');
    expect(matchesEmbeddingKind(projected)).toBe(kind === 'embedding');
  }
});
