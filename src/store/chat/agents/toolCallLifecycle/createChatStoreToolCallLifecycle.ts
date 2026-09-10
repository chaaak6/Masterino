import { type ConversationContext, type ExecutionApprovalMode } from '@lobechat/types';

import { type ChatStore } from '@/store/chat/store';

import { createChatStoreToolCallMessageAdapter } from './adapters/chatStoreMessageAdapter';
import { createChatStoreToolCallOperationAdapter } from './adapters/chatStoreOperationAdapter';
import { createChatStoreToolExecutorAdapter } from './adapters/chatStoreToolExecutorAdapter';
import { createDefaultToolCallRetryPolicy } from './retryPolicy';
import { ToolCallLifecycle, type ToolCallOperationRecord } from './ToolCallLifecycle';

export const createChatStoreToolCallLifecycle = (input: {
  approvalMode?: ExecutionApprovalMode;
  context: ConversationContext;
  get: () => ChatStore;
  messageAgentId?: string;
  messageGroupId?: string;
  onOperationStart?: (operation: ToolCallOperationRecord) => void;
}) =>
  new ToolCallLifecycle({
    executor: createChatStoreToolExecutorAdapter(input.get),
    messages: createChatStoreToolCallMessageAdapter(input),
    operations: createChatStoreToolCallOperationAdapter(input.get, {
      onStart: input.onOperationStart,
    }),
    retry: createDefaultToolCallRetryPolicy(),
  });
