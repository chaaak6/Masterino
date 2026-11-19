import type { MessageHistoryCursor, MessageHistoryPage, UIChatMessage } from '@lobechat/types';
import { useCallback, useRef, useState } from 'react';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { messageKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { getChatStoreState } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { useConversationStoreApi } from '../../store';
import type { ConversationContext } from '../../types';

const timestamp = (value: UIChatMessage['createdAt']) => new Date(value).getTime();

const compareMessages = (first: UIChatMessage, second: UIChatMessage) =>
  timestamp(first.createdAt) - timestamp(second.createdAt) ||
  (first.id < second.id ? -1 : Number(first.id > second.id));

export const mergeHistoryPage = (
  local: UIChatMessage[],
  page: MessageHistoryPage,
  previousHead: Set<string>,
  newest: boolean,
) => {
  const byId = new Map(local.map((message) => [message.id, message]));
  const incoming = new Set(page.messages.map(({ id }) => id));
  const start = page.messages[0];
  if (newest) {
    // A missing row inside the refreshed window was deleted. Rows pushed
    // beyond the end of this window by newer inserts still belong to history.
    for (const id of previousHead) {
      const message = byId.get(id);
      if (
        message &&
        !incoming.has(id) &&
        (!page.nextCursor || compareMessages(message, start) >= 0)
      )
        byId.delete(id);
    }
  }
  for (const message of page.messages) {
    const current = byId.get(message.id);
    if (!current || timestamp(current.updatedAt) <= timestamp(message.updatedAt)) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort(compareMessages);
};

export const useMessageHistory = (context: ConversationContext, enabled: boolean) => {
  const store = useConversationStoreApi();
  const previousHead = useRef(new Set<string>());
  const cursor = useRef<MessageHistoryCursor | undefined>(undefined);
  const hasOlderPages = useRef(false);
  const inFlight = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const isRunning = () =>
    operationSelectors.isAgentRuntimeRunningByContext(context)(getChatStoreState());

  const newest = useClientDataSWRWithSync<MessageHistoryPage>(
    enabled ? messageKeys.historyPage(context) : null,
    () => messageService.getHistoryPage({ groupId: context.groupId, topicId: context.topicId! }),
    {
      onData: (page) => {
        if (!page || isRunning()) return;
        const state = store.getState();
        const oldHead = previousHead.current;
        if (
          !hasOlderPages.current ||
          (page.messages.length && !page.messages.some(({ id }) => oldHead.has(id)))
        ) {
          cursor.current = page.nextCursor;
        }
        state.replaceMessages(mergeHistoryPage(state.dbMessages, page, oldHead, true));
        store.setState({ messagesInit: true });
        previousHead.current = new Set(page.messages.map(({ id }) => id));
      },
    },
  );

  const loadOlder = useCallback(async () => {
    const before = cursor.current;
    const topicId = context.topicId;
    if (!enabled || !topicId || !before || inFlight.current) return;
    inFlight.current = true;
    setLoadError(false);
    try {
      const page = await messageService.getHistoryPage({
        cursor: before,
        groupId: context.groupId,
        topicId,
      });
      if (cursor.current !== before) return;
      const state = store.getState();
      state.replaceMessages(mergeHistoryPage(state.dbMessages, page, previousHead.current, false));
      cursor.current = page.nextCursor;
      hasOlderPages.current = true;
    } catch {
      setLoadError(true);
    } finally {
      inFlight.current = false;
    }
  }, [enabled, context.groupId, context.topicId, store]);

  return {
    isValidating: newest.isValidating,
    loadError: loadError || !!newest.error,
    loadOlder,
    reload: newest.mutate,
  };
};
