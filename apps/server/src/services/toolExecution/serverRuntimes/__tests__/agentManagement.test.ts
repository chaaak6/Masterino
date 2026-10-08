import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { PluginModel } from '@/database/models/plugin';
import { AgentService } from '@/server/services/agent';
import { getNewAgentPlugins } from '@/server/services/agent/newAgentPlugins';

import { agentManagementRuntime } from '../agentManagement';

const {
  mockCreate,
  mockCountAgents,
  mockGetAssistantList,
  mockQueryAgents,
  mockUpdate,
  mockUpdateConfig,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCountAgents: vi.fn(),
  mockGetAssistantList: vi.fn(),
  mockQueryAgents: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    create: mockCreate,
    countAgents: mockCountAgents,
    queryAgents: mockQueryAgents,
    update: mockUpdate,
    updateConfig: mockUpdateConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(() => ({})),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(() => ({
    getAssistantList: mockGetAssistantList,
  })),
}));

const createRuntime = () =>
  agentManagementRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

const createWorkspaceRuntime = () =>
  agentManagementRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

const makeAgents = (count: number, startIndex = 0) =>
  Array.from({ length: count }, (_, i) => ({
    avatar: null,
    backgroundColor: null,
    description: null,
    id: `agent-${startIndex + i}`,
    title: `Agent ${startIndex + i}`,
  }));

describe('agentManagementRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the agent management runtime identifier', () => {
    expect(agentManagementRuntime.identifier).toBe('lobe-agent-management');
  });

  it.each([
    [undefined, ['lobe-user-interaction']],
    [['lobe-web-browsing'], ['lobe-web-browsing', 'lobe-user-interaction']],
    [['lobe-user-interaction', 'lobe-user-interaction'], ['lobe-user-interaction']],
  ])(
    'given an AI-created agent with tools %j, saves User Interaction once',
    async (plugins, expected) => {
      const defaultsSpy = vi
        .spyOn(AgentService.prototype, 'getNewAgentPlugins')
        .mockImplementation(async (tools) => getNewAgentPlugins(tools));
      mockCreate.mockResolvedValue({ id: 'new-agent' });
      const result = await createRuntime().createAgent({ title: 'Test Agent', plugins });

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Agent',
          plugins: expected,
        }),
      );
      defaultsSpy.mockRestore();
    },
  );

  it('throws if required server context is missing', () => {
    expect(() => agentManagementRuntime.factory({ toolManifestMap: {} })).toThrow(
      'userId and serverDB are required for Agent Management execution',
    );
  });

  it('scopes agent and plugin models to workspace context', () => {
    createWorkspaceRuntime();

    expect(AgentModel).toHaveBeenCalledWith(expect.anything(), 'user-1', 'workspace-1');
    expect(PluginModel).toHaveBeenCalledWith(expect.anything(), 'user-1', 'workspace-1');
  });

  describe('callAgent', () => {
    it('fails when the server sub-agent runner is unavailable', async () => {
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
          runAsTask: true,
        },
        { toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'AGENT_CALL_UNAVAILABLE' });
    });

    it('returns a deferred tool result and forks the target agent through the sub-agent runner', async () => {
      const run = vi.fn().mockResolvedValue({
        started: true,
        subOperationId: 'op-child',
        threadId: 'thread-child',
      });
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
          runAsTask: true,
          taskTitle: 'Delegated task',
          timeout: 1234,
        },
        {
          subAgent: { run },
          toolManifestMap: {},
        },
      );

      expect(run).toHaveBeenCalledWith({
        agentId: 'agent-target',
        description: 'Delegated task',
        instruction: 'Do delegated work',
        timeout: 1234,
      });
      expect(result).toMatchObject({
        content: '',
        deferred: true,
        success: true,
      });
      expect(result.state).toMatchObject({
        status: 'pending',
        subOperationId: 'op-child',
        targetAgentId: 'agent-target',
        threadId: 'thread-child',
      });
    });

    it('returns a non-deferred failure when the target agent cannot start', async () => {
      const run = vi.fn().mockResolvedValue({
        started: false,
        threadId: '',
      });
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
          runAsTask: true,
        },
        {
          subAgent: { run },
          toolManifestMap: {},
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({
        code: 'AGENT_CALL_START_FAILED',
      });
      expect(result.deferred).toBeUndefined();
    });

    it('rejects nested server callAgent execution', async () => {
      const run = vi.fn();
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
        },
        {
          isSubAgent: true,
          subAgent: { run },
          toolManifestMap: {},
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'NESTED_AGENT_CALL_NOT_ALLOWED' });
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('searchAgent', () => {
    it('reports the real total and a pagination hint when more agents exist', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(20));
      mockCountAgents.mockResolvedValue(137);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ limit: 20, source: 'user' });

      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: undefined, limit: 20, offset: 0 });
      expect(result.success).toBe(true);
      expect(result.content).toContain('Found 137 agents in your workspace, showing 1-20');
      expect(result.content).toContain('call searchAgent with offset=20');
      expect(result.state).toMatchObject({ hasMore: true, offset: 0, totalCount: 137 });
    });

    it('passes offset through and computes the next page hint from it', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(20, 20));
      mockCountAgents.mockResolvedValue(50);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ limit: 20, offset: 20, source: 'user' });

      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: undefined, limit: 20, offset: 20 });
      expect(result.content).toContain('Found 50 agents in your workspace, showing 21-40');
      expect(result.content).toContain('call searchAgent with offset=40');
      expect(result.state).toMatchObject({ hasMore: true, offset: 20, totalCount: 50 });
    });

    it('notes when the requested limit is capped', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(1));
      mockCountAgents.mockResolvedValue(1);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ limit: 50, source: 'user' });

      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: undefined, limit: 20, offset: 0 });
      expect(result.content).toContain(
        'requested limit 50 exceeds the maximum of 20, so results were capped at 20',
      );
      expect(result.state).toMatchObject({ hasMore: false });
    });

    it('returns no agents found when nothing matches', async () => {
      mockQueryAgents.mockResolvedValue([]);
      mockCountAgents.mockResolvedValue(0);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ keyword: 'nonexistent', source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents found matching your search criteria.');
    });

    it('explains an out-of-range offset instead of claiming no matches', async () => {
      mockQueryAgents.mockResolvedValue([]);
      mockCountAgents.mockResolvedValue(37);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ offset: 200, source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents at offset 200; only 37 agents match');
    });

    it('searches the marketplace without counting workspace agents', async () => {
      mockGetAssistantList.mockResolvedValue({
        items: [{ identifier: 'market-agent-1', title: 'Market Agent' }],
        totalCount: 42,
      });

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ keyword: 'market', source: 'market' });

      expect(mockCountAgents).not.toHaveBeenCalled();
      expect(result.content).toContain('Found 42 agents in the marketplace, showing the first 1');
      expect(result.state).toMatchObject({
        agents: [expect.objectContaining({ id: 'market-agent-1', isMarket: true })],
        totalCount: 42,
      });
    });

    it('combines workspace and marketplace totals for source "all"', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(1));
      mockCountAgents.mockResolvedValue(30);
      mockGetAssistantList.mockResolvedValue({
        items: [{ identifier: 'market-agent-1', title: 'Market Agent' }],
        totalCount: 12,
      });

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ keyword: 'test' });

      expect(result.content).toContain(
        'Found 30 agents in your workspace and 12 in the marketplace, showing 2',
      );
      // next-page hint should direct the model back to workspace-only pagination
      expect(result.content).toContain('call searchAgent with offset=1 and source="user"');
      expect(result.state).toMatchObject({ hasMore: true, totalCount: 42 });
    });

    it('falls back to item count when marketplace omits totalCount', async () => {
      mockGetAssistantList.mockResolvedValue({
        items: [
          { identifier: 'market-agent-1', title: 'Market Agent' },
          { identifier: 'market-agent-2', title: 'Another Agent' },
        ],
        totalCount: undefined,
      });

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ source: 'market' });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ totalCount: 2 });
    });

    it('handles search failure', async () => {
      mockQueryAgents.mockRejectedValue(new Error('DB unavailable'));
      mockCountAgents.mockResolvedValue(0);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ source: 'user' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to search agents');
    });
  });

  describe('updateAgent', () => {
    it('rejects reserved agent env keys before arbitrary config persistence', async () => {
      const runtime = createRuntime();

      const result = await runtime.updateAgent({
        agentId: 'agent-1',
        config: { agencyConfig: { env: { PATH: '/attacker/bin' } } },
      } as any);

      expect(result.success).toBe(false);
      expect(result.content).toContain('managed by the execution runtime: PATH');
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('applies reserved-env validation to a malicious meta payload at the final write boundary', async () => {
      const runtime = createRuntime();

      const result = await runtime.updateAgent({
        agentId: 'agent-1',
        config: { model: 'safe-model' },
        meta: { agencyConfig: { env: { PATH: '/attacker/bin' } } },
      } as any);

      expect(result.success).toBe(false);
      expect(result.content).toContain('managed by the execution runtime: PATH');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('rejects unknown meta fields instead of forwarding them to AgentModel.update', async () => {
      const runtime = createRuntime();

      const result = await runtime.updateAgent({
        agentId: 'agent-1',
        meta: { title: 'Allowed title', userId: 'victim-user' },
      } as any);

      expect(result.success).toBe(false);
      expect(result.content).toContain('Unsupported agent metadata fields: userId');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
