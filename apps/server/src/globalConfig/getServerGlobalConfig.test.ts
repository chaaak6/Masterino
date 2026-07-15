import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface CapturedProviderConfig {
  enabled?: boolean;
  enabledKey?: string;
  fetchOnClient?: boolean;
  modelListKey?: string;
  withDeploymentName?: boolean;
}

const mocks = vi.hoisted(() => ({
  genServerAiProvidersConfig: vi.fn(
    async (_specificConfig: Record<string, CapturedProviderConfig>) => ({}),
  ),
}));

interface MockGlobalConfigOptions {
  agentGatewayUrl?: string;
  disableEmailPassword?: boolean;
  disableEmailSignup?: boolean;
  enableAgentGateway?: boolean;
  sandboxConfigured?: boolean;
}

const mockGlobalConfigDependencies = (
  enableBusinessFeatures: boolean,
  options: MockGlobalConfigOptions = {},
) => {
  vi.doMock('@lobechat/business-const', () => ({
    DEFAULT_MODEL: 'glm-5.2',
    ENABLE_BUSINESS_FEATURES: enableBusinessFeatures,
  }));

  vi.doMock('@/config/composio', () => ({
    composioEnv: {},
  }));

  vi.doMock('@/const/version', () => ({
    isDesktop: false,
  }));

  vi.doMock('@/envs/app', () => ({
    appEnv: {
      ...(options.agentGatewayUrl ? { AGENT_GATEWAY_URL: options.agentGatewayUrl } : {}),
      ...(options.enableAgentGateway === undefined
        ? {}
        : { ENABLE_AGENT_GATEWAY: options.enableAgentGateway }),
    },
    getAppConfig: vi.fn(() => ({
      DEFAULT_AGENT_CONFIG: '',
    })),
  }));

  vi.doMock('@/envs/auth', () => ({
    authEnv: {
      AUTH_DISABLE_EMAIL_PASSWORD: options.disableEmailPassword ?? false,
      AUTH_DISABLE_EMAIL_SIGNUP: options.disableEmailSignup ?? false,
      AUTH_EMAIL_VERIFICATION: false,
      AUTH_ENABLE_MAGIC_LINK: false,
      AUTH_SSO_PROVIDERS: '',
    },
  }));

  vi.doMock('@/envs/file', () => ({
    fileEnv: {},
  }));

  vi.doMock('@/envs/image', () => ({
    imageEnv: {
      AI_IMAGE_DEFAULT_IMAGE_NUM: undefined,
    },
  }));

  vi.doMock('@/envs/knowledge', () => ({
    knowledgeEnv: {
      DEFAULT_FILES_CONFIG: undefined,
    },
  }));

  vi.doMock('@/envs/langfuse', () => ({
    langfuseEnv: {
      ENABLE_LANGFUSE: false,
    },
  }));

  vi.doMock('@/envs/tools', () => ({
    toolsEnv: {},
  }));

  vi.doMock('@/libs/better-auth/utils/server', () => ({
    parseSSOProviders: vi.fn(() => []),
  }));

  vi.doMock('@/server/globalConfig/parseSystemAgent', () => ({
    parseSystemAgent: vi.fn(() => undefined),
  }));

  vi.doMock('@/server/services/sandbox', () => ({
    isSandboxConfigured: vi.fn(() => options.sandboxConfigured ?? false),
  }));

  vi.doMock('@/utils/object', () => ({
    cleanObject: vi.fn((object) => object),
  }));

  vi.doMock('./genServerAiProviderConfig', () => ({
    genServerAiProvidersConfig: mocks.genServerAiProvidersConfig,
  }));

  vi.doMock('./parseDefaultAgent', () => ({
    parseAgentConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./parseFilesConfig', () => ({
    parseFilesConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./parseMemoryExtractionConfig', () => ({
    getPublicMemoryExtractionConfig: vi.fn(() => ({})),
  }));
};

const loadCapturedProviderConfig = async (enableBusinessFeatures: boolean) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures);

  const { getServerGlobalConfig } = await import('./index');
  await getServerGlobalConfig();

  return mocks.genServerAiProvidersConfig.mock.calls[0][0] as Record<
    string,
    CapturedProviderConfig
  >;
};

const loadServerConfig = async (
  enableBusinessFeatures: boolean,
  options?: MockGlobalConfigOptions,
) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures, options);

  const { getServerGlobalConfig } = await import('./index');
  return getServerGlobalConfig();
};

describe('getServerGlobalConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should only enable NewAPI by default in business feature mode', async () => {
    const providerConfig = await loadCapturedProviderConfig(true);

    expect(providerConfig[ModelProvider.NewAPI].enabled).toBe(true);
    expect(providerConfig[ModelProvider.DeepSeek].enabled).toBe(false);
    expect(providerConfig[ModelProvider.Ollama].fetchOnClient).toBe(true);

    for (const provider of Object.values(ModelProvider)) {
      if (provider === ModelProvider.NewAPI) continue;

      expect(providerConfig[provider].enabled).toBe(false);
    }
  });

  it('should keep MasterLion provider defaults outside business feature mode', async () => {
    const providerConfig = await loadCapturedProviderConfig(false);

    expect(providerConfig[ModelProvider.NewAPI].enabled).toBe(true);
    expect(providerConfig[ModelProvider.NewAPI].fetchOnClient).toBe(false);
    expect(providerConfig[ModelProvider.OpenAI].enabled).toBe(false);
    expect(providerConfig[ModelProvider.DeepSeek].enabled).toBe(false);
  });

  it('should enable gateway mode for business builds', async () => {
    await expect(loadServerConfig(true)).resolves.toMatchObject({
      enableGatewayMode: true,
    });
  });

  it('should enable gateway mode for self-hosted builds only when explicitly enabled with a gateway url', async () => {
    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: true,
    });

    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: false,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: false,
    });

    await expect(loadServerConfig(false, { enableAgentGateway: true })).resolves.toMatchObject({
      enableGatewayMode: false,
    });
  });

  it('should expose the server-derived cloud sandbox availability', async () => {
    await expect(loadServerConfig(false, { sandboxConfigured: true })).resolves.toMatchObject({
      enableCloudSandbox: true,
    });
    await expect(loadServerConfig(false, { sandboxConfigured: false })).resolves.toMatchObject({
      enableCloudSandbox: false,
    });
  });

  it('should expose effective email signup availability independently from email login', async () => {
    await expect(loadServerConfig(false, { disableEmailSignup: true })).resolves.toMatchObject({
      disableEmailPassword: false,
      disableEmailSignup: true,
    });
    await expect(loadServerConfig(false, { disableEmailPassword: true })).resolves.toMatchObject({
      disableEmailPassword: true,
      disableEmailSignup: true,
    });
  });
});
