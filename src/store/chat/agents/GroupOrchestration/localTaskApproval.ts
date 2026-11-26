import type { AgentState, Cost, Usage } from '@lobechat/agent-runtime';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface LocalTaskRun {
  cost?: Cost;
  status?: AgentState['status'];
  taskMessages?: UIChatMessage[];
  usage?: Usage;
}

interface LocalTaskMetrics {
  duration?: number;
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

interface LocalTaskResult extends LocalTaskMetrics {
  status?: AgentState['status'];
  taskMessages?: UIChatMessage[];
}

const approvals = new Map<
  string,
  { operationId: string; report: (result: LocalTaskRun) => void; resume: () => void }
>();

export const getLocalTaskApproval = (context: ConversationContext) =>
  context.groupId && context.threadId ? approvals.get(messageMapKey(context)) : undefined;

const addMetric = (total?: number, value?: number) =>
  value === undefined ? total : (total ?? 0) + value;

/** A group task stays owned by the spawning renderer while its member awaits a tool decision. */
export const trackLocalTaskApproval = (
  context: ConversationContext,
  operationId: string,
  signal: AbortSignal,
  { onTimeout, timeout }: { onTimeout: () => void; timeout: number },
) => {
  const key = messageMapKey(context);
  let settle!: (result: LocalTaskResult) => void;
  const result = new Promise<LocalTaskResult>((resolve) => {
    settle = resolve;
  });
  let remaining = timeout;
  let startedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const metrics: LocalTaskMetrics = {};

  const pause = () => {
    if (startedAt === undefined) return;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    startedAt = undefined;
    clearTimeout(timer);
  };
  const finish = (status: AgentState['status'] | undefined, taskMessages?: UIChatMessage[]) => {
    finished = true;
    pause();
    settle({ ...metrics, status, ...(taskMessages && { taskMessages }) });
  };
  const abort = () => finish('interrupted');

  const entry = {
    operationId,
    report: ({ cost, status, taskMessages, usage }: LocalTaskRun) => {
      if (finished) return;
      pause();
      metrics.totalCost = addMetric(metrics.totalCost, cost?.total);
      metrics.duration = addMetric(metrics.duration, usage?.llm?.processingTimeMs);
      metrics.totalInputTokens = addMetric(metrics.totalInputTokens, usage?.llm?.tokens?.input);
      metrics.totalOutputTokens = addMetric(metrics.totalOutputTokens, usage?.llm?.tokens?.output);
      metrics.totalTokens = addMetric(metrics.totalTokens, usage?.llm?.tokens?.total);
      if (status !== 'waiting_for_human') finish(status, taskMessages);
    },
    resume: () => {
      if (finished || startedAt !== undefined) return;
      startedAt = Date.now();
      timer = setTimeout(onTimeout, remaining);
    },
  };
  approvals.set(key, entry);
  if (signal.aborted) abort();
  else {
    signal.addEventListener('abort', abort, { once: true });
    entry.resume();
  }

  return {
    dispose: () => {
      pause();
      signal.removeEventListener('abort', abort);
      if (approvals.get(key) === entry) approvals.delete(key);
    },
    report: entry.report,
    result,
  };
};
