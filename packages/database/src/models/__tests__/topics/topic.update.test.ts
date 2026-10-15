import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-update-user';
const sessionId = 'topic-update-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - Update', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('update', () => {
    it('should update a topic', async () => {
      const topicId = '123';
      await serverDB.insert(topics).values({ userId, id: topicId, title: 'Test', favorite: true });

      const item = await topicModel.update(topicId, {
        title: 'Updated Test',
        favorite: false,
      });

      expect(item).toHaveLength(1);
      expect(item[0].title).toBe('Updated Test');
      expect(item[0].favorite).toBeFalsy();
    });

    it('should not update a topic if user ID does not match', async () => {
      await serverDB.insert(users).values([{ id: '456' }]);
      const topicId = '123';
      await serverDB
        .insert(topics)
        .values({ userId: '456', id: topicId, title: 'Test', favorite: true });

      const item = await topicModel.update(topicId, {
        title: 'Updated Test Session',
      });

      expect(item).toHaveLength(0);
    });
  });

  describe('updateMetadata', () => {
    it('atomically preserves unrelated metadata and nested memory run fields', async () => {
      const topicId = 'metadata-memory-merge';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        metadata: {
          model: 'gpt-4',
          userMemoryExtractRunState: { messageCount: 3, traceId: 'trace-1' },
        },
      });

      await Promise.all([
        topicModel.updateMetadata(topicId, { workingDirectory: '/new/path' }),
        topicModel.updateMemoryExtractionMetadata(topicId, 'failed', {
          error: 'gateway timeout',
          lastRunAt: '2026-10-13T00:00:00.000Z',
        }),
      ]);

      const topic = await serverDB.query.topics.findFirst({ where: eq(topics.id, topicId) });
      expect(topic?.metadata).toMatchObject({
        model: 'gpt-4',
        userMemoryExtractRunState: {
          error: 'gateway timeout',
          lastRunAt: '2026-10-13T00:00:00.000Z',
          messageCount: 3,
          traceId: 'trace-1',
        },
        userMemoryExtractStatus: 'failed',
        workingDirectory: '/new/path',
      });

      await topicModel.updateMemoryExtractionMetadata(topicId, 'completed', {
        processedMemoryCount: 2,
      });
      const completed = await serverDB.query.topics.findFirst({ where: eq(topics.id, topicId) });
      expect(completed?.metadata?.userMemoryExtractStatus).toBe('completed');
      expect(completed?.metadata?.userMemoryExtractRunState?.error).toBeUndefined();
      expect(completed?.metadata?.userMemoryExtractRunState?.traceId).toBe('trace-1');
    });

    it('should update metadata on a topic with no existing metadata', async () => {
      const topicId = 'metadata-test-1';
      await serverDB.insert(topics).values({ userId, id: topicId, title: 'Test' });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/path/to/dir',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({ workingDirectory: '/path/to/dir' });
    });

    it('should merge metadata with existing metadata', async () => {
      const topicId = 'metadata-test-2';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: { model: 'gpt-4', provider: 'openai' },
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/new/path',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        workingDirectory: '/new/path',
      });
    });

    it('should overwrite existing metadata fields when updating', async () => {
      const topicId = 'metadata-test-3';
      await serverDB.insert(topics).values({
        userId,
        id: topicId,
        title: 'Test',
        metadata: { workingDirectory: '/old/path', model: 'gpt-4' },
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/new/path',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({
        model: 'gpt-4',
        workingDirectory: '/new/path',
      });
    });

    it('should not update metadata if user ID does not match', async () => {
      await serverDB.insert(users).values([{ id: 'other-user' }]);
      const topicId = 'metadata-test-4';
      await serverDB.insert(topics).values({
        userId: 'other-user',
        id: topicId,
        title: 'Test',
      });

      const result = await topicModel.updateMetadata(topicId, {
        workingDirectory: '/path/to/dir',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('completeRunningOperation', () => {
    it('atomically clears the matching operation and returns the topic to active', async () => {
      const topicId = 'complete-operation-1';
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          model: 'gpt-4o',
          runningOperation: { assistantMessageId: 'msg-1', operationId: 'op-1' },
        },
        status: 'running',
        title: 'Running topic',
        userId,
      });

      const result = await topicModel.completeRunningOperation(topicId, 'op-1', 'active');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
      expect(result[0].metadata).toEqual({ model: 'gpt-4o', runningOperation: null });
    });

    it('does not let an older completion clear a newer running operation', async () => {
      const topicId = 'complete-operation-2';
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: { assistantMessageId: 'msg-new', operationId: 'op-new' },
        },
        status: 'running',
        title: 'Newer run',
        userId,
      });

      const result = await topicModel.completeRunningOperation(topicId, 'op-old', 'active');
      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));

      expect(result).toHaveLength(0);
      expect(topic.status).toBe('running');
      expect(topic.metadata?.runningOperation?.operationId).toBe('op-new');
    });

    it('persists a terminal failure while clearing the matching operation', async () => {
      const topicId = 'complete-operation-3';
      await serverDB.insert(topics).values({
        id: topicId,
        metadata: {
          runningOperation: { assistantMessageId: 'msg-3', operationId: 'op-3' },
        },
        status: 'running',
        title: 'Failed run',
        userId,
      });

      const result = await topicModel.completeRunningOperation(topicId, 'op-3', 'failed');

      expect(result[0].status).toBe('failed');
      expect(result[0].metadata?.runningOperation).toBeNull();
    });
  });

  describe('recomputeUsage', () => {
    it('rolls the topic assistant messages into the denormalized usage/cost columns', async () => {
      const topicId = 'usage-recompute-1';
      await serverDB.insert(topics).values({ id: topicId, sessionId, userId });
      await serverDB.insert(messages).values([
        {
          id: 'usage-msg-1',
          metadata: {
            performance: { duration: 500 },
            usage: { cost: 0.003, totalInputTokens: 60, totalOutputTokens: 40, totalTokens: 100 },
          },
          model: 'gpt-4o',
          provider: 'openai',
          role: 'assistant',
          topicId,
          userId,
        },
        // a non-usage message must be ignored
        { id: 'usage-msg-2', content: 'hi', role: 'user', topicId, userId },
      ]);

      await topicModel.recomputeUsage(topicId);

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(topic.totalTokens).toBe(100);
      expect(topic.totalInputTokens).toBe(60);
      expect(topic.totalOutputTokens).toBe(40);
      expect(topic.totalCost).toBeCloseTo(0.003, 6);
      expect(topic.model).toBe('gpt-4o');
      expect(topic.provider).toBe('openai');
      expect((topic.usage as any).llm).toEqual({
        apiCalls: 1,
        processingTimeMs: 500,
        tokens: { input: 60, output: 40, total: 100 },
      });
    });

    it('resets the usage columns to NULL when the topic has no measurable usage', async () => {
      const topicId = 'usage-recompute-2';
      await serverDB.insert(topics).values({
        id: topicId,
        sessionId,
        totalCost: 1.23,
        totalTokens: 999,
        userId,
      });

      await topicModel.recomputeUsage(topicId);

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(topic.totalTokens).toBeNull();
      expect(topic.totalCost).toBeNull();
      expect(topic.usage).toBeNull();
      expect(topic.cost).toBeNull();
    });
  });
});
