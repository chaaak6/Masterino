import type { AiProviderRuntimeState } from '@lobechat/types';
import type { EnabledAiModel } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiInfraRepos } from '../index';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AiInfraRepos', () => {
  describe('AiInfraRepos.tryMatchingProviderFrom', () => {
    const createRuntimeState = (models: EnabledAiModel[]): AiProviderRuntimeState => ({
      enabledAiModels: models,
      enabledAiProviders: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: {},
    });

    it('prefers provider order when multiple providers have model', async () => {
      const runtimeState = createRuntimeState([
        { abilities: {}, enabled: true, id: 'm-1', type: 'chat', providerId: 'provider-b' },
        { abilities: {}, enabled: true, id: 'm-1', type: 'chat', providerId: 'provider-a' },
      ]);

      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        modelId: 'm-1',
        preferredProviders: ['provider-b', 'provider-a'],
      });

      expect(providerId).toBe('provider-b');
    });

    it('ignores disabled models when matching', async () => {
      const runtimeState = createRuntimeState([
        { abilities: {}, enabled: false, id: 'm-1', type: 'chat', providerId: 'provider-disabled' },
        { abilities: {}, enabled: true, id: 'm-1', type: 'chat', providerId: 'provider-a' },
      ]);

      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        modelId: 'm-1',
        preferredProviders: ['provider-disabled', 'provider-a'],
      });

      expect(providerId).toBe('provider-a');
    });

    it('falls back to provided fallback provider when no match', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const runtimeState = createRuntimeState([]);

      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        modelId: 'm-1',
        fallbackProvider: 'provider-fallback',
      });

      expect(providerId).toBe('provider-fallback');
      warnSpy.mockRestore();
    });

    it('throws instead of falling back when an exact model match is required', async () => {
      const runtimeState = createRuntimeState([]);

      await expect(
        AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
          fallbackProvider: 'provider-fallback',
          modelId: 'm-1',
          preferredProviders: ['provider-fallback'],
          requireModelMatch: true,
          requiredModelType: 'chat',
        }),
      ).rejects.toThrow('provider and model authorization');
    });

    it('requires the configured model type when matching', async () => {
      const runtimeState = createRuntimeState([
        {
          abilities: {},
          enabled: true,
          id: 'shared-model',
          providerId: 'provider-chat',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'shared-model',
          providerId: 'provider-embedding',
          type: 'embedding',
        },
      ]);

      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        modelId: 'shared-model',
        preferredProviders: ['provider-chat', 'provider-embedding'],
        requireModelMatch: true,
        requiredModelType: 'embedding',
      });

      expect(providerId).toBe('provider-embedding');
    });
  });
});
