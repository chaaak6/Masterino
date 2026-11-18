// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  agentsToSessions,
  files,
  messageGroups,
  messages,
  sessions,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { MessageGroupType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageService } from '../index';

// Mock FileService to avoid S3 environment variable requirements
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-service-integration-test';
const otherUserId = 'message-service-integration-test-other';

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);

    await trx.insert(files).values({
      id: 'f1',
      userId,
      url: 'abc',
      name: 'file-1',
      fileType: 'image/png',
      size: 1000,
    });
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageService Integration Tests', () => {
  it('acknowledges a saved assistant tool call beyond the legacy history page', async () => {
    const topicId = 'long-conversation';
    await serverDB.insert(topics).values({ id: topicId, userId });
    await serverDB.insert(messages).values(
      Array.from({ length: 1002 }, (_, index) => ({
        content: index < 1000 ? 'Earlier turn' : '',
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
        id: `long-message-${index}`,
        parentId: index ? `long-message-${index - 1}` : null,
        role: index % 2 === 0 ? 'user' : 'assistant',
        topicId,
        userId,
      })),
    );
    const service = new MessageService(serverDB, userId);
    const tools = [
      {
        apiName: 'read',
        arguments: '{}',
        id: 'late-call',
        identifier: 'qa',
        type: 'builtin' as const,
      },
    ];

    const result = await service.updateMessage(
      'long-message-1001',
      { tools },
      { topicId },
      { returnUpdatedMessage: true },
    );

    expect(Object.keys(result).sort()).toEqual(['message', 'success']);
    expect(result).toMatchObject({
      message: expect.objectContaining({
        id: 'long-message-1001',
        parentId: 'long-message-1000',
        tools,
      }),
      success: true,
    });

    const history = await service.queryMessages({ topicId });
    expect(history).toHaveLength(1002);
    expect(history.at(0)?.id).toBe('long-message-0');
    expect(history.at(-1)?.id).toBe('long-message-1001');
  });

  describe('createMessage', () => {
    it('should create message with agentId and return message list', async () => {
      const messageService = new MessageService(serverDB, userId);

      // Create agent and session
      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      const result = await messageService.createMessage({
        agentId: 'agent-1',
        content: 'Hello world',
        role: 'user',
      });

      expect(result.id).toBeDefined();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello world');
      expect(result.messages[0].role).toBe('user');
    });

    it('should create message with topicId', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });
      await serverDB.insert(topics).values({ id: 'topic-1', userId, sessionId: 'session-1' });

      const result = await messageService.createMessage({
        agentId: 'agent-1',
        content: 'Topic message',
        role: 'user',
        topicId: 'topic-1',
      });

      expect(result.id).toBeDefined();
      expect(result.messages[0].topicId).toBe('topic-1');
    });
  });

  describe('queryWithSuccess with agentId', () => {
    it('should query messages by agentId (new data)', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      // Create messages with agentId directly (new data pattern)
      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'message 1' },
        { id: 'msg-2', userId, agentId: 'agent-1', role: 'assistant', content: 'message 2' },
      ]);

      // Use removeMessage to trigger queryWithSuccess
      const result = await messageService.removeMessage('msg-1', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-2');
    });

    it('should query messages by agentId (legacy sessionId data)', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      // Create messages with sessionId only (legacy data pattern)
      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, sessionId: 'session-1', role: 'user', content: 'legacy message 1' },
        {
          id: 'msg-2',
          userId,
          sessionId: 'session-1',
          role: 'assistant',
          content: 'legacy message 2',
        },
      ]);

      // Query using agentId should find legacy sessionId data via OR condition
      const result = await messageService.removeMessage('msg-1', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-2');
    });

    it('should query mixed data (both agentId and sessionId)', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      // Create mixed messages
      await serverDB.insert(messages).values([
        // Legacy data (sessionId only)
        { id: 'msg-1', userId, sessionId: 'session-1', role: 'user', content: 'legacy message' },
        // New data (agentId only)
        { id: 'msg-2', userId, agentId: 'agent-1', role: 'assistant', content: 'new message' },
        // Both fields
        {
          id: 'msg-3',
          userId,
          agentId: 'agent-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'both fields',
        },
      ]);

      // Create a dummy message to delete
      await serverDB
        .insert(messages)
        .values({ id: 'msg-to-delete', userId, agentId: 'agent-1', role: 'user', content: 'temp' });

      const result = await messageService.removeMessage('msg-to-delete', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      // Should find all 3 messages via OR condition
      expect(result.messages).toHaveLength(3);
    });
  });

  describe('queryWithSuccess with sessionId (backward compatibility)', () => {
    it('should still work with sessionId for backward compatibility', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(sessions).values({ id: 'session-1', userId });

      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, sessionId: 'session-1', role: 'user', content: 'message 1' },
        { id: 'msg-2', userId, sessionId: 'session-1', role: 'assistant', content: 'message 2' },
      ]);

      const result = await messageService.removeMessage('msg-1', { sessionId: 'session-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-2');
    });
  });

  describe('removeMessages', () => {
    it('should delete multiple messages and return remaining', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'message 1' },
        { id: 'msg-2', userId, agentId: 'agent-1', role: 'assistant', content: 'message 2' },
        { id: 'msg-3', userId, agentId: 'agent-1', role: 'user', content: 'message 3' },
      ]);

      const result = await messageService.removeMessages(['msg-1', 'msg-2'], {
        agentId: 'agent-1',
      });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-3');
    });
  });

  describe('updateMessage', () => {
    it('should update message and return message list with agentId', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      await serverDB
        .insert(messages)
        .values([
          { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'original content' },
        ]);

      const result = await messageService.updateMessage(
        'msg-1',
        { content: 'updated content' },
        { agentId: 'agent-1' },
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].content).toBe('updated content');
    });

    it('should persist message errors and return them in queried messages', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });
      await serverDB.insert(topics).values({ id: 'topic-1', userId, sessionId: 'session-1' });

      await serverDB.insert(messages).values({
        id: 'msg-err-1',
        userId,
        agentId: 'agent-1',
        topicId: 'topic-1',
        role: 'assistant',
        content: '',
      });

      const messageError = {
        body: {
          agentType: 'claude-code',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          message: 'Failed to authenticate. API Error: 401',
        },
        message: 'Failed to authenticate. API Error: 401',
        type: AgentRuntimeErrorType.AgentRuntimeError,
      };

      const result = await messageService.updateMessage(
        'msg-err-1',
        { error: messageError },
        { agentId: 'agent-1', topicId: 'topic-1' },
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].error).toEqual(messageError);
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and return message list with agentId', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      await serverDB
        .insert(messages)
        .values([{ id: 'msg-1', userId, agentId: 'agent-1', role: 'assistant', content: 'test' }]);

      const result = await messageService.updateMetadata(
        'msg-1',
        { duration: 1000 },
        { agentId: 'agent-1' },
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('user isolation', () => {
    it('should not return messages from other users', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values([
        { id: 'agent-1', userId },
        { id: 'agent-2', userId: otherUserId },
      ]);
      await serverDB.insert(sessions).values([
        { id: 'session-1', userId },
        { id: 'session-2', userId: otherUserId },
      ]);
      await serverDB.insert(agentsToSessions).values([
        { agentId: 'agent-1', sessionId: 'session-1', userId },
        { agentId: 'agent-2', sessionId: 'session-2', userId: otherUserId },
      ]);

      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'my message' },
        {
          id: 'msg-2',
          userId: otherUserId,
          agentId: 'agent-2',
          role: 'user',
          content: 'other user message',
        },
      ]);

      // Create a dummy message to trigger query
      await serverDB
        .insert(messages)
        .values({ id: 'msg-to-delete', userId, agentId: 'agent-1', role: 'user', content: 'temp' });

      const result = await messageService.removeMessage('msg-to-delete', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-1');
      // Should not include other user's messages
      expect(result.messages!.every((m) => m.id !== 'msg-2')).toBe(true);
    });
  });

  describe('finalizeCompression', () => {
    it('keeps the source messages when cancellation and publication overlap', async () => {
      const topicId = 'compression-cancel';
      await serverDB.insert(topics).values({ id: topicId, userId });
      await serverDB.insert(messages).values({
        content: 'Original text',
        id: 'compression-cancel-source',
        role: 'user',
        topicId,
        userId,
      });
      const service = new MessageService(serverDB, userId);
      const staged = await service.createCompressionGroup(topicId, ['compression-cancel-source']);
      await Promise.allSettled([
        service.finalizeCompression(staged.messageGroupId, 'Summary', {
          agentId: 'unused',
          topicId,
        }),
        service.cancelCompression(staged.messageGroupId, { topicId }),
      ]);
      expect(await service.queryMessages({ topicId })).toEqual([
        expect.objectContaining({ content: 'Original text', id: 'compression-cancel-source' }),
      ]);
    });

    it('uses a verified prefix with the latest 80 originals and falls back after an edit', async () => {
      const topicId = 'compressed-long-conversation';
      const id = (index: number) => `long-prefix-${String(index).padStart(4, '0')}`;
      await serverDB.insert(topics).values({ id: topicId, userId });
      await serverDB.insert(messages).values(
        Array.from({ length: 3000 }, (_, index) => ({
          content: index === 2999 ? 'Latest original' : 'Earlier turn',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          id: id(index),
          parentId: index ? id(index - 1) : null,
          role: index % 2 === 0 ? 'user' : 'assistant',
          topicId,
          userId,
        })),
      );
      const service = new MessageService(serverDB, userId);
      const ids = Array.from({ length: 2920 }, (_, index) => id(index));
      const staged = await service.createCompressionGroup(topicId, ids);
      await service.finalizeCompression(staged.messageGroupId, 'Confirmed earlier decision', {
        agentId: 'unused',
        topicId,
      });

      const context = await service.queryAgentMessages({ topicId });
      expect(context).toHaveLength(81);
      expect(context.find((entry) => entry.role === 'compressedGroup')).toMatchObject({
        compressedMessages: [],
        content: 'Confirmed earlier decision',
        lastMessageId: id(2919),
      });
      expect(
        context.filter((entry) => entry.role !== 'compressedGroup').map((entry) => entry.id),
      ).toEqual(Array.from({ length: 80 }, (_, index) => id(2920 + index)));

      await service.updateMessage(id(10), { content: 'Edited earlier decision' }, {});
      const recovered = await service.queryAgentMessages({ topicId });
      expect(recovered).toHaveLength(3000);
      expect(recovered.find((entry) => entry.id === id(10))?.content).toBe(
        'Edited earlier decision',
      );
      expect(recovered.some((entry) => entry.role === 'compressedGroup')).toBe(false);
    });

    it('leaves originals visible while summarizing and rejects publication after a source edit', async () => {
      const topicId = 'compression-edit';
      await serverDB.insert(topics).values({ id: topicId, userId });
      await serverDB.insert(messages).values({
        content: 'Original text',
        id: 'compression-source',
        role: 'user',
        topicId,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        userId,
      });
      const service = new MessageService(serverDB, userId);
      const staged = await service.createCompressionGroup(topicId, ['compression-source']);
      expect((await service.queryMessages({ topicId })).map(({ id }) => id)).toEqual([
        'compression-source',
      ]);

      await service.updateMessage('compression-source', { content: 'Edited text' }, {});
      await expect(
        service.finalizeCompression(staged.messageGroupId, 'Old summary', {
          agentId: 'unused',
          topicId,
        }),
      ).rejects.toThrow('Compression source changed before publication');
      expect(await service.queryMessages({ topicId })).toEqual([
        expect.objectContaining({ content: 'Edited text' }),
      ]);
    });

    it('should create assistant message with correct parentId (last compressed message ID, not messageGroupId)', async () => {
      const messageService = new MessageService(serverDB, userId);

      // Setup: agent, session, topic
      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });
      await serverDB.insert(topics).values({ id: 'topic-1', userId, sessionId: 'session-1' });

      // Create messages to be compressed
      await serverDB.insert(messages).values([
        {
          id: 'msg-1',
          userId,
          agentId: 'agent-1',
          topicId: 'topic-1',
          role: 'user',
          content: 'message 1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          userId,
          agentId: 'agent-1',
          topicId: 'topic-1',
          role: 'assistant',
          content: 'message 2',
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'msg-3',
          userId,
          agentId: 'agent-1',
          topicId: 'topic-1',
          role: 'user',
          content: 'message 3 - this is the last compressed message',
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
      ]);

      // Create compression group
      await serverDB.insert(messageGroups).values({
        id: 'comp-group-1',
        userId,
        topicId: 'topic-1',
        content: '...',
        type: MessageGroupType.Compression,
        createdAt: new Date('2024-01-01T10:02:30Z'),
      });

      // Mark messages as compressed
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-group-1' })
        .where(eq(messages.topicId, 'topic-1'));

      // Call finalizeCompression
      const result = await messageService.finalizeCompression('comp-group-1', 'Summary content', {
        agentId: 'agent-1',
        topicId: 'topic-1',
      });

      expect(result.success).toBe(true);
      expect(result.messages).toBeDefined();

      // Verify compression content was updated
      const updatedGroup = await serverDB
        .select()
        .from(messageGroups)
        .where(eq(messageGroups.id, 'comp-group-1'));

      expect(updatedGroup).toHaveLength(1);
      expect(updatedGroup[0].content).toBe('Summary content');
    });

    it('retains a failed group for audit while restoring it out of the visible trajectory', async () => {
      const messageService = new MessageService(serverDB, userId);
      await serverDB.insert(agents).values({ id: 'agent-failed', userId });
      await serverDB.insert(sessions).values({ id: 'session-failed', userId });
      await serverDB.insert(agentsToSessions).values({
        agentId: 'agent-failed',
        sessionId: 'session-failed',
        userId,
      });
      await serverDB.insert(topics).values({
        id: 'topic-failed',
        sessionId: 'session-failed',
        userId,
      });
      await serverDB.insert(messages).values([
        {
          agentId: 'agent-failed',
          content: 'original user message',
          id: 'failed-source-1',
          role: 'user',
          topicId: 'topic-failed',
          userId,
        },
        {
          agentId: 'agent-failed',
          content: 'original assistant message',
          id: 'failed-source-2',
          role: 'assistant',
          topicId: 'topic-failed',
          userId,
        },
      ]);

      const pending = await messageService.createCompressionGroup(
        'topic-failed',
        ['failed-source-1', 'failed-source-2'],
        { agentId: 'agent-failed', topicId: 'topic-failed' },
      );
      const result = await messageService.failCompression(pending.messageGroupId, {
        agentId: 'agent-failed',
        topicId: 'topic-failed',
      });

      expect(result.messages.map((message) => message.id)).toEqual([
        'failed-source-1',
        'failed-source-2',
      ]);
      expect(result.messages.some((message) => message.role === 'compressedGroup')).toBe(false);

      const [failedGroup] = await serverDB
        .select()
        .from(messageGroups)
        .where(eq(messageGroups.id, pending.messageGroupId));
      expect(JSON.parse(failedGroup.description!)).toMatchObject({
        compressionStatus: 'failed',
        failureCode: 'SUMMARY_FAILED',
        originalMessageCount: 2,
      });
      expect(JSON.parse(failedGroup.description!).failedAt).toEqual(expect.any(String));
    });
  });
});
