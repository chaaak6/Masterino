// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';

import { searchRouter } from './search';

const { mockSearch } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/repositories/search', () => ({
  SearchRepo: vi.fn(() => ({ search: mockSearch })),
}));

vi.mock('@/server/services/memory/userMemory/access', () => ({
  isPersonalMemoryEnabled: vi.fn(),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(() => ({
    getAssistantList: vi.fn().mockResolvedValue({ items: [] }),
    getMcpList: vi.fn().mockResolvedValue({ items: [] }),
    getPluginList: vi.fn().mockResolvedValue({ items: [] }),
  })),
}));

const createCaller = (ctxOverrides: Record<string, unknown> = {}) =>
  searchRouter.createCaller({
    marketAccessToken: undefined,
    userId: 'user-1',
    ...ctxOverrides,
  } as any);

describe('searchRouter memory access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as any);
    vi.mocked(isPersonalMemoryEnabled).mockResolvedValue(true);
    mockSearch.mockResolvedValue([]);
  });

  it('does not execute a direct memory search when personal memory is disabled', async () => {
    vi.mocked(isPersonalMemoryEnabled).mockResolvedValue(false);

    await expect(
      createCaller().query({ query: 'private preference', type: 'memory' }),
    ).resolves.toEqual([]);

    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('excludes memory SQL and strips unexpected memory results from a general search', async () => {
    vi.mocked(isPersonalMemoryEnabled).mockResolvedValue(false);
    mockSearch.mockResolvedValue([
      { id: 'memory-1', title: 'Private preference', type: 'memory' },
      { id: 'topic-1', title: 'Public topic', type: 'topic' },
    ]);

    const result = await createCaller().query({ query: 'preference' });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ includeMemory: false, query: 'preference' }),
    );
    expect(result).toEqual([{ id: 'topic-1', title: 'Public topic', type: 'topic' }]);
  });

  it('fails memory closed without breaking non-memory search when the gate errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(isPersonalMemoryEnabled).mockRejectedValue(new Error('settings unavailable'));
    mockSearch.mockResolvedValue([{ id: 'topic-1', title: 'Public topic', type: 'topic' }]);

    await expect(createCaller().query({ query: 'topic' })).resolves.toEqual([
      { id: 'topic-1', title: 'Public topic', type: 'topic' },
    ]);

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ includeMemory: false }));
    consoleError.mockRestore();
  });

  it('allows memory results only after the personal memory gate succeeds', async () => {
    mockSearch.mockResolvedValue([{ id: 'memory-1', title: 'Saved preference', type: 'memory' }]);

    const result = await createCaller().query({ query: 'preference', type: 'memory' });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        includeMemory: true,
        query: 'preference',
        type: 'memory',
      }),
    );
    expect(result).toEqual([{ id: 'memory-1', title: 'Saved preference', type: 'memory' }]);
  });

  it('passes workspace scope into the hard gate and rejects workspace memory search', async () => {
    vi.mocked(isPersonalMemoryEnabled).mockResolvedValue(false);

    await expect(
      createCaller({ workspaceId: 'workspace-1' }).query({
        query: 'preference',
        type: 'memory',
      }),
    ).resolves.toEqual([]);

    expect(isPersonalMemoryEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' }),
    );
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
