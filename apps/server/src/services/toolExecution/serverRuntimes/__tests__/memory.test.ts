import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  embeddings: vi.fn(),
  getServerFeatureFlags: vi.fn(),
  resolveAuthorizedEmbeddingRuntime: vi.fn(),
  searchMemory: vi.fn(),
}));

vi.mock('@/database/models/userMemory', () => ({
  UserMemoryModel: vi.fn().mockImplementation(() => ({
    searchMemory: mocks.searchMemory,
  })),
}));

vi.mock('@/database/schemas', () => ({
  userSettings: { id: 'id' },
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.getServerFeatureFlags,
}));

vi.mock('@/server/services/memory/userMemory/authorizedRuntime', () => ({
  resolveAuthorizedUserMemoryEmbeddingRuntime: mocks.resolveAuthorizedEmbeddingRuntime,
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(() => ({ scope: 'user', scopeKey: 'user-1' })),
}));

vi.mock('@/server/services/agentSignal/store/adapters/redis/policyStateStore', () => ({
  redisPolicyStateStore: {},
}));

const { memoryRuntime } = await import('../memory');

beforeEach(() => {
  vi.clearAllMocks();
});

const createContext = (): ToolExecutionContext => ({
  serverDB: {
    query: {
      userSettings: {
        findFirst: vi.fn(async () => ({ memory: { enabled: true, effort: 'medium' } })),
      },
    },
  } as unknown as LobeChatDatabase,
  toolManifestMap: {},
  userId: 'synthetic-user',
});

describe('memoryRuntime', () => {
  it("uses the current user's authorized embedding runtime for memory search", async () => {
    mocks.getServerFeatureFlags.mockResolvedValueOnce({ enableMemory: true });
    const vector = Array.from({ length: 2048 }, () => 0.1);
    mocks.embeddings.mockResolvedValueOnce([vector]);
    mocks.resolveAuthorizedEmbeddingRuntime.mockResolvedValueOnce({
      model: 'text-embedding-3-large',
      provider: 'newapi',
      runtime: {
        embeddings: mocks.embeddings,
      },
    });
    mocks.searchMemory.mockResolvedValueOnce({
      activities: [],
      contexts: [],
      experiences: [],
      identities: [],
      preferences: [],
    });

    const context = createContext();
    const runtime = await memoryRuntime.factory(context);

    await runtime.searchUserMemory({ queries: ['renewal timeline'] });

    expect(mocks.resolveAuthorizedEmbeddingRuntime).toHaveBeenCalledWith(
      context.serverDB,
      'synthetic-user',
    );
    expect(mocks.embeddings).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: 2048,
        input: ['renewal timeline'],
        model: 'text-embedding-3-large',
      }),
      expect.objectContaining({ user: 'synthetic-user' }),
    );
    expect(mocks.searchMemory).toHaveBeenCalledWith(
      expect.objectContaining({ queries: ['renewal timeline'] }),
      [vector],
    );
  });

  it('rejects direct tool execution when the runtime rollout is disabled', async () => {
    mocks.getServerFeatureFlags.mockResolvedValueOnce({ enableMemory: false });

    await expect(memoryRuntime.factory(createContext())).rejects.toThrow(
      'Memory is not available for this user',
    );
  });

  it('rejects direct tool execution without explicit user consent', async () => {
    mocks.getServerFeatureFlags.mockResolvedValueOnce({ enableMemory: true });
    const context = createContext();
    vi.mocked(context.serverDB!.query.userSettings.findFirst).mockResolvedValueOnce({
      memory: { enabled: false },
    } as never);

    await expect(memoryRuntime.factory(context)).rejects.toThrow('Enable Memory');
  });

  it('rejects direct tool execution in workspace scope', async () => {
    const context = { ...createContext(), workspaceId: 'workspace-1' };

    await expect(memoryRuntime.factory(context)).rejects.toThrow(
      'Memory is only available in personal space',
    );
    expect(mocks.getServerFeatureFlags).not.toHaveBeenCalled();
  });
});
