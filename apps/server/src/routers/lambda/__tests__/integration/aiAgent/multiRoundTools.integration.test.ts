// @vitest-environment node
/**
 * Integration tests for multi-round tool execution
 * Tests fix: tool messages should not be duplicated across rounds
 *
 * Note: AgentStateManager and StreamEventManager will automatically use
 * InMemory implementations when Redis is not available (test environment).
 */
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inMemoryAgentStateManager } from '@/server/modules/AgentRuntime/InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';
import { MessageService } from '@/server/services/message';
import { ToolExecutionService } from '@/server/services/toolExecution';

import { aiAgentRouter } from '../../../aiAgent';
import { cleanupTestUser, createTestUser } from '../setup';
import { createMockResponsesStream, waitForOperationComplete } from './helpers';

// Set fake API key for testing to bypass OpenAI SDK validation
process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock FileService to avoid S3 environment variable requirements
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));

let mockResponsesCreate: any;

let serverDB: LobeChatDatabase;
let userId: string;
let testAgentWithToolsId: string;

const createTestContext = () => ({
  jwtPayload: { userId },
  userId,
});

// Helper to create mock streaming response with multiple tool calls
const createMockResponseWithMultipleTools = (roundNum: number) => {
  const responseId = `resp_round${roundNum}_${Date.now()}`;
  const msgItemId = `msg_round${roundNum}_${Date.now()}`;
  const toolCallId1 = `call_search_round${roundNum}`;
  const toolCallId2 = `call_crawl_round${roundNum}`;

  const chunks = [
    {
      type: 'response.created',
      response: {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'in_progress',
        model: 'gpt-5-pro',
        output: [],
      },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        id: msgItemId,
        type: 'message',
        status: 'in_progress',
        content: [],
        role: 'assistant',
      },
    },
    {
      type: 'response.output_text.delta',
      item_id: msgItemId,
      output_index: 0,
      content_index: 0,
      delta: `Round ${roundNum}: Let me search and crawl for you.`,
    },
    {
      type: 'response.output_item.added',
      output_index: 1,
      item: {
        type: 'function_call',
        call_id: toolCallId1,
        name: 'lobe-web-browsing____search',
        arguments: JSON.stringify({ query: `query_round${roundNum}` }),
      },
    },
    {
      type: 'response.output_item.added',
      output_index: 2,
      item: {
        type: 'function_call',
        call_id: toolCallId2,
        name: 'lobe-web-browsing____crawl',
        arguments: JSON.stringify({ url: `https://example.com/page${roundNum}` }),
      },
    },
    {
      type: 'response.completed',
      response: {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: 'gpt-5-pro',
        output: [
          {
            id: msgItemId,
            type: 'message',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: `Round ${roundNum}: Let me search and crawl for you.`,
              },
            ],
            role: 'assistant',
          },
          {
            type: 'function_call',
            call_id: toolCallId1,
            name: 'lobe-web-browsing____search',
            arguments: JSON.stringify({ query: `query_round${roundNum}` }),
          },
          {
            type: 'function_call',
            call_id: toolCallId2,
            name: 'lobe-web-browsing____crawl',
            arguments: JSON.stringify({ url: `https://example.com/page${roundNum}` }),
          },
        ],
        usage: {
          input_tokens: 50 * roundNum,
          output_tokens: 30,
          total_tokens: 50 * roundNum + 30,
        },
      },
    },
  ];

  return createMockResponsesStream(chunks);
};

// Helper to create final response (no tools)
const createMockFinalResponse = () => {
  const responseId = `resp_final_${Date.now()}`;
  const msgItemId = `msg_final_${Date.now()}`;
  const finalContent = 'Based on my research across multiple rounds, here is the final answer.';

  const chunks = [
    {
      type: 'response.created',
      response: {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'in_progress',
        model: 'gpt-5-pro',
        output: [],
      },
    },
    {
      type: 'response.output_text.delta',
      item_id: msgItemId,
      output_index: 0,
      content_index: 0,
      delta: finalContent,
    },
    {
      type: 'response.completed',
      response: {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: 'gpt-5-pro',
        output: [
          {
            id: msgItemId,
            type: 'message',
            status: 'completed',
            content: [{ type: 'output_text', text: finalContent }],
            role: 'assistant',
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 50,
          total_tokens: 250,
        },
      },
    },
  ];

  return createMockResponsesStream(chunks);
};

beforeEach(async () => {
  // Setup test database
  serverDB = await getTestDB();
  testDB = serverDB;
  userId = await createTestUser(serverDB);

  // Create test agent with search enabled via chatConfig.searchMode
  const [agentWithTools] = await serverDB
    .insert(agents)
    .values({
      chatConfig: { searchMode: 'auto' },
      model: 'gpt-5-pro',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant that can search and crawl the web.',
      title: 'Test Assistant for Multi-Round Tools',
      userId,
    })
    .returning();
  testAgentWithToolsId = agentWithTools.id;

  // Setup spyOn for OpenAI Responses API prototype
  mockResponsesCreate = vi.spyOn(OpenAI.Responses.prototype, 'create');
});

afterEach(async () => {
  await cleanupTestUser(serverDB, userId);
  vi.clearAllMocks();
  vi.restoreAllMocks();

  // Clear singleton instances for next test
  inMemoryAgentStateManager.clear();
  inMemoryStreamEventManager.clear();
});

describe('Multi-Round Tool Execution', () => {
  it('uses the checkpoint for the selected branch in a new provider request', async () => {
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: testAgentWithToolsId, userId })
      .returning({ id: topics.id });
    const id = (name: string) => `${topic.id}-${name}`;
    await serverDB.insert(messages).values(
      [
        { id: id('question'), role: 'user' as const, content: 'The original question' },
        {
          id: id('a'),
          role: 'assistant' as const,
          parentId: id('question'),
          content: 'RAW-BRANCH-A',
        },
        {
          id: id('b'),
          role: 'assistant' as const,
          parentId: id('question'),
          content: 'RAW-BRANCH-B',
        },
      ].map((row, index) => ({
        ...row,
        agentId: testAgentWithToolsId,
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
        topicId: topic.id,
        userId,
      })),
    );
    const messageService = new MessageService(serverDB, userId);
    const summary = await messageService.createCompressionGroup(topic.id, [
      id('question'),
      id('a'),
    ]);
    await messageService.finalizeCompression(
      summary.messageGroupId,
      'CHECKPOINT-BRANCH-A',
      {
        agentId: testAgentWithToolsId,
        topicId: topic.id,
      },
      false,
    );
    mockResponsesCreate.mockResolvedValue(createMockFinalResponse() as any);

    const caller = aiAgentRouter.createCaller(createTestContext());
    const result = await caller.execAgent({
      agentId: testAgentWithToolsId,
      appContext: { historyHeadId: id('a'), topicId: topic.id },
      prompt: 'Use the decision I selected',
    });
    const state = await waitForOperationComplete(inMemoryAgentStateManager, result.operationId);
    expect(state.status).toBe('done');
    const modelInput = JSON.stringify(mockResponsesCreate.mock.calls[0][0].input);
    expect(modelInput).toContain('CHECKPOINT-BRANCH-A');
    expect(modelInput).not.toContain('RAW-BRANCH-B');
    expect(modelInput).toContain('Use the decision I selected');
    expect(
      await messageService.queryAgentMessages({
        historyHeadId: result.userMessageId,
        topicId: topic.id,
      }),
    ).toEqual([
      expect.objectContaining({ content: 'CHECKPOINT-BRANCH-A' }),
      expect.objectContaining({ content: 'Use the decision I selected', parentId: id('a') }),
    ]);
  }, 30_000);

  /**
   * This test verifies the fix:
   * When executing multiple rounds of batch tool calls, tool messages should not be duplicated.
   *
   * Scenario: LLM returns multiple tool calls in each round
   * - Round 1: LLM -> 2 tools (search + crawl) -> tool results
   * - Round 2: LLM -> 2 tools (search + crawl) -> tool results
   * - Round 3: LLM -> final response
   *
   * Expected: 4 tool messages total (2 from round 1 + 2 from round 2), no duplicates
   */
  it('should not duplicate tool messages across multiple LLM rounds with batch tool execution', async () => {
    let callCount = 0;
    mockResponsesCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(createMockResponseWithMultipleTools(1) as any);
      } else if (callCount === 2) {
        return Promise.resolve(createMockResponseWithMultipleTools(2) as any);
      }
      return Promise.resolve(createMockFinalResponse() as any);
    });

    const mockExecuteTool = vi.spyOn(ToolExecutionService.prototype, 'executeTool');
    mockExecuteTool.mockImplementation(async (toolCall) => {
      const isSearch = toolCall.apiName === 'search';
      return {
        content: JSON.stringify({
          result: isSearch ? 'Search results' : 'Crawled content',
          tool: toolCall.apiName,
          id: toolCall.id,
        }),
        error: null,
        executionTime: 100,
        state: {},
        success: true,
      };
    });

    const caller = aiAgentRouter.createCaller(createTestContext());

    const createResult = await caller.execAgent({
      agentId: testAgentWithToolsId,
      prompt: 'Please search and crawl multiple pages for comprehensive research',
    });

    expect(createResult.success).toBe(true);

    // Wait for async execution to complete
    const finalState = await waitForOperationComplete(
      inMemoryAgentStateManager,
      createResult.operationId,
    );

    expect(finalState.status).toBe('done');

    const allMessages = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.agentId, testAgentWithToolsId));

    const toolMessages = allMessages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(4);

    const toolCallIdsFromContent = toolMessages
      .map((m) => {
        try {
          const parsed = JSON.parse(m.content || '{}');
          return parsed.id;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const uniqueToolCallIds = [...new Set(toolCallIdsFromContent)];
    expect(toolCallIdsFromContent.length).toBe(uniqueToolCallIds.length);

    expect(toolCallIdsFromContent.sort()).toEqual([
      'call_crawl_round1',
      'call_crawl_round2',
      'call_search_round1',
      'call_search_round2',
    ]);

    expect(allMessages).toHaveLength(8);

    const assistantMessages = allMessages.filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(3);

    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);

    mockExecuteTool.mockRestore();
  }, 30_000);

  it('sends calls and results together across tool rounds after 1,000 records', async () => {
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: testAgentWithToolsId, userId })
      .returning({ id: topics.id });
    const history = Array.from({ length: 1001 }, (_, index) => ({
      agentId: testAgentWithToolsId,
      content: index === 1000 ? 'QA-LATEST-USER-1000' : 'Earlier turn',
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
      id: `${topic.id}-history-${index}`,
      parentId: index ? `${topic.id}-history-${index - 1}` : null,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      topicId: topic.id,
      userId,
    }));
    await serverDB.insert(messages).values(history);

    let callCount = 0;
    mockResponsesCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(createMockResponseWithMultipleTools(1) as any);
      } else if (callCount === 2) {
        return Promise.resolve(createMockResponseWithMultipleTools(2) as any);
      }
      return Promise.resolve(createMockFinalResponse() as any);
    });

    const mockExecuteTool = vi.spyOn(ToolExecutionService.prototype, 'executeTool');
    mockExecuteTool.mockResolvedValue({
      content: JSON.stringify({ result: 'Tool executed' }),
      error: null,
      executionTime: 100,
      state: {},
      success: true,
    });

    const caller = aiAgentRouter.createCaller(createTestContext());

    const createResult = await caller.execAgent({
      agentId: testAgentWithToolsId,
      appContext: { topicId: topic.id },
      parentMessageId: history[1000].id,
      prompt: history[1000].content,
    });

    const finalState = await waitForOperationComplete(
      inMemoryAgentStateManager,
      createResult.operationId,
    );

    expect(finalState.status).toBe('done');
    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(mockResponsesCreate.mock.calls[0][0].input)).toContain(
      'QA-LATEST-USER-1000',
    );

    for (const round of [1, 2]) {
      const { input } = mockResponsesCreate.mock.calls[round][0];
      for (const tool of ['search', 'crawl']) {
        const callId = `call_${tool}_round${round}`;
        const callIndex = input.findIndex(
          (item: { call_id?: string; type?: string }) =>
            item.type === 'function_call' && item.call_id === callId,
        );
        const resultIndex = input.findIndex(
          (item: { call_id?: string; type?: string }) =>
            item.type === 'function_call_output' && item.call_id === callId,
        );
        expect(callIndex).toBeGreaterThanOrEqual(0);
        expect(resultIndex).toBeGreaterThan(callIndex);
      }
    }

    mockExecuteTool.mockRestore();
  }, 30_000);
});
