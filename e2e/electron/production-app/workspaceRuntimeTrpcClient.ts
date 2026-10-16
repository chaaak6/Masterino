import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';

/**
 * The single substitution in the Workspace Runtime Electron E2E data chain.
 *
 * Everything above this module is the real product build: `useFetchChatTopics`
 * → `useFetchTopics` → the production chat store `useFetchTopics` action →
 * `@/libs/swr` → `topicService` → here, and `useWorkspaceTopicNavigation` →
 * the production `projectWorkspace` store `useFetchWorkspaces` action →
 * `@/libs/swr` → `projectWorkspaceService` → here. Only the HTTP transport is
 * replaced, so the Topic-navigation UI needs no HTTP server or account while
 * still failing when production actions, services or selectors get
 * disconnected.
 *
 * This boundary covers the *presentation* rows only. Every database, task,
 * topic and filesystem invariant is verified separately in the Electron main
 * process against the repository's isolated PGlite database and a real
 * temporary filesystem (see `workspaceRuntimeSeams.ts`).
 *
 * The fixtures deliberately apply the same server-side filtering the real
 * lambda routers apply (`agentId`, `excludeTriggers`, `excludeStatuses`,
 * `pageSize`). If the production hooks stop passing those params, the extra
 * system-owned rows leak into the sidebar and the spec fails.
 */

export const AGENT_ID = 'electron-e2e-agent';
export const DEVICE_ID = 'electron-e2e-device';
export const FORMAL_WORKSPACE_ID = 'workspace-product';
export const SCRATCH_WORKSPACE_ID = 'workspace-scratch';
export const SCRATCH_ROOT = '/tmp/masterino/topic-scratch';

const executionSnapshot = (workspaceId: string, workspaceKind: 'device' | 'scratch') => ({
  boundDeviceId: DEVICE_ID,
  target: 'local' as const,
  targetCapturedAt: '2026-09-04T00:00:00.000Z',
  version: 1 as const,
  workspaceBoundAt: '2026-09-04T00:00:00.000Z',
  workspaceId,
  workspaceKind,
});

/** Structural mirror of the `ChatTopic` row shape the topic router returns. */
interface TopicRow {
  createdAt: Date;
  favorite?: boolean;
  id: string;
  metadata?: Record<string, unknown>;
  status?: string;
  title: string;
  trigger?: string;
  updatedAt: Date;
}

const topic = (
  id: string,
  title: string,
  updatedAt: string,
  extra: Partial<TopicRow> = {},
): TopicRow => ({
  createdAt: new Date(updatedAt),
  id,
  title,
  updatedAt: new Date(updatedAt),
  ...extra,
});

/**
 * Server-shaped rows. `topic-task-run` and `topic-completed` are the negative
 * fixtures: they only disappear from the sidebar when the production hook
 * forwards `excludeTriggers` / `excludeStatuses` down to this boundary.
 */
const TOPIC_ROWS: TopicRow[] = [
  topic('topic-completed', 'Completed retro', '2026-09-04T05:00:00.000Z', { status: 'completed' }),
  topic('topic-task-run', 'Task run sweep', '2026-09-04T04:00:00.000Z', { trigger: 'task' }),
  topic('topic-workspace', 'Workspace feature work', '2026-09-04T03:00:00.000Z', {
    metadata: { executionSnapshot: executionSnapshot(FORMAL_WORKSPACE_ID, 'device') },
  }),
  topic('topic-scratch', 'Temporary work', '2026-09-04T02:00:00.000Z', {
    metadata: { executionSnapshot: executionSnapshot(SCRATCH_WORKSPACE_ID, 'scratch') },
  }),
  // Historical residue: older clients could leave status=running behind even
  // though there is no reconnectable operation. The production sidebar must
  // render this as idle rather than an infinite spinner.
  topic('topic-unbound', 'Pure chat', '2026-09-04T01:00:00.000Z', { status: 'running' }),
];

const WORKSPACE_ROWS: ProjectWorkspaceItem[] = [
  {
    deviceId: DEVICE_ID,
    displayName: 'Masterino product workspace',
    id: FORMAL_WORKSPACE_ID,
    kind: 'device',
    repoType: 'git',
    rootPath: '/workspace/masterino',
  },
  {
    deviceId: DEVICE_ID,
    id: SCRATCH_WORKSPACE_ID,
    kind: 'scratch',
    rootPath: SCRATCH_ROOT,
  },
];

export interface RecordedTrpcCall {
  input: unknown;
  path: string;
}

const calls: RecordedTrpcCall[] = [];

interface GetTopicsInput {
  agentId?: string;
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  groupId?: string;
  pageSize?: number;
}

/** Mirrors `topicRouter.getTopics` filtering closely enough to be load-bearing. */
const getTopics = async (input: GetTopicsInput = {}) => {
  if (!input.agentId && !input.groupId) return { items: [], total: 0 };

  const items = TOPIC_ROWS.filter((row) => {
    if (input.agentId && input.agentId !== AGENT_ID) return false;
    if (input.excludeTriggers?.includes(row.trigger ?? '')) return false;
    if (input.excludeStatuses?.includes(row.status ?? '')) return false;
    return true;
  });

  return { items: items.slice(0, input.pageSize ?? 20), total: items.length };
};

const procedures: Record<string, (input: any) => Promise<unknown>> = {
  'message.getMessages': async (input) => {
    if (input.agentId !== 'stream-bdd-agent')
      throw new Error('Message query is outside the stream recovery fixture');
    const response = await fetch(`http://127.0.0.1:14321/?scenario=snapshot&run=${input.topicId}`);
    if (!response.ok) throw new Error('Fixture snapshot unavailable');
    return response.json();
  },
  'projectWorkspace.list': async () => WORKSPACE_ROWS,
  // The sidebar Task module shares the mounted Accordion with Topic. It has its
  // own suite; here it only has to stay empty and independent of Topic.
  'task.groupList': async () => ({ data: [], success: true }),
  'topic.getTopics': getTopics,
};

const createProcedure = (path: string) => {
  const call = async (input?: unknown) => {
    calls.push({ input, path });
    const handler = procedures[path];
    if (!handler) {
      throw new Error(
        `TRPC procedure "${path}" is outside the Workspace Runtime Electron E2E boundary`,
      );
    }
    return handler(input);
  };

  return { mutate: call, query: call };
};

/**
 * tRPC proxy clients materialize procedures lazily, and production code probes
 * for them that way (see `resolveDefaultClient` in `@/services/projectWorkspace`).
 * Mirroring that shape keeps the seam detection identical to production.
 */
const createRouterClient = (clientName: string): any =>
  new Proxy(
    {},
    {
      get: (_target, routerName) => {
        if (typeof routerName !== 'string') return undefined;
        return new Proxy(
          {},
          {
            get: (_routerTarget, procedureName) => {
              if (typeof procedureName !== 'string') return undefined;
              return createProcedure(
                clientName === 'lambda'
                  ? `${routerName}.${procedureName}`
                  : `${clientName}:${routerName}.${procedureName}`,
              );
            },
          },
        );
      },
    },
  );

export const lambdaClient = createRouterClient('lambda');
export const toolsClient = createRouterClient('tools');
export const asyncClient = createRouterClient('async');
export const lambdaQuery = createRouterClient('lambdaQuery');
export const lambdaQueryClient = {};

// Assertion surface for the Playwright spec: proves the production hook →
// store action → service chain actually reached this boundary, and with which
// production-derived params.
(globalThis as unknown as Record<string, unknown>).__masterinoWorkspaceRuntimeTrpc = { calls };
