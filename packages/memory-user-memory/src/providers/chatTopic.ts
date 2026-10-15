import type { LobeChatDatabase } from '@lobechat/database';
import { updateTopicMemoryExtractMetadata } from '@lobechat/database/topic-memory';
import type { OpenAIChatMessage } from '@lobechat/model-runtime';
import type { ChatTopicMetadata } from '@lobechat/types';
import { u } from 'unist-builder';
import { toXml } from 'xast-util-to-xml';
import type { Child } from 'xastscript';
import { x } from 'xastscript';

import type {
  BuiltContext,
  MemoryContextProvider,
  MemoryExtractionJob,
  MemoryResultRecorder,
  PersistedMemoryResult,
} from '../types';

export interface ChatTopicProviderOptions {
  conversations: (OpenAIChatMessage & { createdAt: Date })[];
  topic: {
    createdAt: Date;
    id: string;
    metadata?: ChatTopicMetadata | null;
    title?: string | null;
    updatedAt?: Date | null;
  };
  topicId: string;
}

export interface ChatTopicResultRecorderOptions {
  currentMetadata?: ChatTopicMetadata;
  database: LobeChatDatabase;
  lastMessageAt?: string;
  messageCount?: number;
  topicId: string;
  traceId?: string;
}

export class LobeChatTopicContextProvider implements MemoryContextProvider<
  Record<string, unknown>,
  Record<string, unknown>
> {
  private readonly options: ChatTopicProviderOptions;

  constructor(options: ChatTopicProviderOptions) {
    this.options = options;
  }

  async buildContext(userId: string): Promise<BuiltContext> {
    const messageChildren: Child[] = [];

    this.options.conversations.forEach((message, index) => {
      const attributes: Record<string, string> = {
        index: index.toString(),
        role: message.role ?? 'assistant',
      };

      if (message.createdAt) {
        attributes.created_at = new Date(message.createdAt).toISOString();
      }

      const content = Array.isArray(message.content)
        ? message.content
            .map((part) => {
              if (part.type === 'text') {
                return part.text;
              }
              if (part.type === 'thinking') {
                return `[Thinking: ${part.thinking}]`;
              }
              if (part.type === 'image_url') {
                return `[Image: ${part.image_url.url}]`;
              }
              if (part.type === 'video_url') {
                return `[Video: ${part.video_url.url}]`;
              }
              return '';
            })
            .join('\n')
        : message.content;

      messageChildren.push(x('message', attributes, content));
    });

    const lastMessageAt =
      this.options.conversations.at(-1)?.createdAt ?? this.options.topic.updatedAt;

    const metadataContent = this.options.topic.metadata
      ? JSON.stringify(this.options.topic.metadata)
      : '';

    const topicChildren: Child[] = [
      x('topic_metadata', metadataContent),
      x('messages', { count: messageChildren.length.toString() }, ...messageChildren),
    ];

    if (this.options.topic.title) {
      topicChildren.unshift(x('topic_title', this.options.topic.title));
    }

    const topicAttributes: Record<string, string> = {
      created_at: new Date(this.options.topic.createdAt).toISOString(),
      id: this.options.topicId,
      message_count: messageChildren.length.toString(),
    };

    if (lastMessageAt) {
      topicAttributes.last_message_at = new Date(lastMessageAt).toISOString();
    }
    if (this.options.topic.updatedAt) {
      topicAttributes.updated_at = new Date(this.options.topic.updatedAt).toISOString();
    }

    const topicContext = toXml(u('root', [x('chat_topic', topicAttributes, ...topicChildren)]));

    return {
      context: topicContext,
      metadata: {},
      sourceId: this.options.topicId,
      userId,
    } satisfies BuiltContext;
  }
}

export class LobeChatTopicResultRecorder implements MemoryResultRecorder<{
  processedMemoryCount: number;
}> {
  private readonly options: ChatTopicResultRecorderOptions;

  constructor(options: ChatTopicResultRecorderOptions) {
    this.options = options;
  }

  async recordComplete(
    job: MemoryExtractionJob,
    result: PersistedMemoryResult & { processedMemoryCount: number },
  ): Promise<void> {
    const now = new Date().toISOString();
    await updateTopicMemoryExtractMetadata(
      this.options.database,
      job.userId,
      this.options.topicId,
      'completed',
      {
        lastMessageAt: this.options.lastMessageAt,
        lastRunAt: now,
        messageCount: this.options.messageCount,
        processedMemoryCount: result.processedMemoryCount,
        traceId: this.options.traceId,
      },
    );
  }

  async recordFail(job: MemoryExtractionJob, error: Error): Promise<void> {
    const now = new Date().toISOString();
    await updateTopicMemoryExtractMetadata(
      this.options.database,
      job.userId,
      this.options.topicId,
      'failed',
      {
        error: error.message.slice(0, 500),
        lastMessageAt: this.options.lastMessageAt,
        lastRunAt: now,
        messageCount: this.options.messageCount,
        processedMemoryCount: 0,
        traceId: this.options.traceId,
      },
    );
  }
}
