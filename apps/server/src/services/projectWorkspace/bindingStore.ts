import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type {
  TopicExecutionSnapshot,
  WorkspaceBindDecision,
  WorkspaceBindingEvidence,
  WorkspaceKind,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';
import type { ChatTopicMetadata } from '@lobechat/types/src/topic';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { toWorkspaceRef } from '@/database/models/projectWorkspace';
import { projectWorkspaces } from '@/database/schemas/projectWorkspace';
import { topics } from '@/database/schemas/topic';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import {
  buildWorkspaceScopeKey,
  decideWorkspaceBind,
  isAbsoluteFilesystemPath,
  normalizeRootPath,
  normalizeWorkspaceIdentity,
} from '@/helpers/executionContext';

type ServerTopicMetadata = ChatTopicMetadata & {
  /** Authoritative server-authored state. */
  executionSnapshot?: TopicExecutionSnapshot;
  /** Transitional server-authored projection for readers not yet snapshot-aware. */
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
};

export interface TopicWorkspaceState {
  snapshot?: TopicExecutionSnapshot;
  /** A historical project exists, but its directory/device evidence cannot be resolved. */
  unresolvedProject?: boolean;
  workspace?: WorkspaceRef;
}

export interface BindTopicWorkspaceParams {
  now?: Date;
  target?: DeviceExecutionTarget;
  topicId: string;
  workspaceId: string;
}

export interface BindTopicWorkspaceResult {
  decision: WorkspaceBindDecision;
  snapshot: TopicExecutionSnapshot;
  workspace: WorkspaceRef;
}

export interface CaptureTopicTargetParams {
  boundDeviceId?: string;
  now?: Date;
  target: DeviceExecutionTarget;
  topicId: string;
}

export interface TopicWorkspaceBindingStore {
  bind: (params: BindTopicWorkspaceParams) => Promise<BindTopicWorkspaceResult>;
  captureTarget: (params: CaptureTopicTargetParams) => Promise<TopicExecutionSnapshot>;
  captureTargetIfAbsent: (params: CaptureTopicTargetParams) => Promise<TopicExecutionSnapshot>;
  getState: (topicId: string) => Promise<TopicWorkspaceState | undefined>;
}

export class WorkspaceAlreadyBoundError extends TRPCError {
  /** Scratch catalog evidence created before a concurrent formal bind won. */
  readonly scratchWorkspaceId?: string;

  constructor(scratchWorkspaceId?: string) {
    super({ code: 'FORBIDDEN', message: 'WORKSPACE_ALREADY_BOUND' });
    this.scratchWorkspaceId = scratchWorkspaceId;
  }
}

const isSnapshot = (value: unknown): value is TopicExecutionSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TopicExecutionSnapshot>;
  return (
    candidate.version === 1 &&
    typeof candidate.targetCapturedAt === 'string' &&
    ['local', 'device', 'sandbox', 'none'].includes(candidate.target as string)
  );
};

const readSnapshot = (metadata: ServerTopicMetadata | null | undefined) =>
  isSnapshot(metadata?.executionSnapshot) ? metadata.executionSnapshot : undefined;

const readBoundWorkspaceId = (
  metadata: ServerTopicMetadata | null | undefined,
  snapshot = readSnapshot(metadata),
) => snapshot?.workspaceId ?? metadata?.workspaceId;

const inferTarget = (workspace: WorkspaceRef): DeviceExecutionTarget =>
  workspace.kind === 'sandbox' ? 'sandbox' : 'device';

const assertTargetMatchesWorkspace = (target: DeviceExecutionTarget, workspace: WorkspaceRef) => {
  const valid =
    workspace.kind === 'sandbox' ? target === 'sandbox' : target === 'device' || target === 'local';
  if (!valid) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Execution target ${target} is incompatible with ${workspace.kind} workspace`,
    });
  }
};

const hasCanonicalIdentity = (row: typeof projectWorkspaces.$inferSelect): boolean =>
  row.scopeKey === buildWorkspaceScopeKey(toWorkspaceRef(row));

const legacyWorkspaceEvidence = (
  metadata: ServerTopicMetadata | null | undefined,
): WorkspaceRef | undefined => {
  if (
    !metadata?.workingDirectory ||
    !metadata.boundDeviceId ||
    !isAbsoluteFilesystemPath(metadata.workingDirectory)
  ) {
    return undefined;
  }

  return {
    deviceId: metadata.boundDeviceId,
    kind: metadata.workspaceKind === 'scratch' ? 'scratch' : 'device',
    rootPath: normalizeRootPath(metadata.workingDirectory),
  };
};

const mirrorMatchesWorkspace = (
  metadata: ServerTopicMetadata | null | undefined,
  workspace: WorkspaceRef,
): boolean => {
  const snapshot = readSnapshot(metadata);
  if (snapshot?.workspaceId && snapshot.workspaceId !== workspace.id) return false;
  if (snapshot?.workspaceKind && snapshot.workspaceKind !== workspace.kind) return false;
  if (snapshot?.boundDeviceId && snapshot.boundDeviceId !== workspace.deviceId) return false;
  if (metadata?.workspaceId && metadata.workspaceId !== workspace.id) return false;
  if (metadata?.workspaceKind && metadata.workspaceKind !== workspace.kind) return false;
  if (metadata?.boundDeviceId && metadata.boundDeviceId !== workspace.deviceId) return false;

  if (metadata?.workingDirectory) {
    if (workspace.kind === 'sandbox' || !isAbsoluteFilesystemPath(metadata.workingDirectory)) {
      return false;
    }
    if (normalizeRootPath(metadata.workingDirectory) !== normalizeRootPath(workspace.rootPath)) {
      return false;
    }
  }

  return true;
};

const withWorkspaceMirrors = (
  metadata: ServerTopicMetadata | null | undefined,
  snapshot: TopicExecutionSnapshot,
  workspace: WorkspaceRef,
): ServerTopicMetadata => {
  const next: ServerTopicMetadata = {
    ...metadata,
    executionSnapshot: snapshot,
    workspaceId: workspace.id,
    workspaceKind: workspace.kind,
  };

  if (workspace.kind === 'sandbox') {
    delete next.boundDeviceId;
    delete next.workingDirectory;
  } else {
    next.boundDeviceId = workspace.deviceId;
    next.workingDirectory = workspace.rootPath;
  }

  return next;
};

const selectTopicForUpdate = async (
  tx: Transaction,
  ownership: ReturnType<typeof buildWorkspaceWhere>,
  topicId: string,
) => {
  const [topic] = await tx
    .select({ metadata: topics.metadata, status: topics.status })
    .from(topics)
    .where(and(eq(topics.id, topicId), ownership))
    .limit(1)
    .for('update');
  return topic;
};

/** PostgreSQL-backed, serializable bind-once writer for topic execution state. */
export class DatabaseTopicWorkspaceBindingStore implements TopicWorkspaceBindingStore {
  private readonly db: LobeChatDatabase;
  private readonly ownership: ReturnType<typeof buildWorkspaceWhere>;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string, organizationWorkspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.ownership = buildWorkspaceWhere({ userId, workspaceId: organizationWorkspaceId }, topics);
  }

  bind = async (params: BindTopicWorkspaceParams): Promise<BindTopicWorkspaceResult> => {
    const now = params.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const topic = await selectTopicForUpdate(tx, this.ownership, params.topicId);
      if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
      if (topic.status === 'archived') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Archived topics cannot be bound' });
      }

      const [nextRow] = await tx
        .select()
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.id, params.workspaceId),
            eq(projectWorkspaces.userId, this.userId),
          ),
        )
        .limit(1);
      if (!nextRow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      if (!hasCanonicalIdentity(nextRow)) throw new WorkspaceAlreadyBoundError();

      const metadata = topic.metadata as ServerTopicMetadata | null | undefined;
      const snapshot = readSnapshot(metadata);
      const boundWorkspaceId = readBoundWorkspaceId(metadata, snapshot);
      const [currentRow] = boundWorkspaceId
        ? await tx
            .select()
            .from(projectWorkspaces)
            .where(
              and(
                eq(projectWorkspaces.id, boundWorkspaceId),
                eq(projectWorkspaces.userId, this.userId),
              ),
            )
            .limit(1)
        : [];

      if (boundWorkspaceId && (!currentRow || !hasCanonicalIdentity(currentRow))) {
        throw new WorkspaceAlreadyBoundError();
      }

      const currentWorkspace = currentRow
        ? toWorkspaceRef(currentRow)
        : legacyWorkspaceEvidence(metadata);
      if (currentWorkspace && !mirrorMatchesWorkspace(metadata, currentWorkspace)) {
        throw new WorkspaceAlreadyBoundError();
      }

      const nextWorkspace = toWorkspaceRef(nextRow);
      const evidence: WorkspaceBindingEvidence = {
        snapshot: boundWorkspaceId
          ? {
              workspaceId: boundWorkspaceId,
              workspaceKind: snapshot?.workspaceKind ?? metadata?.workspaceKind,
            }
          : snapshot,
        workspace: currentWorkspace,
      };
      const decision = decideWorkspaceBind(evidence, nextWorkspace);
      if (!decision.allowed) throw new WorkspaceAlreadyBoundError();

      if (currentWorkspace) {
        const currentIdentity = normalizeWorkspaceIdentity(currentWorkspace);
        const nextIdentity = normalizeWorkspaceIdentity(nextWorkspace);
        const currentTuple = currentIdentity.key.replace(/^id:[^:]+:/, '');
        const nextTuple = nextIdentity.key.replace(/^id:[^:]+:/, '');
        if (currentTuple !== nextTuple) throw new WorkspaceAlreadyBoundError();
      }

      // Topic creation freezes the execution target. A later legacy bind may
      // formalize the same target with a project, but cannot use that endpoint
      // as a back door to switch local/device/sandbox in place.
      if (snapshot && params.target && params.target !== snapshot.target) {
        throw new WorkspaceAlreadyBoundError();
      }
      const target = snapshot?.target ?? params.target ?? inferTarget(nextWorkspace);
      assertTargetMatchesWorkspace(target, nextWorkspace);
      const nextSnapshot: TopicExecutionSnapshot = {
        boundDeviceId: nextWorkspace.deviceId,
        target,
        targetCapturedAt:
          snapshot?.target === target ? snapshot.targetCapturedAt : now.toISOString(),
        version: 1,
        workspaceBoundAt: snapshot?.workspaceBoundAt ?? now.toISOString(),
        workspaceId: nextWorkspace.id,
        workspaceKind: nextWorkspace.kind,
      };

      await tx
        .update(topics)
        .set({
          metadata: withWorkspaceMirrors(metadata, nextSnapshot, nextWorkspace),
          updatedAt: now,
        })
        .where(and(eq(topics.id, params.topicId), this.ownership));
      await tx
        .update(projectWorkspaces)
        .set({ lastUsedAt: now, updatedAt: now })
        .where(
          and(
            eq(projectWorkspaces.id, params.workspaceId),
            eq(projectWorkspaces.userId, this.userId),
          ),
        );

      return { decision, snapshot: nextSnapshot, workspace: nextWorkspace };
    });
  };

  private writeTarget = async (
    params: CaptureTopicTargetParams,
    onlyIfAbsent: boolean,
  ): Promise<TopicExecutionSnapshot> => {
    const now = params.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const topic = await selectTopicForUpdate(tx, this.ownership, params.topicId);
      if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
      if (topic.status === 'archived') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Archived topics cannot be updated' });
      }

      const metadata = topic.metadata as ServerTopicMetadata | null | undefined;
      const current = readSnapshot(metadata);
      // Legacy-topic migration is a lock-protected compare-and-set. Concurrent
      // first operations must all observe the first committed target instead
      // of allowing the last waiter to overwrite it.
      if (onlyIfAbsent && current) return current;

      const boundWorkspaceId = readBoundWorkspaceId(metadata, current);
      let workspace = legacyWorkspaceEvidence(metadata);
      if (boundWorkspaceId) {
        const [row] = await tx
          .select()
          .from(projectWorkspaces)
          .where(
            and(
              eq(projectWorkspaces.id, boundWorkspaceId),
              eq(projectWorkspaces.userId, this.userId),
            ),
          )
          .limit(1);
        if (!row || !hasCanonicalIdentity(row)) throw new WorkspaceAlreadyBoundError();
        workspace = toWorkspaceRef(row);
        if (!mirrorMatchesWorkspace(metadata, workspace)) throw new WorkspaceAlreadyBoundError();
        assertTargetMatchesWorkspace(params.target, workspace);
      }

      const next: TopicExecutionSnapshot = {
        boundDeviceId: workspace?.deviceId ?? params.boundDeviceId,
        target: params.target,
        targetCapturedAt: now.toISOString(),
        version: 1,
        workspaceBoundAt: current?.workspaceBoundAt,
        workspaceId: workspace?.id,
        workspaceKind: workspace?.id ? workspace.kind : undefined,
      };
      const nextMetadata = workspace?.id
        ? withWorkspaceMirrors(metadata, next, workspace)
        : ({ ...metadata, executionSnapshot: next } satisfies ServerTopicMetadata);

      await tx
        .update(topics)
        .set({ metadata: nextMetadata, updatedAt: now })
        .where(and(eq(topics.id, params.topicId), this.ownership));
      return next;
    });
  };

  /**
   * Public compatibility seam. Topic targets are immutable after creation, so
   * even an older client calling this method gets first-writer-wins behavior.
   */
  captureTarget = async (params: CaptureTopicTargetParams): Promise<TopicExecutionSnapshot> =>
    this.writeTarget(params, true);

  /** Atomic first-writer-wins capture used only by legacy-topic migration. */
  captureTargetIfAbsent = async (
    params: CaptureTopicTargetParams,
  ): Promise<TopicExecutionSnapshot> => this.writeTarget(params, true);

  getState = async (topicId: string): Promise<TopicWorkspaceState | undefined> => {
    const [topic] = await this.db
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, topicId), this.ownership))
      .limit(1);
    if (!topic) return undefined;

    const metadata = topic.metadata as ServerTopicMetadata | null | undefined;
    const snapshot = readSnapshot(metadata);
    const workspaceId = readBoundWorkspaceId(metadata, snapshot);
    const [row] = workspaceId
      ? await this.db
          .select()
          .from(projectWorkspaces)
          .where(
            and(eq(projectWorkspaces.id, workspaceId), eq(projectWorkspaces.userId, this.userId)),
          )
          .limit(1)
      : [];

    const workspace = row
      ? hasCanonicalIdentity(row)
        ? toWorkspaceRef(row)
        : undefined
      : workspaceId
        ? undefined
        : legacyWorkspaceEvidence(metadata);
    if (workspace && !mirrorMatchesWorkspace(metadata, workspace)) {
      return { snapshot, workspace: undefined, unresolvedProject: true };
    }
    return {
      snapshot,
      workspace,
      ...(!workspace &&
      (snapshot?.workspaceKind ?? metadata?.workspaceKind) !== 'scratch' &&
      (workspaceId || metadata?.workingDirectory)
        ? { unresolvedProject: true }
        : {}),
    };
  };
}
