import type { AgentState, Cost, Usage } from '@lobechat/agent-runtime';
import type { ConversationContext } from '@lobechat/types';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface LocalTaskResult {
  cost?: Cost;
  status?: AgentState['status'];
  usage?: Usage;
}

const approvals = new Map<
  string,
  { operationId: string; report: (result: LocalTaskResult) => void }
>();

export const getLocalTaskApproval = (context: ConversationContext) =>
  context.groupId && context.threadId ? approvals.get(messageMapKey(context)) : undefined;

/** A group task stays owned by the spawning renderer while its member awaits a tool decision. */
export const trackLocalTaskApproval = (
  context: ConversationContext,
  operationId: string,
  signal: AbortSignal,
) => {
  const key = messageMapKey(context);
  let finish!: (result: LocalTaskResult) => void;
  const result = new Promise<LocalTaskResult>((resolve) => {
    finish = resolve;
  });
  const abort = () => finish({ status: 'interrupted' });

  const entry = {
    operationId,
    report: (result: LocalTaskResult) => {
      if (result.status !== 'waiting_for_human') finish(result);
    },
  };
  approvals.set(key, entry);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });

  return {
    dispose: () => {
      signal.removeEventListener('abort', abort);
      if (approvals.get(key) === entry) approvals.delete(key);
    },
    result,
  };
};
