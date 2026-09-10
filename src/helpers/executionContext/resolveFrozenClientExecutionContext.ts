import type {
  ExecutionAccessRoot,
  ExecutionContext,
  WorkspaceAccessGrant,
} from '@lobechat/types/src/executionContext';

import { buildExecutionAccessRoots } from './accessRoots';
import {
  resolveExecutionContext,
  type ResolveExecutionContextInput,
} from './resolveExecutionContext';

export interface ResolveFrozenClientExecutionContextInput extends ResolveExecutionContextInput {
  /** Persisted grants available to this renderer snapshot; mismatched or stale rows are ignored. */
  topicGrants?: readonly WorkspaceAccessGrant[];
  topicId?: string;
}

const toAccessRoot = (grant: WorkspaceAccessGrant): ExecutionAccessRoot => ({
  deviceId: grant.deviceId,
  expiresAt: grant.expiresAt,
  grantId: grant.id,
  modes: grant.modes,
  rootPath: grant.rootPath,
  scope: 'topic',
  source: 'user-approval',
  topicId: grant.topicId,
});

const getActiveTopicGrantRoots = (
  context: ExecutionContext,
  topicId: string | undefined,
  topicGrants: readonly WorkspaceAccessGrant[],
): ExecutionAccessRoot[] => {
  if (context.plan.kind !== 'device' || !topicId) return [];

  const now = Date.now();
  const deviceId = context.plan.deviceId;
  return topicGrants
    .filter(
      (grant) =>
        grant.topicId === topicId &&
        grant.deviceId === deviceId &&
        !grant.revokedAt &&
        (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now),
    )
    .map(toAccessRoot);
};

/**
 * Keep the execution identity captured by a running turn while refreshing the
 * mutable, persisted topic authority. Replacing (rather than appending) topic
 * roots ensures grants revoked or expired during an intervention cannot survive
 * through an older renderer snapshot.
 */
export const mergeCurrentTopicGrantsIntoExecutionContext = (input: {
  context: ExecutionContext;
  operationId: string;
  topicGrants?: readonly WorkspaceAccessGrant[];
  topicId?: string;
}): ExecutionContext => {
  const nonTopicRoots = (input.context.accessRoots ?? []).filter((root) => root.scope !== 'topic');
  const topicRoots = getActiveTopicGrantRoots(
    input.context,
    input.topicId,
    input.topicGrants ?? [],
  );
  const accessRoots = buildExecutionAccessRoots(input.context.cwd, [
    ...nonTopicRoots,
    ...topicRoots,
  ]);

  return {
    ...input.context,
    accessRoots: accessRoots ?? (input.context.accessRoots ? [] : undefined),
    operationId: input.operationId,
  };
};

/**
 * Freeze the renderer-side execution plan and attach only grants whose full
 * topic/device evidence matches that plan. The device boundary revalidates the
 * same tuple; retaining it here prevents a valid grant from degrading into an
 * unauthenticated path root during IPC projection.
 */
export const resolveFrozenClientExecutionContext = (
  input: ResolveFrozenClientExecutionContextInput,
): ExecutionContext => {
  const preliminary = resolveExecutionContext(input);
  const accessRoots = getActiveTopicGrantRoots(preliminary, input.topicId, input.topicGrants ?? []);

  return accessRoots.length > 0 ? resolveExecutionContext({ ...input, accessRoots }) : preliminary;
};
