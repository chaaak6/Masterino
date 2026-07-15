import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

const baseOptions = {
  marketService: {} as MarketService,
  topicId: 'topic-1',
  userId: 'user-1',
};

describe('sandbox service factory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses a disabled provider when no sandbox provider is configured', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {},
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('disabled');
    expect(service.capabilities).toMatchObject({
      backgroundCommands: false,
      exportFile: false,
      files: false,
      persistentSession: false,
      shell: false,
      skillScripts: false,
    });
    await expect(service.callTool('runCommand', { command: 'echo hi' })).resolves.toMatchObject({
      error: { message: expect.stringContaining('not configured') },
      success: false,
    });
  }, 20_000);

  it('uses the market provider only when it is explicitly configured', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: { SANDBOX_PROVIDER: 'market' },
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('market');
    expect(service.capabilities).toMatchObject({
      backgroundCommands: true,
      exportFile: true,
      files: true,
      persistentSession: true,
      shell: true,
      skillScripts: true,
    });
  });

  it('uses the onlyboxes provider when configured', async () => {
    vi.doMock('@/envs/app', () => ({
      appEnv: {
        APP_URL: 'https://lobehub.example.com',
      },
    }));
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        ONLYBOXES_BASE_URL: 'https://onlyboxes.example.com',
        ONLYBOXES_JIT_SIGNING_KEY: 'jit-signing-key',
        SANDBOX_PROVIDER: 'onlyboxes',
      },
    }));

    const { createSandboxService } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(service.kind).toBe('onlyboxes');
    expect(service.capabilities.languages).toEqual(['python', 'javascript', 'typescript']);
  });

  it('keeps onlyboxes disabled when the JIT signing key is missing', async () => {
    vi.doMock('@/envs/sandbox', () => ({
      sandboxEnv: {
        ONLYBOXES_BASE_URL: 'https://onlyboxes.example.com',
        SANDBOX_PROVIDER: 'onlyboxes',
      },
    }));

    const { createSandboxService, isSandboxConfigured } = await import('../factory');
    const service = createSandboxService(baseOptions);

    expect(isSandboxConfigured()).toBe(false);
    expect(service.kind).toBe('disabled');
  });
});
