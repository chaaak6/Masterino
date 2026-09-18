import type {
  NormalizedWorkspaceIdentity,
  WorkspaceBindDecision,
  WorkspaceBindingEvidence,
  WorkspaceIdentity,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';

/** Lexical filesystem-path check only; device-side realpath remains the security boundary. */
export const isAbsoluteFilesystemPath = (value: string): boolean => {
  const normalized = value.trim().replaceAll('\\', '/');
  return normalized.startsWith('/') || /^[A-Z]:\//i.test(normalized);
};

/**
 * Canonical comparison form. This function intentionally does no filesystem IO and therefore
 * must not be used as a substitute for device-side realpath checks.
 */
export const normalizeRootPath = (value: string): string => {
  const withSlashes = value.trim().replaceAll('\\', '/');
  const hasUncPrefix = withSlashes.startsWith('//');
  const withoutUncPrefix = hasUncPrefix ? withSlashes.slice(2).replace(/^\/+/, '') : withSlashes;
  const collapsed = withoutUncPrefix.replaceAll(/\/{2,}/g, '/');
  const withNormalizedPrefix = hasUncPrefix ? `//${collapsed}` : collapsed;
  const driveNormalized = withNormalizedPrefix.replace(
    /^([A-Z]):\//,
    (_, drive: string) => `${drive.toLowerCase()}:/`,
  );

  if (driveNormalized === '/' || /^[a-z]:\/$/.test(driveNormalized)) return driveNormalized;
  return driveNormalized.replace(/\/+$/, '');
};

export const buildWorkspaceScopeKey = (identity: WorkspaceIdentity): string =>
  `${identity.kind}:${identity.deviceId ?? 'sandbox'}:${normalizeRootPath(identity.rootPath)}`;

export const normalizeWorkspaceIdentity = (
  workspace: WorkspaceRef,
): NormalizedWorkspaceIdentity => {
  const identity: WorkspaceIdentity = {
    deviceId: workspace.deviceId,
    kind: workspace.kind,
    rootPath: normalizeRootPath(workspace.rootPath),
  };

  return {
    ...identity,
    key: workspace.id
      ? `id:${workspace.id}:${buildWorkspaceScopeKey(identity)}`
      : buildWorkspaceScopeKey(identity),
    workspaceId: workspace.id,
  };
};

export const isSameWorkspace = (left: WorkspaceRef, right: WorkspaceRef): boolean => {
  if (left.id && right.id && left.id !== right.id) return false;
  return buildWorkspaceScopeKey(left) === buildWorkspaceScopeKey(right);
};

export const decideWorkspaceBind = (
  current: WorkspaceBindingEvidence,
  next: WorkspaceRef,
): WorkspaceBindDecision => {
  const boundWorkspaceId = current.snapshot?.workspaceId;

  if (!boundWorkspaceId && !current.workspace) {
    return { allowed: true, reason: 'first-bind' };
  }

  if (boundWorkspaceId && (
      !current.workspace ||
      current.workspace.id !== boundWorkspaceId ||
      next.id !== boundWorkspaceId ||
      (current.snapshot?.workspaceKind && current.workspace.kind !== current.snapshot.workspaceKind)
    )) {
      return { allowed: false, reason: 'already-bound' };
    }

  if (current.workspace && isSameWorkspace(current.workspace, next)) {
    return { allowed: true, reason: 'same-workspace' };
  }
  return { allowed: false, reason: 'already-bound' };
};
