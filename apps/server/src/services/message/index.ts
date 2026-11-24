import {
  type CommitToolResultInput,
  type CommitToolResultResult,
  type CompressionGroupMetadata,
  type CreateMessageParams,
  type EnsureToolMessageInput,
  type EnsureToolMessageResult,
  type MessageHistoryCursor,
  type QueryMessageParams,
  type UIChatMessage,
  type UpdateMessageParams,
  type UpdateMessageResult,
} from '@lobechat/types';
import { createTimingHelpers, getDurationMs } from '@lobechat/utils';

import { MessageModel } from '@/database/models/message';
import { CompressionRepository } from '@/database/repositories/compression';
import type { LobeChatDatabase } from '@/database/type';

import { FileService } from '../file';

interface QueryOptions {
  agentId?: string | null;
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  timingRequestId?: string;
  timingStartedAt?: number;
  topicId?: string | null;
}

const { createPrefixedTimingContext, logTiming, toTimingContext } = createTimingHelpers(
  'lobe-server:chat:lobehub:timing',
);

const logMessageTiming = (
  options: QueryOptions | undefined,
  event: string,
  metadata?: Record<string, unknown>,
) => {
  logTiming(toTimingContext(options), event, metadata);
};

const createModelTiming = (options: QueryOptions | undefined, prefix: string) =>
  createPrefixedTimingContext(toTimingContext(options), prefix);

interface CreateMessageResult {
  id: string;
  messages: any[];
}

/**
 * Message Service
 *
 * Encapsulates repeated "mutation + conditional query" logic.
 * After performing update/delete operations, conditionally returns message list based on sessionId/topicId.
 */
export class MessageService {
  private messageModel: MessageModel;
  private fileService: FileService;
  private compressionRepository: CompressionRepository;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.messageModel = new MessageModel(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
    this.compressionRepository = new CompressionRepository(db, userId, workspaceId);
  }

  /**
   * Unified URL processing function
   */
  private get postProcessUrl() {
    return (path: string | null, file: { fileType: string; id?: string | null }) =>
      this.fileService.getFileAccessUrl({ id: file.id, url: path });
  }

  /**
   * Unified query options
   */
  private getQueryOptions() {
    return {
      groupAssistantMessages: false,
      postProcessUrl: this.postProcessUrl,
    };
  }

  /**
   * Query messages and return response with success status (used after mutations)
   * Prioritize agentId, fallback to sessionId if not provided (for backwards compatibility)
   */
  private async queryWithSuccess(
    options?: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    if (
      !options ||
      (options.agentId === undefined &&
        options.sessionId === undefined &&
        options.topicId === undefined)
    ) {
      logMessageTiming(options, 'lambda.message.update.queryMessages:skipped');
      return { success: true };
    }

    const { agentId, sessionId, topicId, groupId, threadId } = options;

    const queryStartedAt = Date.now();
    const modelTiming = createModelTiming(options, 'lambda.message.update.queryMessages');
    const messages = await this.messageModel.query(
      { agentId, groupId, sessionId, threadId, topicId },
      {
        ...this.getQueryOptions(),
        ...(topicId ? { complete: true } : {}),
        ...(modelTiming ? { timing: modelTiming } : {}),
      },
    );
    logMessageTiming(options, 'lambda.message.update.queryMessages:done', {
      messageCount: messages.length,
      stageMs: getDurationMs(queryStartedAt),
    });

    return { messages, success: true };
  }

  /**
   * Fetch the canonical message list for an agent / topic scope, using the
   * standard UIChatMessage shape (file URLs resolved through FileService).
   *
   * Mirrors the read path exposed by the `message.getMessages` trpc lambda
   * so server-internal callers (e.g. agent runtime stream events) can push
   * the same payload the client would otherwise fetch.
   */
  async queryMessages(params: QueryMessageParams): Promise<UIChatMessage[]> {
    return this.messageModel.query(params, { ...this.getQueryOptions(), complete: true });
  }

  async queryHistoryPage(params: {
    cursor?: MessageHistoryCursor;
    groupId?: string | null;
    topicId: string;
  }) {
    return this.messageModel.queryHistoryPage(params, this.postProcessUrl);
  }

  async queryGatewayHistory(params: Parameters<MessageModel['queryGatewayHistory']>[0]) {
    return this.messageModel.queryGatewayHistory(params, this.postProcessUrl);
  }

  async queryAgentMessages(
    params: QueryMessageParams,
    postProcessUrl = this.postProcessUrl,
  ): Promise<UIChatMessage[]> {
    return this.messageModel.query(params, {
      postProcessUrl,
      compactSummaries: true,
      complete: true,
    });
  }

  /**
   * Create a new message and return the complete message list
   * Pattern: create + query
   *
   * This method combines message creation and querying into a single operation,
   * reducing the need for separate refresh calls and improving performance.
   */
  async createMessage(params: CreateMessageParams): Promise<CreateMessageResult> {
    // 1. Create the message (using agentId). Honor a caller-pre-allocated id
    //    when present (passing `undefined` falls back to the model's genId
    //    default), so flows that chain parentId across not-yet-created messages
    //    (e.g. the subagent run coordinator) can assign ids up front.
    const item = await this.messageModel.create(params, params.id);

    // 2. Query all messages for this agent/topic
    // Use agentId field for query
    const messages = await this.messageModel.query(
      {
        agentId: params.agentId,
        groupId: params.groupId,
        ...(!params.topicId && { pageSize: 9999 }),
        threadId: params.threadId,
        topicId: params.topicId,
      },
      {
        complete: Boolean(params.topicId),
        postProcessUrl: this.postProcessUrl,
      },
    );

    // 3. Return the result
    return {
      id: item.id,
      messages,
    };
  }

  /**
   * Create the canonical tool message or confirm that an identical intent already exists.
   * This deliberately returns a minimal acknowledgement instead of re-querying the topic.
   */
  async ensureToolMessage(input: EnsureToolMessageInput): Promise<EnsureToolMessageResult> {
    return this.messageModel.ensureToolMessage(input);
  }

  /** Persist a local tool result without the legacy topic re-query or error swallowing. */
  async commitToolResult(input: CommitToolResultInput): Promise<CommitToolResultResult> {
    return this.messageModel.commitToolResult(input);
  }

  /**
   * Remove messages with optional message list return
   * Pattern: delete + conditional query
   */
  async removeMessages(ids: string[], options?: QueryOptions) {
    await this.messageModel.deleteMessages(ids);
    return this.queryWithSuccess(options);
  }

  /**
   * Remove single message with optional message list return
   * Pattern: delete + conditional query
   */
  async removeMessage(id: string, options?: QueryOptions) {
    await this.messageModel.deleteMessage(id);
    return this.queryWithSuccess(options);
  }

  /**
   * Update message RAG with optional message list return
   * Pattern: update + conditional query
   */
  async updateMessageRAG(id: string, value: any, options?: QueryOptions) {
    await this.messageModel.updateMessageRAG(id, value);
    return this.queryWithSuccess(options);
  }

  /**
   * Update plugin error with optional message list return
   * Pattern: update + conditional query
   */
  async updatePluginError(id: string, value: any, options?: QueryOptions) {
    await this.messageModel.updateMessagePlugin(id, { error: value });
    return this.queryWithSuccess(options);
  }

  /**
   * Update plugin state and return message list
   * Pattern: update + conditional query
   */
  async updatePluginState(
    id: string,
    value: any,
    options: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    await this.messageModel.updatePluginState(id, value);
    return this.queryWithSuccess(options);
  }

  /**
   * Update message plugin and return message list
   * Pattern: update + conditional query
   */
  async updateMessagePlugin(
    id: string,
    value: any,
    options: QueryOptions,
    response?: { returnUpdatedMessage?: boolean },
  ): Promise<UpdateMessageResult> {
    await this.messageModel.updateMessagePlugin(id, value);
    if (response?.returnUpdatedMessage) return this.queryUpdatedMessage(id);
    return this.queryWithSuccess(options);
  }

  /**
   * Update message and return message list
   * Pattern: update + conditional query
   */
  async updateMessage(
    id: string,
    value: UpdateMessageParams,
    options: QueryOptions,
    response?: { returnUpdatedMessage?: boolean },
  ): Promise<UpdateMessageResult> {
    const updateStartedAt = Date.now();
    const modelTiming = createModelTiming(options, 'lambda.message.update.dbUpdate');
    const updated = modelTiming
      ? await this.messageModel.update(id, value, modelTiming)
      : await this.messageModel.update(id, value);
    logMessageTiming(options, 'lambda.message.update.dbUpdate:done', {
      stageMs: getDurationMs(updateStartedAt),
      valueKeys: Object.keys(value ?? {}),
    });

    if (response?.returnUpdatedMessage) {
      if (!updated.success) return { success: false };
      return this.queryUpdatedMessage(id);
    }

    return this.queryWithSuccess(options);
  }

  private async queryUpdatedMessage(id: string): Promise<UpdateMessageResult> {
    const [message] = await this.messageModel.queryByIds([id], this.getQueryOptions());
    return message ? { message, success: true } : { success: false };
  }

  /**
   * Update message metadata with optional message list return
   * Pattern: update + conditional query
   */
  async updateMetadata(id: string, value: any, options?: QueryOptions) {
    await this.messageModel.updateMetadata(id, value);
    return this.queryWithSuccess(options);
  }

  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single transaction
   * This prevents race conditions when updating multiple fields
   * Pattern: update + conditional query
   */
  async updateToolMessage(
    id: string,
    value: {
      content?: string;
      metadata?: Record<string, any>;
      pluginError?: any;
      pluginState?: Record<string, any>;
    },
    options?: QueryOptions,
    response?: { returnUpdatedMessage?: boolean },
  ): Promise<UpdateMessageResult> {
    const result = await this.messageModel.updateToolMessage(id, value);
    if (!result.success) {
      return { success: false };
    }
    if (response?.returnUpdatedMessage) return this.queryUpdatedMessage(id);
    return this.queryWithSuccess(options);
  }

  /**
   * Add files to a message
   * Pattern: update + conditional query
   */
  async addFilesToMessage(
    messageId: string,
    fileIds: string[],
    options?: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const result = await this.messageModel.addFiles(messageId, fileIds);
    if (!result.success) {
      return { success: false };
    }
    return this.queryWithSuccess(options);
  }

  /**
   * Update tool arguments by toolCallId - updates both tool message plugin.arguments
   * and parent assistant message tools[].arguments atomically
   *
   * This method uses toolCallId (the stable identifier from AI response) instead of
   * tool message ID, which allows updating arguments even when the tool message
   * hasn't been persisted yet (e.g., during intervention pending state).
   *
   * @param toolCallId - The tool call ID (stable identifier from AI response)
   * @param args - The new arguments value (will be stringified if object)
   * @param options - Query options for returning updated messages
   */
  async updateToolArguments(
    toolCallId: string,
    args: string | Record<string, unknown>,
    options?: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const argsString = typeof args === 'string' ? args : JSON.stringify(args);

    const result = await this.messageModel.updateToolArguments(toolCallId, argsString);
    if (!result.success) {
      return { success: false };
    }
    return this.queryWithSuccess(options);
  }

  // =============== Compression Methods ===============

  /**
   * Create a compression group for messages
   * Stages exact source versions while keeping the originals readable.
   *
   * @param topicId - The topic ID
   * @param messageIds - IDs of messages to compress
   * @param options - Query options for returning updated messages
   */
  async createCompressionGroup(
    topicId: string,
    messageIds: string[],
    options?: QueryOptions,
    includeTimelineSnapshot = false,
  ): Promise<{
    messageGroupId: string;
    messages?: UIChatMessage[];
    messagesToSummarize: UIChatMessage[];
    success: boolean;
  }> {
    const candidates = [...new Set(messageIds)];
    if (candidates.length === 0) throw new Error('No messages to compress');
    const sourceMessages: UIChatMessage[] = [];
    for (let offset = 0; offset < candidates.length; offset += 500) {
      sourceMessages.push(
        ...(await this.messageModel.queryByIds(
          candidates.slice(offset, offset + 500),
          this.getQueryOptions(),
        )),
      );
    }
    const byId = new Map(sourceMessages.map((message) => [message.id, message]));
    const earlier = await this.compressionRepository.queryCheckpoints(
      topicId,
      candidates.filter((id) => !byId.has(id)),
    );
    const checkpoints = new Map(earlier.map((group) => [group.id, group]));
    const previousSummaries: NonNullable<CompressionGroupMetadata['previousSummaries']> = [];
    const stagedSources: NonNullable<CompressionGroupMetadata['stagedSources']> = [];
    let previousEnd: string | undefined;
    const messagesToSummarize = candidates.map((id) => {
      const checkpoint = checkpoints.get(id);
      if (checkpoint) {
        const coverage: CompressionGroupMetadata = JSON.parse(checkpoint.description ?? '{}');
        const end = coverage.coverage?.ids.at(-1);
        if (
          !end ||
          coverage.compressionStatus !== 'completed' ||
          !checkpoint.content ||
          options?.threadId ||
          stagedSources.length
        ) {
          throw new Error('Previous summary is not a verified prefix of the compression source');
        }
        previousEnd = end;
        previousSummaries.push({ id, updatedAt: checkpoint.updatedAt.toISOString() });
        return {
          content: checkpoint.content,
          createdAt: checkpoint.createdAt.getTime(),
          id,
          lastMessageId: end,
          role: 'compressedGroup' as const,
          topicId,
          updatedAt: checkpoint.updatedAt.getTime(),
        } satisfies UIChatMessage;
      }
      const source = byId.get(id);
      if (
        !source ||
        source.topicId !== topicId ||
        (source.threadId ?? null) !== (options?.threadId ?? null)
      ) {
        throw new Error('Compression source is missing from the requested conversation');
      }
      if (
        previousEnd &&
        !stagedSources.length &&
        source.parentId &&
        source.parentId !== previousEnd
      )
        throw new Error('Previous summary does not precede the compression source');
      stagedSources.push({ id, updatedAt: new Date(source.updatedAt).toISOString() });
      return source;
    });
    if (!stagedSources.length) throw new Error('Compression requires new source messages');

    // 2. Create compression group with placeholder content
    const messageGroupId = await this.compressionRepository.createCompressionGroup({
      content: '...', // Placeholder content
      messageIds: candidates,
      metadata: {
        compressionStatus: 'pending',
        endMessageId: stagedSources.at(-1)?.id,
        originalMessageCount: stagedSources.length,
        ...(previousSummaries.length ? { previousSummaries } : {}),
        stagedSources,
        startMessageId: stagedSources[0].id,
      },
      topicId,
    });

    const messages = includeTimelineSnapshot
      ? [
          ...(await this.queryMessages({ ...options, topicId })),
          {
            compressedMessages: [],
            content: '...',
            createdAt: Date.now(),
            id: messageGroupId,
            role: 'compressedGroup' as const,
            topicId,
            updatedAt: Date.now(),
          },
        ]
      : undefined;
    return {
      messageGroupId,
      ...(messages && { messages }),
      messagesToSummarize,
      success: true,
    };
  }

  /**
   * Finalize compression by updating the group with actual summary content
   *
   * @param messageGroupId - The compression group ID
   * @param content - The generated summary content
   * @param params - Parameters for querying messages
   */
  async finalizeCompression(
    messageGroupId: string,
    content: string,
    params: {
      agentId: string;
      groupId?: string | null;
      threadId?: string | null;
      topicId: string;
    },
    includeTimelineSnapshot = true,
  ): Promise<{ boundaryMessageId?: string; messages?: UIChatMessage[]; success: boolean }> {
    const { agentId, groupId, threadId, topicId } = params;

    // 1. Update compression group with actual content
    const boundaryMessageId = await this.compressionRepository.completeCompression(
      messageGroupId,
      topicId,
      content,
    );
    if (!includeTimelineSnapshot) return { boundaryMessageId, success: true };

    // 2. Query final messages
    const queryOptions = { agentId, groupId, threadId, topicId };
    const finalMessages = await this.queryMessages(queryOptions);

    return {
      messages: finalMessages,
      success: true,
    };
  }

  /**
   * Update message group metadata (e.g., expanded state)
   */
  async updateMessageGroupMetadata(
    messageGroupId: string,
    metadata: { expanded?: boolean },
    context: QueryOptions,
  ): Promise<{ messages: UIChatMessage[] }> {
    await this.compressionRepository.updateMetadata(messageGroupId, metadata);

    const messages = await this.queryMessages(context);

    return { messages };
  }

  /**
   * Cancel compression by deleting the compression group and restoring original messages
   *
   * @param messageGroupId - The compression group ID to cancel
   * @param context - Query options for returning updated messages
   */
  async cancelCompression(
    messageGroupId: string,
    context: QueryOptions,
  ): Promise<{ messages: UIChatMessage[]; success: boolean }> {
    // Delete compression group (this also unmarks messages)
    await this.compressionRepository.deleteCompressionGroup(messageGroupId);

    // Query updated messages
    const messages = await this.queryMessages(context);

    return { messages, success: true };
  }

  /**
   * Record an unsuccessful summary attempt without leaving the source messages hidden.
   * Unlike cancellation, the group row is retained as sanitized audit evidence.
   */
  async failCompression(
    messageGroupId: string,
    context: QueryOptions,
  ): Promise<{ messages: UIChatMessage[]; success: boolean }> {
    await this.compressionRepository.markCompressionFailed(messageGroupId);

    const messages = await this.queryMessages(context);

    return { messages, success: true };
  }
}
