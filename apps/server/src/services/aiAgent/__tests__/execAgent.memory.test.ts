// @vitest-environment node
/**
 * Integration tests for memory enabled priority in execAgent.
 *
 * Verifies that runtime rollout and user consent are hard gates while an agent can opt out.
 */
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, userSettings } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';

import {
  createMockResponsesAPIStream,
  waitForOperationComplete,
} from '../../../routers/lambda/__tests__/integration/aiAgent/helpers';
import {
  cleanupTestUser,
  createTestUser,
} from '../../../routers/lambda/__tests__/integration/setup';
import { aiAgentRouter } from '../../../routers/lambda/aiAgent';

process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn().mockResolvedValue({ enableMemory: true }),
}));

let mockResponsesCreate: any;
let serverDB: LobeChatDatabase;
let userId: string;

const createTestContext = () => ({
  jwtPayload: { userId },
  userId,
});

const hasMemoryTools = (tools: Array<{ name?: string; function?: { name: string } }>) =>
  tools?.some((t) => (t.name || t.function?.name)?.includes('lobe-user-memory'));

const setUserMemorySettings = async (enabled: boolean) => {
  // Try update first, then insert if no row exists
  const result = await serverDB
    .update(userSettings)
    .set({ memory: { enabled } })
    .where(eq(userSettings.id, userId))
    .returning();

  if (result.length === 0) {
    await serverDB.insert(userSettings).values({ id: userId, memory: { enabled } });
  }
};

beforeEach(async () => {
  serverDB = await getTestDB();
  testDB = serverDB;
  userId = await createTestUser(serverDB);
  mockResponsesCreate = vi.spyOn(OpenAI.Responses.prototype, 'create');
  mockResponsesCreate.mockResolvedValue(createMockResponsesAPIStream('Hello') as any);
});

afterEach(async () => {
  await cleanupTestUser(serverDB, userId);
  mockResponsesCreate.mockRestore();
  vi.clearAllMocks();
  inMemoryAgentStateManager.clear();
  inMemoryStreamEventManager.clear();
});

const createTestAgent = async (chatConfig: Record<string, any> = {}) => {
  const [agent] = await serverDB
    .insert(agents)
    .values({
      chatConfig: chatConfig as any,
      model: 'gpt-5-pro',
      provider: 'openai',
      systemRole: 'test',
      title: 'Test',
      userId,
    })
    .returning();
  return agent;
};

describe('execAgent - memory enabled priority', () => {
  it('should disable memory tools when agent config sets memory.enabled = false, even if user enables it', async () => {
    await setUserMemorySettings(true);
    const agent = await createTestAgent({ memory: { enabled: false } });

    const caller = aiAgentRouter.createCaller(createTestContext());
    const result = await caller.execAgent({ agentId: agent.id, prompt: 'Hello' });
    await waitForOperationComplete(inMemoryAgentStateManager, result.operationId);

    const callArgs = mockResponsesCreate.mock.calls[0][0] as { tools?: any[] };
    expect(hasMemoryTools(callArgs.tools ?? [])).toBe(false);
  });

  it('should not let agent config bypass disabled user consent', async () => {
    await setUserMemorySettings(false);
    const agent = await createTestAgent({ memory: { enabled: true } });

    const caller = aiAgentRouter.createCaller(createTestContext());
    const result = await caller.execAgent({ agentId: agent.id, prompt: 'Hello' });
    await waitForOperationComplete(inMemoryAgentStateManager, result.operationId);

    const callArgs = mockResponsesCreate.mock.calls[0][0] as { tools?: any[] };
    expect(hasMemoryTools(callArgs.tools ?? [])).toBe(false);
  });

  it('should fallback to user setting when agent has no memory config', async () => {
    await setUserMemorySettings(false);
    const agent = await createTestAgent();

    const caller = aiAgentRouter.createCaller(createTestContext());
    const result = await caller.execAgent({ agentId: agent.id, prompt: 'Hello' });
    await waitForOperationComplete(inMemoryAgentStateManager, result.operationId);

    const callArgs = mockResponsesCreate.mock.calls[0][0] as { tools?: any[] };
    expect(hasMemoryTools(callArgs.tools ?? [])).toBe(false);
  });

  it('should disable memory by default when neither agent nor user configures it', async () => {
    const agent = await createTestAgent();

    const caller = aiAgentRouter.createCaller(createTestContext());
    const result = await caller.execAgent({ agentId: agent.id, prompt: 'Hello' });
    await waitForOperationComplete(inMemoryAgentStateManager, result.operationId);

    const callArgs = mockResponsesCreate.mock.calls[0][0] as { tools?: any[] };
    expect(hasMemoryTools(callArgs.tools ?? [])).toBe(false);
  });

  it('should enable memory after user consent when the agent does not opt out', async () => {
    await setUserMemorySettings(true);
    const agent = await createTestAgent({ memory: { enabled: true } });

    const caller = aiAgentRouter.createCaller(createTestContext());
    const result = await caller.execAgent({ agentId: agent.id, prompt: 'Hello' });
    await waitForOperationComplete(inMemoryAgentStateManager, result.operationId);

    const callArgs = mockResponsesCreate.mock.calls[0][0] as { tools?: any[] };
    expect(hasMemoryTools(callArgs.tools ?? [])).toBe(true);
  });
});
