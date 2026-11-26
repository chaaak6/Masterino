import type { MessageHistoryCursor, MessageHistoryPage, UIChatMessage } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { messageKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { getChatStoreState, useChatStore } from '@/store/chat';
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

export const sharesOlderHistory = (
  previous: MessageHistoryPage['branchSelections'],
  page: MessageHistoryPage,
) => {
  const next = page.branchSelections;
  if (!previous || !next || !page.nextCursor) return false;

  const pageIds = new Set(page.messages.map(({ id }) => id));
  const forks = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...forks].every((parent) => previous[parent] === next[parent] || pageIds.has(parent));
};

export const useMessageHistory = (context: ConversationContext, enabled: boolean) => {
  const store = useConversationStoreApi();
  const previousHead = useRef(new Set<string>());
  const branchKey = useRef<string>(undefined);
  const branchSelections = useRef<MessageHistoryPage['branchSelections']>(undefined);
  const cursor = useRef<MessageHistoryCursor | undefined>(undefined);
  const hasOlderPages = useRef(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const running = useChatStore(operationSelectors.isAgentRuntimeRunningByContext(context));
  const wasRunning = useRef(running);
  const isRunning = useCallback(
    () => operationSelectors.isAgentRuntimeRunningByContext(context)(getChatStoreState()),
    [context],
  );

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [store]);

  const newest = useClientDataSWRWithSync<MessageHistoryPage>(
    enabled ? messageKeys.historyPage(context) : null,
    async () => {
      try {
        return await messageService.getHistoryPage({
          groupId: context.groupId,
          topicId: context.topicId!,
        });
      } catch (error) {
        if (!(error instanceof TRPCClientError) || error.data?.code !== 'NOT_FOUND') throw error;
        // During a rolling deployment, older servers still use the list RPC.
        return { messages: await messageService.getMessages(context) };
      }
    },
    {
      onData: (page) => {
        if (!page || !active.current || isRunning()) return;
        const state = store.getState();
        const pathChanged =
          !!page.branchKey &&
          page.branchKey !== branchKey.current &&
          (branchKey.current !== undefined || page.branchKey !== 'linear');
        const previousSelections = branchSelections.current;
        const keepOlderHistory = pathChanged && sharesOlderHistory(previousSelections, page);
        branchKey.current = page.branchKey;
        branchSelections.current = page.branchSelections;
        if (pathChanged && !keepOlderHistory) {
          cursor.current = page.nextCursor;
          hasOlderPages.current = false;
          setHasOlder(!!page.nextCursor);
          previousHead.current = new Set(page.messages.map(({ id }) => id));
          state.replaceMessages(page.messages);
          store.setState({ messagesInit: true });
          return;
        }
        const oldHead = previousHead.current;
        if (
          !hasOlderPages.current ||
          (page.messages.length && !page.messages.some(({ id }) => oldHead.has(id)))
        ) {
          cursor.current = page.nextCursor;
          setHasOlder(!!page.nextCursor);
        } else if (keepOlderHistory && cursor.current) {
          cursor.current = { ...cursor.current, branchKey: page.branchKey };
        }
        // At a new fork, the refreshed window is authoritative even for
        // recent Gateway rows that were never part of the previous head page.
        const refreshedIds = keepOlderHistory
          ? new Set(
              state.dbMessages
                .filter((message) => compareMessages(message, page.messages.at(-1)!) <= 0)
                .map(({ id }) => id),
            )
          : oldHead;
        const stale = new Set<string>();
        if (keepOlderHistory && previousSelections && page.branchSelections) {
          const children = new Map<string, string[]>();
          for (const message of state.dbMessages) {
            if (!message.parentId) continue;
            const siblings = children.get(message.parentId) ?? [];
            siblings.push(message.id);
            children.set(message.parentId, siblings);
          }
          const queue = Object.entries(previousSelections)
            .filter(([parent, selected]) => selected !== page.branchSelections![parent])
            .map(([, selected]) => selected);
          while (queue.length) {
            const id = queue.pop()!;
            if (stale.has(id)) continue;
            stale.add(id);
            for (const child of children.get(id) ?? []) queue.push(child);
          }
        }
        const retained = stale.size
          ? state.dbMessages.filter(({ id }) => !stale.has(id))
          : state.dbMessages;
        state.replaceMessages(mergeHistoryPage(retained, page, refreshedIds, true));
        store.setState({ messagesInit: true });
        previousHead.current = new Set(page.messages.map(({ id }) => id));
      },
    },
  );

  useEffect(() => {
    const settled = wasRunning.current && !running;
    wasRunning.current = running;
    if (settled && enabled) void newest.mutate();
  }, [enabled, newest.mutate, running]);

  const loadOlder = useCallback(async () => {
    const before = cursor.current;
    const topicId = context.topicId;
    if (!enabled || !topicId || !before || inFlight.current || isRunning()) return;
    inFlight.current = true;
    setLoadError(false);
    try {
      const page = await messageService.getHistoryPage({
        cursor: before,
        groupId: context.groupId,
        topicId,
      });
      if (!active.current || cursor.current !== before || isRunning()) return;
      const state = store.getState();
      if (page.branchKey && before.branchKey && page.branchKey !== before.branchKey) {
        await newest.mutate();
        return;
      }
      state.replaceMessages(mergeHistoryPage(state.dbMessages, page, previousHead.current, false));
      cursor.current = page.nextCursor;
      setHasOlder(!!page.nextCursor);
      hasOlderPages.current = true;
    } catch {
      if (active.current) setLoadError(true);
    } finally {
      inFlight.current = false;
    }
  }, [enabled, context.groupId, context.topicId, isRunning, newest.mutate, store]);

  return {
    hasOlder,
    isValidating: newest.isValidating,
    loadError: loadError || !!newest.error,
    loadOlder,
    reload: newest.mutate,
    retry: newest.error ? newest.mutate : loadOlder,
  };
};
