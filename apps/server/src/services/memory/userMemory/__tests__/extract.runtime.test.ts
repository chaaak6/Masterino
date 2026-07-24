import { type AiProviderRuntimeState } from '@lobechat/types';
import { type EnabledAiModel } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { type MemoryExtractionPrivateConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

import {
  makeTaskErrorItem,
  MemoryExtractionExecutor,
  resolveMemoryProviderBaseURL,
  resolveRuntimeAgentConfig,
} from '../extract';

const createRuntimeState = (models: EnabledAiModel[], keyVaults: Record<string, any>) =>
  ({
    enabledAiModels: models,
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    runtimeConfig: Object.fromEntries(
      Object.entries(keyVaults).map(([providerId, vault]) => [
        providerId,
        { config: {}, keyVaults: vault, settings: {} },
      ]),
    ),
  }) as AiProviderRuntimeState;

const createExecutor = (privateOverrides?: Partial<MemoryExtractionPrivateConfig>) => {
  const basePrivateConfig: MemoryExtractionPrivateConfig = {
    agentBenchmarkLoCoMo: { model: 'benchmark-1', provider: 'provider-b' },
    agentGateKeeper: { model: 'gate-2', provider: 'provider-b' },
    agentLayerExtractor: {
      contextLimit: 2048,
      layers: {
        activity: 'layer-act',
        context: 'layer-ctx',
        experience: 'layer-exp',
        identity: 'layer-id',
        preference: 'layer-pref',
      },
      model: 'layer-1',
      provider: 'provider-l',
    },
    agentPersonaWriter: { model: 'persona-1', provider: 'provider-s' },
    concurrency: 1,
    embedding: { model: 'embed-1', provider: 'provider-e' },
    featureFlags: { enableBenchmarkLoCoMo: false },
    observabilityS3: { enabled: false },
    webhook: {},
  };

  const serverConfig = {
    aiProvider: {},
    memory: {},
  };

  // @ts-ignore accessing private constructor for testing
  return new MemoryExtractionExecutor(serverConfig as any, {
    ...basePrivateConfig,
    ...privateOverrides,
  });
};

const defaultAuthorizedModels: EnabledAiModel[] = [
  { abilities: {}, enabled: true, id: 'gate-2', providerId: 'provider-b', type: 'chat' },
  { abilities: {}, enabled: true, id: 'embed-1', providerId: 'provider-e', type: 'embedding' },
  { abilities: {}, enabled: true, id: 'layer-act', providerId: 'provider-l', type: 'chat' },
  { abilities: {}, enabled: true, id: 'layer-ctx', providerId: 'provider-l', type: 'chat' },
  { abilities: {}, enabled: true, id: 'layer-exp', providerId: 'provider-l', type: 'chat' },
  { abilities: {}, enabled: true, id: 'layer-id', providerId: 'provider-l', type: 'chat' },
  { abilities: {}, enabled: true, id: 'layer-pref', providerId: 'provider-l', type: 'chat' },
];

const defaultKeyVaults = {
  'provider-b': { apiKey: 'b-key' },
  'provider-e': { apiKey: 'e-key' },
  'provider-l': { apiKey: 'l-key' },
};

const resolveRuntimeKeyVaults = async (
  executor: MemoryExtractionExecutor,
  runtimeState: AiProviderRuntimeState,
) => {
  const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig();

  return (executor as any).resolveRuntimeKeyVaults(runtimeState, memoryServiceConfig);
};

describe('MemoryExtractionExecutor.resolveRuntimeKeyVaults', () => {
  it('drops fallback credentials when user memory provider is overridden', () => {
    const executor = createExecutor({
      embedding: {
        apiKey: 'openai-system-key',
        baseURL: 'https://openai.example.com',
        model: 'embed-1',
        provider: 'openai',
      },
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      userMemoryEmbedding: {
        model: 'embed-2',
        provider: 'anthropic',
      },
    });

    expect(memoryServiceConfig.agents.embedding).toMatchObject({
      model: 'embed-2',
      provider: 'anthropic',
    });
    expect(memoryServiceConfig.agents.embedding.apiKey).toBeUndefined();
    expect(memoryServiceConfig.agents.embedding.baseURL).toBeUndefined();
  });

  it('keeps fallback credentials when user memory provider is unchanged', () => {
    const executor = createExecutor({
      embedding: {
        apiKey: 'openai-system-key',
        baseURL: 'https://openai.example.com',
        model: 'embed-1',
        provider: 'openai',
      },
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      userMemoryEmbedding: {
        model: 'embed-2',
        provider: 'openai',
      },
    });

    expect(memoryServiceConfig.agents.embedding).toMatchObject({
      apiKey: 'openai-system-key',
      baseURL: 'https://openai.example.com',
      model: 'embed-2',
      provider: 'openai',
    });
  });

  it('shares ServiceModel memory analysis config between gatekeeper and layer extractor', () => {
    const executor = createExecutor({
      agentGateKeeper: {
        apiKey: 'gate-system-key',
        baseURL: 'https://gate.example.com',
        model: 'gate-1',
        provider: 'provider-gate',
      },
      agentLayerExtractor: {
        apiKey: 'layer-system-key',
        baseURL: 'https://layer.example.com',
        contextLimit: 2048,
        layers: {
          activity: 'layer-act',
          context: 'layer-ctx',
          experience: 'layer-exp',
          identity: 'layer-id',
          preference: 'layer-pref',
        },
        model: 'layer-1',
        provider: 'provider-layer',
      },
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      memoryAnalysisAgentConfig: {
        contextLimit: 4096,
        model: 'analysis-1',
        provider: 'provider-analysis',
      },
    });

    expect(memoryServiceConfig.agents.gatekeeper).toMatchObject({
      model: 'analysis-1',
      provider: 'provider-analysis',
    });
    expect(memoryServiceConfig.agents.layerExtractor).toMatchObject({
      contextLimit: 4096,
      model: 'analysis-1',
      provider: 'provider-analysis',
    });
    expect(memoryServiceConfig.agents.gatekeeper.apiKey).toBeUndefined();
    expect(memoryServiceConfig.agents.layerExtractor.apiKey).toBeUndefined();
    expect(memoryServiceConfig.modelConfig.gateModel).toBe('analysis-1');
    expect(memoryServiceConfig.modelConfig.layerModels).toEqual({
      activity: 'analysis-1',
      context: 'analysis-1',
      experience: 'analysis-1',
      identity: 'analysis-1',
      preference: 'analysis-1',
    });
  });

  it('uses ServiceModel provider before env preferred providers when provider is overridden', async () => {
    const executor = createExecutor({
      agentGateKeeper: {
        model: 'gate-1',
        provider: 'provider-g',
      },
      agentLayerExtractor: {
        contextLimit: 2048,
        layers: {
          activity: 'layer-1',
          context: 'layer-1',
          experience: 'layer-1',
          identity: 'layer-1',
          preference: 'layer-1',
        },
        model: 'layer-1',
        provider: 'provider-l',
      },
      embedding: {
        apiKey: 'openai-system-key',
        baseURL: 'https://openai.example.com',
        model: 'embed-1',
        provider: 'openai',
      },
      embeddingPreferredProviders: ['provider-b'],
    });

    const memoryServiceConfig = (executor as any).resolveUserMemoryServiceConfig({
      userMemoryEmbedding: {
        model: 'embed-2',
        provider: 'provider-a',
      },
    });
    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: true,
          id: 'gate-1',
          providerId: 'provider-g',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'layer-1',
          providerId: 'provider-l',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'embed-2',
          providerId: 'provider-a',
          type: 'embedding',
        },
        {
          abilities: {},
          enabled: true,
          id: 'embed-2',
          providerId: 'provider-b',
          type: 'embedding',
        },
      ],
      {
        'provider-a': { apiKey: 'a-key' },
        'provider-b': { apiKey: 'b-key' },
        'provider-g': { apiKey: 'g-key' },
        'provider-l': { apiKey: 'l-key' },
      },
    );

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(
      runtimeState,
      memoryServiceConfig,
    );

    expect(keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-b');
  });

  it('uses only the exact configured providers and models for every memory runtime', async () => {
    const executor = createExecutor({
      embeddingPreferredProviders: ['provider-c', 'provider-a'],
      agentGateKeeperPreferredModels: ['model-chat-1', 'vendor-prefix/model-chat-1'],
      agentGateKeeperPreferredProviders: ['provider-c', 'provider-a'],
      agentLayerExtractorPreferredProviders: ['provider-c', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        ...defaultAuthorizedModels,
        { abilities: {}, enabled: true, id: 'gate-2', providerId: 'provider-a', type: 'chat' },
        {
          abilities: {},
          enabled: true,
          id: 'embed-1',
          providerId: 'provider-a',
          type: 'embedding',
        },
      ],
      {
        ...defaultKeyVaults,
        'provider-a': { apiKey: 'a-key' },
        'provider-c': { apiKey: 'c-key' },
      },
    );

    const keyVaults = await resolveRuntimeKeyVaults(executor, runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-b': { apiKey: 'b-key' },
      'provider-e': { apiKey: 'e-key' },
      'provider-l': { apiKey: 'l-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-a');
    expect(keyVaults).not.toHaveProperty('provider-c');
  });

  it('blocks extraction when the configured embedding model is not authorized', async () => {
    const executor = createExecutor();
    const runtimeState = createRuntimeState(
      [
        ...defaultAuthorizedModels.filter((model) => model.id !== 'embed-1'),
        {
          abilities: {},
          enabled: true,
          id: 'other-embedding',
          providerId: 'provider-e',
          type: 'embedding',
        },
      ],
      defaultKeyVaults,
    );

    await expect(resolveRuntimeKeyVaults(executor, runtimeState)).rejects.toThrow(
      'provider and model authorization',
    );
  });

  it('does not switch to another provider when the configured model is disabled', async () => {
    const executor = createExecutor({
      embeddingPreferredProviders: ['provider-disabled', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        ...defaultAuthorizedModels.filter((model) => model.id !== 'embed-1'),
        {
          abilities: {},
          enabled: false,
          id: 'embed-1',
          type: 'embedding',
          providerId: 'provider-e',
        },
        {
          abilities: {},
          enabled: true,
          id: 'embed-1',
          type: 'embedding',
          providerId: 'provider-a',
        },
      ],
      {
        ...defaultKeyVaults,
        'provider-a': { apiKey: 'a-key' },
      },
    );

    await expect(resolveRuntimeKeyVaults(executor, runtimeState)).rejects.toThrow(
      'provider and model authorization',
    );
  });

  it('keeps the configured provider when another preferred provider has the same model', async () => {
    const executor = createExecutor({
      agentGateKeeper: {
        model: 'gate-2',
        provider: 'provider-a',
        apiKey: 'sys-a-key',
        baseURL: 'https://api-a.example.com',
        language: 'English',
      },
      agentGateKeeperPreferredProviders: ['provider-b', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        ...defaultAuthorizedModels,
        { abilities: {}, enabled: true, id: 'gate-2', type: 'chat', providerId: 'provider-a' },
      ],
      {
        ...defaultKeyVaults,
        'provider-a': { apiKey: 'a-key' },
      },
    );

    const keyVaults = await resolveRuntimeKeyVaults(executor, runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-b');
  });

  it('blocks extraction instead of falling back when no enabled models match', async () => {
    const executor = createExecutor({
      agentGateKeeper: { model: 'gate-2', provider: 'provider-fallback', apiKey: 'sys-fb-key' },
    });

    const runtimeState = createRuntimeState([], {
      'provider-fallback': { apiKey: 'fb-key' },
    });

    await expect(resolveRuntimeKeyVaults(executor, runtimeState)).rejects.toThrow(
      'provider and model authorization',
    );
  });
});

describe('resolveMemoryProviderBaseURL', () => {
  it('uses AIHUB_PROXY_URL for newapi when the user vault has no baseURL', () => {
    const previous = process.env.AIHUB_PROXY_URL;
    process.env.AIHUB_PROXY_URL = 'https://aihub.example.com/v1';

    expect(resolveMemoryProviderBaseURL('newapi')).toBe('https://aihub.example.com/v1');
    expect(resolveMemoryProviderBaseURL('NEWAPI')).toBe('https://aihub.example.com/v1');

    if (previous === undefined) delete process.env.AIHUB_PROXY_URL;
    else process.env.AIHUB_PROXY_URL = previous;
  });

  it('does not mix the Aihub endpoint into other providers', () => {
    const previous = process.env.AIHUB_PROXY_URL;
    process.env.AIHUB_PROXY_URL = 'https://aihub.example.com/v1';

    expect(resolveMemoryProviderBaseURL('openai')).toBeUndefined();
    expect(resolveMemoryProviderBaseURL('openai', 'https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1',
    );

    if (previous === undefined) delete process.env.AIHUB_PROXY_URL;
    else process.env.AIHUB_PROXY_URL = previous;
  });
});

describe('resolveRuntimeAgentConfig', () => {
  it('blocks memory runtime initialization when the current user has no managed token', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      resolveRuntimeAgentConfig(
        { model: 'glm-5.2', provider: 'newapi' },
        {},
        { requireUserVault: true, userId: 'user-1' },
      ),
    ).toThrow('current user');

    warnSpy.mockRestore();
  });

  it('does not borrow credentials from another provider', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      resolveRuntimeAgentConfig(
        { model: 'glm-5.2', provider: 'newapi' },
        { openai: { apiKey: 'other-provider-key' } },
        {
          preferred: { providerIds: ['newapi'] },
          requireUserVault: true,
          userId: 'user-1',
        },
      ),
    ).toThrow('current user');

    warnSpy.mockRestore();
  });
});

describe('makeTaskErrorItem', () => {
  it('preserves database driver details from nested causes', () => {
    const driverError = new Error('must be able to parse query');
    driverError.name = 'PostgresError';
    Object.assign(driverError, { code: 'XX000' });

    const queryError = new Error('Failed query: select ...', { cause: driverError });
    queryError.name = 'DrizzleQueryError';

    const item = makeTaskErrorItem('retrieval', queryError, {
      sourceId: 'topic-1',
      sourceType: 'chat_topic',
    });

    expect(item).toMatchObject({
      cause: {
        code: 'XX000',
        message: 'must be able to parse query',
        name: 'PostgresError',
      },
      message: 'Failed query: select ...',
      name: 'DrizzleQueryError',
      sourceId: 'topic-1',
      sourceType: 'chat_topic',
      stage: 'retrieval',
    });
  });
});
