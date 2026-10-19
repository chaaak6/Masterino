import { mergeModelCatalogEntry } from '@lobechat/business-model-bank';
import * as runtimeModule from '@lobechat/model-runtime';
import type { AIImageModelCard, EnabledAiModel, ModelParamsSchema, Pricing } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getChatModelList,
  getImageModelList,
  normalizeChatModel,
  normalizeImageModel,
  mergeSilentCatalogModels,
} from '../action';

const createChatModel = (overrides: Partial<EnabledAiModel> = {}): EnabledAiModel => ({
  abilities: overrides.abilities ?? { functionCall: true },
  contextWindowTokens: overrides.contextWindowTokens ?? 8192,
  displayName: overrides.displayName ?? 'Chat Model',
  enabled: overrides.enabled ?? true,
  id: overrides.id ?? 'chat-model',
  providerId: overrides.providerId ?? 'openai',
  type: 'chat',
  ...overrides,
});

type ImageEnabledModel = EnabledAiModel & AIImageModelCard;

const createImageModel = (overrides: Partial<ImageEnabledModel> = {}): ImageEnabledModel => ({
  abilities: overrides.abilities ?? {},
  contextWindowTokens: overrides.contextWindowTokens,
  displayName: overrides.displayName ?? 'Image Model',
  enabled: overrides.enabled ?? true,
  id: overrides.id ?? 'image-model',
  providerId: overrides.providerId ?? 'openai',
  type: 'image',
  ...overrides,
});

describe('aiProvider action helpers', () => {
  it('updates only newapi models when the silent directory changes', () => {
    const other = createChatModel({ id: 'other', providerId: 'openai' });
    const old = createChatModel({ id: 'old', providerId: 'newapi' });
    const fresh = createChatModel({ id: 'fresh', providerId: 'newapi' });
    expect(mergeSilentCatalogModels([other, old], [fresh])).toEqual([other, fresh]);
    expect(mergeSilentCatalogModels([other, old], [])).toEqual([other]);
  });
  beforeEach(() => {
    vi.spyOn(runtimeModule, 'getModelPropertyWithFallback').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeChatModel', () => {
    it('fills missing optional fields with safe defaults', async () => {
      const model = createChatModel({
        abilities: undefined,
        contextWindowTokens: undefined,
        displayName: undefined,
      });

      const result = await normalizeChatModel(model);

      expect(result).toEqual({
        abilities: {},
        contextWindowTokens: undefined,
        displayName: '',
        id: 'chat-model',
      });
    });

    it('preserves inline metadata without loading fallback model config', async () => {
      const fallbackSpy = vi.spyOn(runtimeModule, 'getModelPropertyWithFallback');
      const pricing: Pricing = {
        units: [{ name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' }],
      };
      const model = {
        ...createChatModel({ id: 'online-chat-model', providerId: 'lobehub' }),
        description: 'Inline description',
        pricing,
      };

      const result = await normalizeChatModel(model);

      expect(result.description).toBe('Inline description');
      expect(result.pricing).toBe(pricing);
      expect(fallbackSpy).not.toHaveBeenCalled();
    });

    it('preserves Aihub model ids and abilities like other chat models', async () => {
      const result = await normalizeChatModel(
        createChatModel({
          abilities: { functionCall: false, reasoning: false, search: false },
          displayName: 'glm5-5.1',
          id: 'glm5-5.1',
          providerId: 'newapi',
        }),
      );

      expect(result).toMatchObject({
        abilities: { functionCall: false, reasoning: false, search: false },
        displayName: 'glm5-5.1',
        id: 'glm5-5.1',
      });
    });
  });

  describe('normalizeImageModel', () => {
    it('preserves inline metadata and pricing information', async () => {
      const model = createImageModel({
        abilities: { vision: true },
        contextWindowTokens: 4096,
        displayName: 'Inline Model',
        parameters: {
          prompt: { default: '' },
          size: { default: '1024x1024', enum: ['512x512', '1024x1024'] },
        } as ModelParamsSchema,
        pricing: {
          units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
        },
      });

      const result = await normalizeImageModel(model);

      expect(result).toMatchObject({
        abilities: { vision: true },
        displayName: 'Inline Model',
        parameters: { size: { default: '1024x1024', enum: ['512x512', '1024x1024'] } },
        pricing: {
          units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
        },
      });
    });

    it('fetches fallback description/parameters/pricing when missing', async () => {
      const fallbackSpy = vi
        .mocked(runtimeModule.getModelPropertyWithFallback)
        .mockImplementation(async (_id, key) => {
          if (key === 'parameters')
            return {
              prompt: { default: '' },
              size: { default: '768x768', enum: ['512x512', '768x768'] },
            } satisfies ModelParamsSchema;
          if (key === 'pricing')
            return {
              units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
            };
          if (key === 'description') return 'Fallback description';
          return undefined;
        });

      const model = createImageModel({
        id: 'stable-diffusion',
        providerId: 'stability',
        parameters: undefined,
        pricing: undefined,
      });

      const result = await normalizeImageModel(model);

      expect(result.parameters).toEqual({
        prompt: { default: '' },
        size: { default: '768x768', enum: ['512x512', '768x768'] },
      });
      expect(result.pricing).toEqual({
        units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
      });
      expect(result.description).toBe('Fallback description');
      expect(fallbackSpy).toHaveBeenCalledWith('stable-diffusion', 'parameters', 'stability');
      expect(fallbackSpy).toHaveBeenCalledWith('stable-diffusion', 'pricing', 'stability');
      expect(fallbackSpy).toHaveBeenCalledWith('stable-diffusion', 'description', 'stability');
    });
  });

  describe('getChatModelList', () => {
    const chatModels = [
      createChatModel({ id: 'gpt-4', providerId: 'openai', displayName: 'GPT-4' }),
      createChatModel({ id: 'gpt-3.5', providerId: 'openai', displayName: 'GPT-3.5' }),
      createChatModel({ id: 'claude-3', providerId: 'anthropic', displayName: 'Claude 3' }),
    ];

    it('filters by provider and deduplicates IDs', async () => {
      const duplicated = [
        ...chatModels,
        createChatModel({ id: 'gpt-4', providerId: 'openai', displayName: 'GPT-4 Duplicate' }),
      ];

      const result = await getChatModelList(duplicated, 'openai');

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['gpt-4', 'gpt-3.5']);
      expect(result[0].displayName).toBe('GPT-4');
    });

    it('returns empty array when provider has no chat models', async () => {
      const result = await getChatModelList(chatModels, 'nonexistent');
      expect(result).toEqual([]);
    });

    it('filters runtime-only hidden models from visible chat lists', async () => {
      const result = await getChatModelList(
        [
          createChatModel({
            displayName: 'Visible Model',
            id: 'visible-model',
            providerId: 'lobehub',
          }),
          createChatModel({
            displayName: 'Onboarding Alias',
            id: 'lobehub-onboarding-v1',
            providerId: 'lobehub',
            visible: false,
          }),
        ],
        'lobehub',
      );

      expect(result.map((model) => model.id)).toEqual(['visible-model']);
    });

    it('deduplicates only exact Aihub model ids', async () => {
      const result = await getChatModelList(
        [
          createChatModel({
            abilities: { functionCall: false, reasoning: false, search: false },
            displayName: 'glm5-5.1',
            id: 'glm5-5.1',
            providerId: 'newapi',
          }),
          createChatModel({
            displayName: 'GLM-5.1',
            id: 'glm-5.1',
            providerId: 'newapi',
          }),
        ],
        'newapi',
      );

      expect(result.map((model) => model.id)).toEqual(['glm5-5.1', 'glm-5.1']);
      expect(result[0]).toMatchObject({
        abilities: { functionCall: false, reasoning: false, search: false },
        displayName: 'glm5-5.1',
      });
    });

    it('excludes every non-chat kind and an audited manual deny through the shared selector', async () => {
      const denied = mergeModelCatalogEntry({
        manual: {
          createdAt: '2026-09-01T00:00:00.000Z',
          denyChat: true,
          owner: 'model-ops',
          reason: 'incident response',
        },
        modelId: 'temporarily-denied-chat',
        now: '2026-09-03T00:00:00.000Z',
        providerId: 'newapi',
      });
      const result = await getChatModelList(
        [
          createChatModel({ id: 'qwen3-vl-rerank', providerId: 'newapi' }),
          createChatModel({ id: 'bge-reranker-v2', providerId: 'newapi' }),
          createChatModel({ id: 'text-embedding-3-small', providerId: 'newapi' }),
          createChatModel({
            id: 'temporarily-denied-chat',
            providerId: 'newapi',
            settings: { modelCatalog: denied },
          }),
          createChatModel({ id: 'company-chat', providerId: 'newapi' }),
        ],
        'newapi',
      );

      expect(result.map(({ id }) => id)).toEqual(['company-chat']);
    });
  });

  describe('getImageModelList', () => {
    const imageModels = [
      createImageModel({ id: 'dall-e-3', providerId: 'openai', displayName: 'DALL-E 3' }),
      createImageModel({ id: 'midjourney', providerId: 'midjourney', displayName: 'Midjourney' }),
    ];

    it('collects normalized image models for a provider', async () => {
      const result = await getImageModelList(imageModels, 'openai');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('dall-e-3');
      expect(result[0].displayName).toBe('DALL-E 3');
    });

    it('returns empty array when provider has no image models', async () => {
      const result = await getImageModelList(imageModels, 'unknown');
      expect(result).toEqual([]);
    });
  });
});
