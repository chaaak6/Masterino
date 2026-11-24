import {
  type ChatImageItem,
  type ChatMessageError,
  type ChatMessagePluginError,
  type ChatToolPayload,
  type CreateMessageParams,
  type GroundingSearch,
  type MessageMetadata,
  type MessagePluginItem,
  type ModelReasoning,
  type UIChatMessage,
  type UpdateMessageRAGParams,
} from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import {
  bindLocalAttachmentMessage,
  releaseLocalMessageAttachments,
} from '@/services/electron/localAttachmentService';
import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { messageMapKey } from '../../../utils/messageMapKey';
import { dbMessageSelectors } from '../selectors';

/**
 * Context for optimistic updates to specify session/topic isolation
 */
export interface OptimisticUpdateContext {
  operationId?: string;
  /** Pre-generated temp message ID (used when ID needs to be known before creation) */
  tempMessageId?: string;
}

/**
 * Optimistic update operations
 * All methods follow the pattern: update frontend first, then persist to database
 */

type Setter = StoreSetter<ChatStore>;
export const messageOptimisticUpdate = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new MessageOptimisticUpdateActionImpl(set, get, _api);

export class MessageOptimisticUpdateActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  optimisticCreateMessage = async (
    message: CreateMessageParams,
    context?: {
      groupMessageId?: string;
      operationId?: string;
      tempMessageId?: string;
    },
  ): Promise<{ id: string; messages: UIChatMessage[] } | undefined> => {
    const { optimisticCreateTmpMessage, internal_dispatchMessage, replaceMessages } = this.#get();

    let tempId = context?.tempMessageId;
    if (!tempId) {
      tempId = optimisticCreateTmpMessage(message as any, context);
    }

    try {
      const result = await messageService.createMessage(message);
      if (message.attachments?.items.length)
        await bindLocalAttachmentMessage(
          message.attachments.items.map((attachment) => ({ attachment })),
          result.id,
          message.topicId ?? 'active',
        );

      // Use the messages returned from createMessage (already grouped)
      const ctx = this.#get().internal_getConversationContext(context);
      replaceMessages(result.messages, { context: ctx });

      return result;
    } catch (e) {
      internal_dispatchMessage(
        {
          id: tempId,
          type: 'updateMessage',
          value: {
            error: {
              body: e,
              message: (e as Error).message,
              type: ChatErrorType.CreateMessageError,
            },
          },
        },
        context,
      );
    }
  };

  optimisticCreateTmpMessage = (
    message: CreateMessageParams,
    context?: OptimisticUpdateContext,
  ): string => {
    const { internal_dispatchMessage } = this.#get();

    // use optimistic update to avoid the slow waiting
    // use pre-generated tempMessageId if provided, otherwise generate a new one
    const tempId = context?.tempMessageId || 'tmp_' + nanoid();
    internal_dispatchMessage({ id: tempId, type: 'createMessage', value: message }, context);

    return tempId;
  };

  optimisticDeleteMessage = async (
    id: string,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const localMessage = dbMessageSelectors.getDbMessageById(id)(this.#get());
    this.#get().internal_dispatchMessage({ id, type: 'deleteMessage' }, context);
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.removeMessage(id, ctx);
    if (result?.success && localMessage) await releaseLocalMessageAttachments([localMessage]);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticDeleteMessages = async (
    ids: string[],
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const localMessages = ids.flatMap((id) => {
      const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
      return message ? [message] : [];
    });
    this.#get().internal_dispatchMessage({ ids, type: 'deleteMessages' }, context);
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.removeMessages(ids, ctx);
    if (result?.success) await releaseLocalMessageAttachments(localMessages);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdateMessageContent = async (
    id: string,
    content: string,
    extra?: {
      imageList?: ChatImageItem[];
      metadata?: MessageMetadata;
      model?: string;
      provider?: string;
      reasoning?: ModelReasoning;
      search?: GroundingSearch;
      tools?: ChatToolPayload[];
    },
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    await this.#updateMessageById(
      id,
      {
        content,
        imageList: extra?.imageList,
        metadata: extra?.metadata,
        model: extra?.model,
        provider: extra?.provider,
        reasoning: extra?.reasoning,
        search: extra?.search,
        tools: extra?.tools,
      },
      context,
    );
  };

  optimisticUpdateMessageError = async (
    id: string,
    error: ChatMessageError | null,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    await this.#updateMessageById(id, { error }, context);
  };

  async #updateMessageById(
    id: string,
    value: Partial<UIChatMessage> & Parameters<typeof messageService.updateMessage>[1],
    context?: OptimisticUpdateContext,
  ) {
    const { internal_dispatchMessage, internal_getConversationContext } = this.#get();
    const ctx = internal_getConversationContext(context);
    const key = messageMapKey(ctx);
    internal_dispatchMessage({ id, type: 'updateMessage', value }, context);
    const expected = this.#get().dbMessagesMap[key]?.find((message) => message.id === id);
    const result = await messageService.updateMessage(id, value, ctx, {
      returnUpdatedMessage: true,
    });
    if (!result?.success) throw new Error('Message update was not committed');

    if (result.message && messageMapKey(internal_getConversationContext(context)) === key) {
      internal_dispatchMessage(
        { expected, type: 'acknowledgeMessage', value: result.message },
        context,
      );
    }
  }

  optimisticUpdateMessageMetadata = async (
    id: string,
    metadata: Partial<MessageMetadata>,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const { internal_dispatchMessage, refreshMessages, replaceMessages } = this.#get();

    internal_dispatchMessage({ id, type: 'updateMessageMetadata', value: metadata }, context);

    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessageMetadata(id, metadata, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    } else {
      await refreshMessages();
    }
  };

  optimisticUpdateMessagePlugin = async (
    id: string,
    value: Partial<MessagePluginItem>,
    context?: OptimisticUpdateContext,
    options?: { returnUpdatedMessage?: boolean },
  ): Promise<void> => {
    const { internal_dispatchMessage, internal_getConversationContext, replaceMessages } =
      this.#get();
    const ctx = internal_getConversationContext(context);
    const key = messageMapKey(ctx);
    const toolMessage = dbMessageSelectors.getDbMessageById(id)(this.#get());

    internal_dispatchMessage({ id, type: 'updateMessagePlugin', value }, context);

    if (toolMessage?.parentId && toolMessage.tool_call_id) {
      internal_dispatchMessage(
        {
          id: toolMessage.parentId,
          type: 'updateMessageTools',
          tool_call_id: toolMessage.tool_call_id,
          value: value as Partial<ChatToolPayload>,
        },
        context,
      );
    }

    if (options?.returnUpdatedMessage) {
      const expected = this.#get().dbMessagesMap[key]?.find((message) => message.id === id);
      const result = await messageService.updateMessagePlugin(id, value, ctx, options);
      if (!result?.success) throw new Error('Tool approval was not committed');
      const confirmed = result.message ?? result.messages?.find((message) => message.id === id);
      if (confirmed && messageMapKey(internal_getConversationContext(context)) === key) {
        internal_dispatchMessage(
          { expected, type: 'acknowledgeMessage', value: confirmed },
          context,
        );
      }
      return;
    }

    const result = await messageService.updateMessagePlugin(id, value, ctx);

    if (result?.success && result.messages) {
      replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdateMessagePluginError = async (
    id: string,
    error: ChatMessagePluginError | null,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessagePluginError(id, error, ctx);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };

  optimisticUpdateMessageRAG = async (
    id: string,
    data: UpdateMessageRAGParams,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    const ctx = this.#get().internal_getConversationContext(context);
    const result = await messageService.updateMessageRAG(id, data, ctx);
    if (result?.success && result.messages) {
      this.#get().replaceMessages(result.messages, { context: ctx });
    }
  };
}

export type MessageOptimisticUpdateAction = Pick<
  MessageOptimisticUpdateActionImpl,
  keyof MessageOptimisticUpdateActionImpl
>;
