// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';

import { runMemoryActionAgent } from '../userMemory';

vi.mock('@/server/services/memory/userMemory/access', () => ({
  isPersonalMemoryEnabled: vi.fn(),
}));

describe('runMemoryActionAgent memory consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPersonalMemoryEnabled).mockResolvedValue(true);
  });

  it('stops before loading agent or plugin state when personal memory is disabled', async () => {
    vi.mocked(isPersonalMemoryEnabled).mockResolvedValue(false);
    const getAgentConfig = vi.fn();
    const queryPlugins = vi.fn();

    const result = await runMemoryActionAgent(
      { agentId: 'agent-1', message: 'Remember this preference.' },
      {
        agentService: { getAgentConfig },
        db: {} as never,
        pluginModel: { query: queryPlugins },
        userId: 'user-1',
      },
    );

    expect(result).toEqual({
      detail: 'Personal Memory is disabled or unavailable for this user.',
      status: 'skipped',
    });
    expect(getAgentConfig).not.toHaveBeenCalled();
    expect(queryPlugins).not.toHaveBeenCalled();
  });

  it('honors an agent-level opt-out after user consent succeeds', async () => {
    const getAgentConfig = vi.fn().mockResolvedValue({
      chatConfig: { memory: { enabled: false } },
      model: 'glm-5.2',
      provider: 'newapi',
    });
    const queryPlugins = vi.fn();

    const result = await runMemoryActionAgent(
      { agentId: 'agent-1', message: 'Remember this preference.' },
      {
        agentService: { getAgentConfig },
        db: {} as never,
        pluginModel: { query: queryPlugins },
        userId: 'user-1',
      },
    );

    expect(result).toEqual({
      detail: 'Memory is disabled for this agent.',
      status: 'skipped',
    });
    expect(queryPlugins).not.toHaveBeenCalled();
  });

  it('blocks workspace memory before loading personal agent state', async () => {
    vi.mocked(isPersonalMemoryEnabled).mockResolvedValue(false);
    const getAgentConfig = vi.fn();

    await runMemoryActionAgent(
      { agentId: 'agent-1', message: 'Remember this preference.' },
      {
        agentService: { getAgentConfig },
        db: {} as never,
        pluginModel: { query: vi.fn() },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    );

    expect(isPersonalMemoryEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
    expect(getAgentConfig).not.toHaveBeenCalled();
  });
});
