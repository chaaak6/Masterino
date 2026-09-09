import type {
  TopicExecutionSnapshot,
  TopicPlacement,
  TopicPlacementWorkspaceEvidence,
  WorkspaceKind,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';

import {
  buildWorkspaceScopeKey,
  isAbsoluteFilesystemPath,
  normalizeRootPath,
} from '@/helpers/executionContext';
import { classifyTopicPlacement } from '@/helpers/topicPlacement';
import type { ProjectWorkspaceItem, TopicWorkspaceState } from '@/services/projectWorkspace';
import type { ChatTopic, TopicSortBy } from '@/types/topic';

export type TopicRecentPlacement = Extract<TopicPlacement, { kind: 'recent' }>;

export interface TopicNavigationWorkspaceGroup {
  /** Old-server UI grouping only. Never use this value as formal workspace identity. */
  legacyWorkingDirectory?: string;
  topics: ChatTopic[];
  workspace?: ProjectWorkspaceItem | WorkspaceRef;
  /** Formal workspace id, or an opaque UI key for a legacy directory group. */
  workspaceId: string;
}

export interface TopicNavigationRecentEntry {
  placement: TopicRecentPlacement;
  topic: ChatTopic;
  /** Present for scratch/sandbox topics whose row is known; used for the tag tooltip. */
  workspace?: ProjectWorkspaceItem | WorkspaceRef;
}

export interface WorkspaceTopicNavigation {
  placementById: Record<string, TopicNavigationPlacement>;
  recent: TopicNavigationRecentEntry[];
  workspaceGroups: TopicNavigationWorkspaceGroup[];
}

export type TopicNavigationPlacement =
  | TopicPlacement
  | { kind: 'legacy-directory'; workingDirectory: string };

export interface TopicNavigationContext {
  /** Restore pre-A1 path grouping only after the new router is proven absent. */
  allowLegacyPathGroups?: boolean;
  /** undefined: shared web view; null: desktop identity is still loading. */
  currentDeviceId?: string | null;
  sortBy?: TopicSortBy;
  topicStatesById: Record<string, TopicWorkspaceState | undefined>;
  workspacesById: Record<string, ProjectWorkspaceItem | undefined>;
}

/**
 * Server-authored fields that may appear on topic metadata before the client
 * type is extended by integrate wiring. `executionSnapshot` is the authoritative
 * snapshot; `workspaceId` / `workspaceKind` are the transitional projection the
 * A1 binding store mirrors for snapshot-unaware readers.
 */
interface TransitionalTopicMetadata {
  boundDeviceId?: string;
  executionSnapshot?: TopicExecutionSnapshot;
  workingDirectory?: string;
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
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

const readTransitionalMetadata = (topic: Pick<ChatTopic, 'metadata'>): TransitionalTopicMetadata =>
  (topic.metadata ?? {}) as TransitionalTopicMetadata;

/** Authoritative server snapshot for a topic, if any. Never synthesized. */
export const readTopicExecutionSnapshot = (
  topic: Pick<ChatTopic, 'id' | 'metadata'>,
  topicState?: TopicWorkspaceState,
): TopicExecutionSnapshot | undefined => {
  if (topicState?.snapshot) return topicState.snapshot;
  const metadata = readTransitionalMetadata(topic);
  return isSnapshot(metadata.executionSnapshot) ? metadata.executionSnapshot : undefined;
};

const toWorkspaceEvidence = (
  workspace: ProjectWorkspaceItem | WorkspaceRef | undefined,
): TopicPlacementWorkspaceEvidence | undefined => {
  if (!workspace?.id) return undefined;
  return {
    // Explicit repository identity is the only project evidence a sandbox can
    // carry today; a plain `/workspace` sandbox stays in recent.
    hasProjectIdentity: 'repoType' in workspace ? !!workspace.repoType : false,
    id: workspace.id,
    kind: workspace.kind,
  };
};

interface PlacementEvidence {
  snapshot?: TopicExecutionSnapshot;
  workspace?: ProjectWorkspaceItem | WorkspaceRef;
}

const buildScopeIndex = (workspacesById: TopicNavigationContext['workspacesById']) => {
  const index = new Map<string, ProjectWorkspaceItem>();
  for (const workspace of Object.values(workspacesById)) {
    if (!workspace || workspace.kind === 'sandbox') continue;
    index.set(buildWorkspaceScopeKey(workspace), workspace);
  }
  return index;
};

/**
 * Collects server-side evidence for the placement classifier. Order:
 * 1. loaded topic state (snapshot + resolved row)
 * 2. `metadata.executionSnapshot`
 * 3. transitional `metadata.workspaceId` projection
 * 4. legacy `workingDirectory` + `boundDeviceId` matched to a persisted row
 *
 * A raw path never becomes a group key: legacy evidence only counts when it
 * resolves to an existing `project_workspaces` id.
 */
export const resolveTopicPlacementEvidence = (
  topic: Pick<ChatTopic, 'id' | 'metadata'>,
  context: TopicNavigationContext,
  scopeIndex: Map<string, ProjectWorkspaceItem> = buildScopeIndex(context.workspacesById),
): PlacementEvidence => {
  const topicState = context.topicStatesById[topic.id];
  const snapshot = readTopicExecutionSnapshot(topic, topicState);
  const metadata = readTransitionalMetadata(topic);

  const workspaceId = snapshot?.workspaceId ?? metadata.workspaceId;
  if (workspaceId) {
    const workspace = context.workspacesById[workspaceId] ?? topicState?.workspace;
    const effectiveSnapshot: TopicExecutionSnapshot = snapshot ?? {
      boundDeviceId: metadata.boundDeviceId,
      target: metadata.workspaceKind === 'sandbox' ? 'sandbox' : 'device',
      targetCapturedAt: '',
      version: 1,
      workspaceId,
      workspaceKind: metadata.workspaceKind,
    };
    return {
      snapshot: effectiveSnapshot,
      workspace: workspace?.id === workspaceId ? workspace : undefined,
    };
  }

  if (
    metadata.workingDirectory &&
    metadata.boundDeviceId &&
    isAbsoluteFilesystemPath(metadata.workingDirectory)
  ) {
    const kind: WorkspaceKind = metadata.workspaceKind === 'scratch' ? 'scratch' : 'device';
    const match = scopeIndex.get(
      buildWorkspaceScopeKey({
        deviceId: metadata.boundDeviceId,
        kind,
        rootPath: normalizeRootPath(metadata.workingDirectory),
      }),
    );
    if (match) {
      return {
        snapshot: {
          boundDeviceId: metadata.boundDeviceId,
          target: 'device',
          targetCapturedAt: '',
          version: 1,
          workspaceId: match.id,
          workspaceKind: match.kind,
        },
        workspace: match,
      };
    }
  }

  return { snapshot, workspace: topicState?.workspace };
};

/** Hide foreign or unidentified projects, while retaining ordinary chat history. */
export const isTopicVisibleOnDevice = (
  topic: Pick<ChatTopic, 'id' | 'metadata'>,
  context: TopicNavigationContext,
  scopeIndex?: Map<string, ProjectWorkspaceItem>,
): boolean => {
  if (context.currentDeviceId === undefined) return true;
  if (context.topicStatesById[topic.id]?.unresolvedProject) return false;
  const { snapshot, workspace } = resolveTopicPlacementEvidence(topic, context, scopeIndex);
  const metadata = readTransitionalMetadata(topic);
  const kind = snapshot?.workspaceKind ?? workspace?.kind ?? metadata.workspaceKind;
  if (kind === 'scratch') return true;
  const hasProject = !!(
    snapshot?.workspaceId ||
    metadata.workspaceId ||
    metadata.workingDirectory ||
    (workspace?.kind === 'device' ? workspace.rootPath : undefined)
  );
  if (!hasProject) return true;
  const deviceId = snapshot?.boundDeviceId ?? workspace?.deviceId ?? metadata.boundDeviceId;
  return (
    !!context.currentDeviceId &&
    deviceId === context.currentDeviceId &&
    (!workspace?.deviceId || workspace.deviceId === context.currentDeviceId)
  );
};

export const classifyTopicForNavigation = (
  topic: Pick<ChatTopic, 'id' | 'metadata'>,
  context: TopicNavigationContext,
  scopeIndex?: Map<string, ProjectWorkspaceItem>,
): { placement: TopicPlacement; workspace?: ProjectWorkspaceItem | WorkspaceRef } => {
  const evidence = resolveTopicPlacementEvidence(topic, context, scopeIndex);
  return {
    placement: classifyTopicPlacement(evidence.snapshot, toWorkspaceEvidence(evidence.workspace)),
    workspace: evidence.workspace,
  };
};

const timestampOf = (
  topic: Pick<ChatTopic, 'id' | 'metadata'>,
  field: 'createdAt' | 'updatedAt',
): number => {
  const value = topic[field] as unknown;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return new Date(value).getTime() || 0;
  return 0;
};

/** Favorites stay pinned first; the rest follow the chosen timestamp, newest first. */
const sortTopics = (topics: ChatTopic[], field: 'createdAt' | 'updatedAt'): ChatTopic[] => {
  const byTime = (a: ChatTopic, b: ChatTopic) => timestampOf(b, field) - timestampOf(a, field);
  const favorites = topics.filter((topic) => topic.favorite).sort(byTime);
  const rest = topics.filter((topic) => !topic.favorite).sort(byTime);
  return [...favorites, ...rest];
};

const buildLegacyDirectoryGroupKey = (workingDirectory: string): string =>
  `legacy-directory:${encodeURIComponent(workingDirectory)}`;

export const assertDisjointTopicNavigation = (navigation: WorkspaceTopicNavigation): void => {
  const seen = new Set<string>();
  const check = (id: string, where: string) => {
    if (seen.has(id)) {
      throw new Error(`Topic navigation invariant violated: topic ${id} appears twice (${where})`);
    }
    seen.add(id);
  };
  for (const group of navigation.workspaceGroups) {
    for (const topic of group.topics) check(topic.id, `workspace:${group.workspaceId}`);
  }
  for (const entry of navigation.recent) check(entry.topic.id, 'recent');
};

/**
 * Derives the fixed Topic sidebar navigation: formal workspace groups on top,
 * one flat recent list at the bottom. Every visible topic lands in exactly one set.
 * Input is expected to already be page-sliced and completed-filtered by the
 * topic fetch; this function only classifies and orders.
 */
export const buildWorkspaceTopicNavigation = (
  topics: readonly ChatTopic[],
  context: TopicNavigationContext,
): WorkspaceTopicNavigation => {
  const field: 'createdAt' | 'updatedAt' =
    context.sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
  const scopeIndex = buildScopeIndex(context.workspacesById);
  const placementById: Record<string, TopicNavigationPlacement> = {};
  const groups = new Map<string, TopicNavigationWorkspaceGroup>();
  const recent: TopicNavigationRecentEntry[] = [];

  for (const topic of topics) {
    if (!isTopicVisibleOnDevice(topic, context, scopeIndex)) continue;
    const { placement, workspace } = classifyTopicForNavigation(topic, context, scopeIndex);
    placementById[topic.id] = placement;

    if (placement.kind === 'workspace') {
      const group = groups.get(placement.workspaceId) ?? {
        topics: [],
        workspace: context.workspacesById[placement.workspaceId] ?? workspace,
        workspaceId: placement.workspaceId,
      };
      group.topics.push(topic);
      groups.set(placement.workspaceId, group);
      continue;
    }

    const metadata = readTransitionalMetadata(topic);
    if (
      context.allowLegacyPathGroups &&
      metadata.workingDirectory &&
      isAbsoluteFilesystemPath(metadata.workingDirectory)
    ) {
      const workingDirectory = normalizeRootPath(metadata.workingDirectory);
      const groupKey = buildLegacyDirectoryGroupKey(workingDirectory);
      const group = groups.get(groupKey) ?? {
        legacyWorkingDirectory: workingDirectory,
        topics: [],
        workspace: {
          deviceId: metadata.boundDeviceId,
          kind: 'device' as const,
          rootPath: workingDirectory,
        },
        workspaceId: groupKey,
      };
      group.topics.push(topic);
      groups.set(groupKey, group);
      placementById[topic.id] = { kind: 'legacy-directory', workingDirectory };
      continue;
    }

    recent.push({ placement, topic, workspace });
  }

  const workspaceGroups = [...groups.values()]
    .map((group) => ({ ...group, topics: sortTopics(group.topics, field) }))
    .sort(
      (a, b) =>
        Math.max(...b.topics.map((topic) => timestampOf(topic, field))) -
        Math.max(...a.topics.map((topic) => timestampOf(topic, field))),
    );

  const recentSorted = sortTopics(
    recent.map((entry) => entry.topic),
    field,
  ).map((topic) => recent.find((entry) => entry.topic.id === topic.id)!);

  const navigation: WorkspaceTopicNavigation = {
    placementById,
    recent: recentSorted,
    workspaceGroups,
  };

  if (process.env.NODE_ENV !== 'production') assertDisjointTopicNavigation(navigation);

  return navigation;
};
