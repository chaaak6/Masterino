import { type LobeChatDatabase } from '@lobechat/database';
import type { CommitToolResultInput, EnsureToolMessageInput } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { FileService } from '@/server/services/file';

import { MessageService } from '../index';

vi.mock('@/database/models/message');
vi.mock('@/server/services/file');

describe('MessageService', () => {
  let messageService: MessageService;
  let mockDB: LobeChatDatabase;
  let mockMessageModel: MessageModel;
  let mockFileService: FileService;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockDB = {} as LobeChatDatabase;
    mockMessageModel = {
      commitToolResult: vi.fn(),
      create: vi.fn(),
      deleteMessage: vi.fn(),
      deleteMessages: vi.fn(),
      ensureToolMessage: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
      updateMessagePlugin: vi.fn(),
      updateMessageRAG: vi.fn(),
      updateMetadata: vi.fn(),
      updatePluginState: vi.fn(),
    } as any;

    mockFileService = {
      getFullFileUrl: vi.fn().mockImplementation((path) => Promise.resolve(`/files${path}`)),
    } as any;

    // Mock constructors
    vi.mocked(MessageModel).mockImplementation(() => mockMessageModel);
    vi.mocked(FileService).mockImplementation(() => mockFileService);

    messageService = new MessageService(mockDB, userId);
  });

  describe('ensureToolMessage', () => {
    it('returns the create-or-confirm acknowledgement without querying the topic', async () => {
      const input: EnsureToolMessageInput = {
        agentId: 'agent-1',
        id: 'tool-message-1',
        parentMessageId: 'assistant-message-1',
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          identifier: 'lobe-local-system',
          toolCallId: 'call-1',
          type: 'builtin',
        },
      };
      vi.mocked(mockMessageModel.ensureToolMessage).mockResolvedValue({
        disposition: 'existing',
        id: input.id,
      });

      const result = await messageService.ensureToolMessage(input);

      expect(mockMessageModel.ensureToolMessage).toHaveBeenCalledWith(input);
      expect(mockMessageModel.query).not.toHaveBeenCalled();
      expect(result).toEqual({ disposition: 'existing', id: input.id });
    });
  });

  describe('commitToolResult', () => {
    const input: CommitToolResultInput = {
      executionAttemptId: 'attempt-1',
      id: 'tool-message-1',
      result: { content: 'done', state: { output: 'done' }, success: true },
    };

    it('returns a minimal acknowledgement without querying the topic', async () => {
      vi.mocked(mockMessageModel.commitToolResult).mockResolvedValue({
        disposition: 'committed',
        id: input.id,
      });

      const result = await messageService.commitToolResult(input);

      expect(mockMessageModel.commitToolResult).toHaveBeenCalledWith(input);
      expect(mockMessageModel.query).not.toHaveBeenCalled();
      expect(result).toEqual({ disposition: 'committed', id: input.id });
    });

    it('propagates storage errors so the client lifecycle can retry', async () => {
      const storageError = Object.assign(new Error('database unavailable'), { code: '57P01' });
      vi.mocked(mockMessageModel.commitToolResult).mockRejectedValue(storageError);

      await expect(messageService.commitToolResult(input)).rejects.toBe(storageError);
    });
  });

  describe('removeMessage', () => {
    it('should delete message and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';

      const result = await messageService.removeMessage(messageId);

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should delete message and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const mockMessages = [{ id: 'msg-2', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessage(messageId, { sessionId: 'session-1' });

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId: undefined, sessionId: 'session-1', topicId: undefined },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('should delete message and return message list when topicId provided', async () => {
      const messageId = 'msg-1';
      const mockMessages = [{ id: 'msg-2', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessage(messageId, { topicId: 'topic-1' });

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId: undefined, sessionId: undefined, topicId: 'topic-1' },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('removeMessages', () => {
    it('should delete messages and return { success: true } when no sessionId/topicId provided', async () => {
      const messageIds = ['msg-1', 'msg-2'];

      const result = await messageService.removeMessages(messageIds);

      expect(mockMessageModel.deleteMessages).toHaveBeenCalledWith(messageIds);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should delete messages and return message list when sessionId provided', async () => {
      const messageIds = ['msg-1', 'msg-2'];
      const mockMessages = [{ id: 'msg-3', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessages(messageIds, { sessionId: 'session-1' });

      expect(mockMessageModel.deleteMessages).toHaveBeenCalledWith(messageIds);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updateMessageRAG', () => {
    it('should update RAG and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const ragValue = { fileChunks: [{ id: 'chunk-1', similarity: 0.95 }] };

      const result = await messageService.updateMessageRAG(messageId, ragValue);

      expect(mockMessageModel.updateMessageRAG).toHaveBeenCalledWith(messageId, ragValue);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update RAG and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const ragValue = { fileChunks: [{ id: 'chunk-1', similarity: 0.95 }] };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessageRAG(messageId, ragValue, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updateMessageRAG).toHaveBeenCalledWith(messageId, ragValue);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updatePluginError', () => {
    it('should update plugin error and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const error = { type: 'TestError', message: 'Test error message' };

      const result = await messageService.updatePluginError(messageId, error);

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith(messageId, { error });
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update plugin error and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const error = { type: 'TestError', message: 'Test error message' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginError(messageId, error, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith(messageId, { error });
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updatePluginState', () => {
    it('should update plugin state and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const state = { key: 'value' };

      const result = await messageService.updatePluginState(messageId, state, {});

      expect(mockMessageModel.updatePluginState).toHaveBeenCalledWith(messageId, state);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update plugin state and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const state = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginState(messageId, state, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updatePluginState).toHaveBeenCalledWith(messageId, state);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updateMessage', () => {
    it('should update message and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const value = { content: 'updated content' };

      const result = await messageService.updateMessage(messageId, value as any, {});

      expect(mockMessageModel.update).toHaveBeenCalledWith(messageId, value);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update message and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const value = { content: 'updated content' };
      const mockMessages = [{ id: 'msg-1', content: 'updated content' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessage(messageId, value as any, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.update).toHaveBeenCalledWith(messageId, value);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const metadata = { someKey: 'someValue', count: 42 };

      const result = await messageService.updateMetadata(messageId, metadata);

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update metadata and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const metadata = { someKey: 'someValue', count: 42 };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMetadata(messageId, metadata, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('should update metadata and return message list when topicId provided', async () => {
      const messageId = 'msg-1';
      const metadata = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMetadata(messageId, metadata, {
        topicId: 'topic-1',
      });

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId: undefined, sessionId: undefined, topicId: 'topic-1' },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('createMessage', () => {
    it('should create message and return message list', async () => {
      const params = {
        agentId: 'agent-1',
        content: 'Hello',
        role: 'user' as const,
      };
      const createdMessage = { id: 'msg-1', ...params };
      const mockMessages = [createdMessage, { id: 'msg-2', content: 'Hi' }];

      vi.mocked(mockMessageModel.create).mockResolvedValue(createdMessage as any);
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.createMessage(params as any);

      expect(mockMessageModel.create).toHaveBeenCalledWith(params, undefined);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-1',
          groupId: undefined,
          pageSize: 9999,
          threadId: undefined,
          topicId: undefined,
        },
        expect.objectContaining({
          complete: false,
          postProcessUrl: expect.any(Function),
        }),
      );
      expect(result).toEqual({
        id: 'msg-1',
        messages: mockMessages,
      });
    });

    it('should create message with topicId and groupId', async () => {
      const params = {
        agentId: 'agent-1',
        content: 'Hello',
        groupId: 'group-1',
        role: 'user' as const,
        topicId: 'topic-1',
      };
      const createdMessage = { id: 'msg-1', ...params };
      const mockMessages = [createdMessage];

      vi.mocked(mockMessageModel.create).mockResolvedValue(createdMessage as any);
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.createMessage(params as any);

      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-1',
          groupId: 'group-1',
          threadId: undefined,
          topicId: 'topic-1',
        },
        expect.objectContaining({
          complete: true,
          postProcessUrl: expect.any(Function),
        }),
      );
      expect(result.id).toBe('msg-1');
      expect(result.messages).toEqual(mockMessages);
    });

    it('should create message with threadId and query thread messages', async () => {
      const params = {
        agentId: 'agent-1',
        content: 'Hello in thread',
        groupId: 'group-1',
        role: 'user' as const,
        threadId: 'thread-1',
        topicId: 'topic-1',
      };
      const createdMessage = { id: 'msg-1', ...params };
      const mockMessages = [createdMessage];

      vi.mocked(mockMessageModel.create).mockResolvedValue(createdMessage as any);
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.createMessage(params as any);

      expect(mockMessageModel.create).toHaveBeenCalledWith(params, undefined);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-1',
          groupId: 'group-1',
          threadId: 'thread-1',
          topicId: 'topic-1',
        },
        expect.objectContaining({
          complete: true,
          postProcessUrl: expect.any(Function),
        }),
      );
      expect(result.id).toBe('msg-1');
      expect(result.messages).toEqual(mockMessages);
    });
  });

  describe('groupId context support', () => {
    const groupId = 'group-123';
    const topicId = 'topic-456';

    it('removeMessage should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const mockMessages = [{ id: 'msg-2', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessage(messageId, { groupId, topicId });

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('removeMessages should query with groupId when provided', async () => {
      const messageIds = ['msg-1', 'msg-2'];
      const mockMessages = [{ id: 'msg-3', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessages(messageIds, { groupId, topicId });

      expect(mockMessageModel.deleteMessages).toHaveBeenCalledWith(messageIds);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updateMessage should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const value = { content: 'updated content' };
      const mockMessages = [{ id: 'msg-1', content: 'updated content' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessage(messageId, value as any, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.update).toHaveBeenCalledWith(messageId, value);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updateMetadata should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const metadata = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMetadata(messageId, metadata, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updatePluginState should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const state = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginState(messageId, state, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updatePluginState).toHaveBeenCalledWith(messageId, state);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updatePluginError should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const error = { type: 'TestError', message: 'Test error message' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginError(messageId, error, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith(messageId, { error });
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updateMessageRAG should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const ragValue = { fileChunks: [{ id: 'chunk-1', similarity: 0.95 }] };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessageRAG(messageId, ragValue, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updateMessageRAG).toHaveBeenCalledWith(messageId, ragValue);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });
});
