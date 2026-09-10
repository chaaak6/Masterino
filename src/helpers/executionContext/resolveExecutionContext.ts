import type { LobeAgentAgencyConfig } from '@lobechat/types/src/agent/agencyConfig';
import type { LobeAgentChatConfig } from '@lobechat/types/src/agent/chatConfig';
import type {
  ExecutionAccessRoot,
  ExecutionContext,
  ExecutionContextError,
  ExecutionEnv,
  ToolCallExecutionContext,
} from '@lobechat/types/src/executionContext';
import type {
  ExecutionTargetByPlatform,
  TopicExecutionSnapshot,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';

import { resolveExecutionPlan } from '../executionTarget';
import { buildExecutionAccessRoots } from './accessRoots';
import { isAbsoluteFilesystemPath, normalizeRootPath } from './workspaceIdentity';

export interface ExecutionAgencyConfig extends LobeAgentAgencyConfig {
  defaultWorkspaceByDevice?: Record<string, string>;
  executionTargetByPlatform?: ExecutionTargetByPlatform;
}

export interface LegacyTopicWorkspaceEvidence {
  boundDeviceId?: string;
  /** Compatibility mirror; URLs and repository slugs are rejected. */
  workingDirectory?: string;
  workspaceId?: string;
}

export interface ResolveExecutionContextInput {
  accessRoots?: readonly ExecutionAccessRoot[];
  agencyConfig?: ExecutionAgencyConfig;
  canUseDevice?: boolean;
  chatConfig?: LobeAgentChatConfig;
  env?: ExecutionEnv;
  envFiles?: string[];
  executionTargetByPlatform?: ExecutionTargetByPlatform;
  initialTopicMetadata?: { workingDirectory?: string; workspaceId?: string };
  isDesktop: boolean;
  isHetero?: boolean;
  onlineDeviceIds?: string[];
  operationId?: string;
  requestedDeviceId?: string;
  snapshot?: TopicExecutionSnapshot;
  topic?: LegacyTopicWorkspaceEvidence;
  workspaces?: Readonly<Record<string, WorkspaceRef | undefined>>;
}

const normalizeResolvedWorkspace = (workspace: WorkspaceRef): WorkspaceRef => ({
  ...workspace,
  rootPath: normalizeRootPath(workspace.rootPath),
});

const getWorkspaceById = (
  id: string | undefined,
  workspaces: ResolveExecutionContextInput['workspaces'],
): WorkspaceRef | undefined => {
  const workspace = id ? workspaces?.[id] : undefined;
  return workspace?.id === id ? workspace : undefined;
};

const matchesBoundWorkspaceEvidence = (
  workspace: WorkspaceRef,
  workspaceId: string,
  input: Pick<ResolveExecutionContextInput, 'snapshot' | 'topic'>,
): boolean => {
  if (workspace.id !== workspaceId) return false;

  const { snapshot, topic } = input;
  if (snapshot?.workspaceId) {
    if (snapshot.workspaceId !== workspaceId) return false;
    if (snapshot.workspaceKind && workspace.kind !== snapshot.workspaceKind) return false;
    if (snapshot.boundDeviceId && workspace.deviceId !== snapshot.boundDeviceId) return false;
  }

  if (topic?.workspaceId && topic.workspaceId !== workspaceId) return false;
  if (topic?.boundDeviceId && workspace.deviceId !== topic.boundDeviceId) return false;
  if (
    topic?.workingDirectory &&
    (!isAbsoluteFilesystemPath(topic.workingDirectory) ||
      normalizeRootPath(workspace.rootPath) !== normalizeRootPath(topic.workingDirectory))
  ) {
    return false;
  }

  return true;
};

const isDeviceWorkspaceFor = (workspace: WorkspaceRef | undefined, deviceId: string): boolean =>
  !!workspace &&
  (workspace.kind === 'device' || workspace.kind === 'scratch') &&
  workspace.deviceId === deviceId &&
  isAbsoluteFilesystemPath(workspace.rootPath);

const resolveDeviceWorkspace = (
  input: ResolveExecutionContextInput,
  deviceId: string,
): WorkspaceRef | undefined => {
  const boundWorkspaceId = input.snapshot?.workspaceId ?? input.topic?.workspaceId;
  const boundWorkspace = getWorkspaceById(boundWorkspaceId, input.workspaces);
  if (boundWorkspaceId) {
    if (
      !boundWorkspace ||
      !matchesBoundWorkspaceEvidence(boundWorkspace, boundWorkspaceId, input)
    ) {
      return undefined;
    }
    return isDeviceWorkspaceFor(boundWorkspace, deviceId)
      ? normalizeResolvedWorkspace(boundWorkspace)
      : undefined;
  }

  const topicPath = input.topic?.workingDirectory;
  if (
    topicPath &&
    isAbsoluteFilesystemPath(topicPath) &&
    (!input.topic?.boundDeviceId || input.topic.boundDeviceId === deviceId)
  ) {
    return normalizeResolvedWorkspace({ deviceId, kind: 'device', rootPath: topicPath });
  }

  const initialWorkspace = getWorkspaceById(
    input.initialTopicMetadata?.workspaceId,
    input.workspaces,
  );
  if (isDeviceWorkspaceFor(initialWorkspace, deviceId)) {
    return normalizeResolvedWorkspace(initialWorkspace!);
  }

  const initialPath = input.initialTopicMetadata?.workingDirectory;
  if (initialPath && isAbsoluteFilesystemPath(initialPath)) {
    return normalizeResolvedWorkspace({ deviceId, kind: 'device', rootPath: initialPath });
  }

  return undefined;
};

const resolveSandboxWorkspace = (input: ResolveExecutionContextInput): WorkspaceRef | undefined => {
  const workspaceId = input.snapshot?.workspaceId ?? input.topic?.workspaceId;
  const persisted = getWorkspaceById(workspaceId, input.workspaces);

  if (workspaceId) {
    if (
      !persisted ||
      persisted.kind !== 'sandbox' ||
      !matchesBoundWorkspaceEvidence(persisted, workspaceId, input) ||
      normalizeRootPath(persisted.rootPath) !== '/workspace'
    ) {
      return undefined;
    }
    return normalizeResolvedWorkspace(persisted);
  }

  return {
    kind: 'sandbox',
    rootPath: '/workspace',
  };
};

/** Pure resolver: callers preload all rows/evidence; this function performs no IO or binding. */
export const resolveExecutionContext = (input: ResolveExecutionContextInput): ExecutionContext => {
  const executionTargetByPlatform =
    input.executionTargetByPlatform ?? input.agencyConfig?.executionTargetByPlatform;
  const plan = resolveExecutionPlan({
    agencyConfig: input.agencyConfig,
    canUseDevice: input.canUseDevice,
    chatConfig: input.chatConfig,
    executionTargetByPlatform,
    isDesktop: input.isDesktop,
    isHetero: input.isHetero,
    onlineDeviceIds: input.onlineDeviceIds,
    requestedDeviceId: input.requestedDeviceId,
    topicSnapshot: input.snapshot,
  });
  const common = {
    env: input.env,
    envFiles: input.envFiles,
    operationId: input.operationId,
    plan,
    snapshot: input.snapshot,
    version: 1 as const,
  };

  if (plan.kind === 'none') {
    return {
      ...common,
      accessRoots: buildExecutionAccessRoots(undefined, input.accessRoots),
      unresolvedReason: 'target-none',
    };
  }

  if (plan.kind === 'device-unrouted') {
    return {
      ...common,
      accessRoots: buildExecutionAccessRoots(undefined, input.accessRoots),
      unresolvedReason: 'device-unrouted',
    };
  }

  const workspace =
    plan.kind === 'sandbox'
      ? resolveSandboxWorkspace(input)
      : resolveDeviceWorkspace(input, plan.deviceId);

  if (!workspace) {
    return {
      ...common,
      accessRoots: buildExecutionAccessRoots(undefined, input.accessRoots),
      unresolvedReason: 'no-workspace',
    };
  }

  const cwd = workspace.rootPath;
  return {
    ...common,
    accessRoots: buildExecutionAccessRoots(cwd, input.accessRoots),
    cwd,
    workspace,
  };
};

export const assertExecutionContextReady = (
  context: ExecutionContext,
  options: { requireWorkspace: boolean },
): ExecutionContextError | undefined => {
  if (context.plan.kind === 'none' && options.requireWorkspace) {
    return { code: 'TARGET_NONE', message: 'No execution target is selected.' };
  }

  if (context.plan.kind === 'device-unrouted') {
    const isLocal = context.plan.target === 'local';
    return {
      code: isLocal ? 'LOCAL_TARGET_UNAVAILABLE' : 'DEVICE_UNROUTED',
      message: isLocal
        ? 'The local execution target is unavailable.'
        : 'The selected device is unavailable.',
      unroutedReason: context.plan.reason,
    };
  }

  if (options.requireWorkspace && !context.workspace) {
    return { code: 'WORKSPACE_REQUIRED', message: 'A workspace is required for this operation.' };
  }

  return undefined;
};

/** Server/gateway projection. Browser paths must pass envRef and omit includeEnvValues. */
export const toToolCallExecutionContext = (
  context: ExecutionContext,
  options: { envRef?: ToolCallExecutionContext['envRef']; includeEnvValues?: boolean } = {},
): ToolCallExecutionContext => ({
  accessRoots: context.accessRoots,
  approvalMode: context.approvalMode,
  cwd: context.cwd,
  env: options.includeEnvValues ? context.env?.values : undefined,
  envFiles: context.envFiles,
  envRef: options.envRef,
  workspaceKind: context.workspace?.kind,
  workspaceRootPath: context.workspace?.rootPath,
});
