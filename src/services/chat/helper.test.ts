import { mergeModelCatalogEntry } from '@lobechat/business-model-bank';
import { type EnabledAiModel, ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';

import { isCanUseVideo, isCanUseVision } from './helper';

describe('chat helper', () => {
  afterEach(() => {
    useAiInfraStore.setState({ enabledAiModels: [] });
  });

  it.each([
    ['supported', false, true],
    ['unsupported', true, false],
    ['unknown', true, false],
  ] as const)(
    'uses catalog %s for image processing instead of legacy vision=%s',
    (image, legacyVision, expected) => {
      useAiInfraStore.setState({
        enabledAiModels: [
          {
            id: 'catalog-image',
            providerId: 'openai',
            type: 'chat',
            abilities: { vision: legacyVision },
            settings: {
              modelCatalog: mergeModelCatalogEntry({
                modelId: 'catalog-image',
                providerId: 'openai',
                providerMetadata: { inputModalities: { image } },
              }),
            },
          },
        ],
      });
      expect(isCanUseVision('catalog-image', 'openai')).toBe(expected);
    },
  );

  it('should resolve LobeHub routed model abilities by model id fallback', () => {
    useAiInfraStore.setState({
      enabledAiModels: [
        {
          abilities: { video: true, vision: true },
          id: 'gemini-3.1-flash-lite-preview',
          providerId: ModelProvider.Google,
          type: 'chat',
        } as EnabledAiModel,
      ],
    });

    expect(isCanUseVision('gemini-3.1-flash-lite-preview', ModelProvider.LobeHub)).toBe(true);
    expect(isCanUseVideo('gemini-3.1-flash-lite-preview', ModelProvider.LobeHub)).toBe(true);
  });

  it('should not fallback across non-LobeHub providers', () => {
    useAiInfraStore.setState({
      enabledAiModels: [
        {
          abilities: { video: true, vision: true },
          id: 'gemini-3.1-flash-lite-preview',
          providerId: ModelProvider.Google,
          type: 'chat',
        } as EnabledAiModel,
      ],
    });

    expect(isCanUseVision('gemini-3.1-flash-lite-preview', ModelProvider.OpenAI)).toBe(false);
    expect(isCanUseVideo('gemini-3.1-flash-lite-preview', ModelProvider.OpenAI)).toBe(false);
  });
});
