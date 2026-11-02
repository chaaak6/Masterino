import type {
  ExecutionAccessRoot,
  OperationPathConsentApproval,
  PathAccessMode,
  WorkspacePathConsentRequest,
} from '@lobechat/types/src/executionContext';

import { isAbsoluteFilesystemPath, normalizeRootPath } from './workspaceIdentity';

const PATH_ACCESS_MODES = new Set<PathAccessMode>(['exec', 'read', 'write']);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const normalizeModes = (value: unknown): PathAccessMode[] | undefined => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((mode): mode is PathAccessMode => PATH_ACCESS_MODES.has(mode as PathAccessMode))
  ) {
    return;
  }
  return [...new Set(value)];
};

export const parseWorkspacePathConsentRequest = (
  value: unknown,
): WorkspacePathConsentRequest | undefined => {
  const request = asRecord(value);
  const modes = normalizeModes(request?.modes);
  if (
    request?.version !== 1 ||
    typeof request.actualCwd !== 'string' ||
    typeof request.deviceId !== 'string' ||
    !request.deviceId ||
    typeof request.operationId !== 'string' ||
    !request.operationId ||
    typeof request.primaryCwd !== 'string' ||
    typeof request.requestedPath !== 'string' ||
    !isAbsoluteFilesystemPath(request.requestedPath) ||
    typeof request.topicId !== 'string' ||
    !request.topicId ||
    !modes ||
    (request.requestedFilePath !== undefined &&
      (typeof request.requestedFilePath !== 'string' ||
        !isAbsoluteFilesystemPath(request.requestedFilePath)))
  ) {
    return;
  }

  return {
    ...(request.requestedFilePath !== undefined
      ? { requestedFilePath: request.requestedFilePath as string }
      : {}),
    actualCwd: request.actualCwd,
    deviceId: request.deviceId,
    modes,
    operationId: request.operationId,
    primaryCwd: request.primaryCwd,
    // Keep the device-runtime-authored lexical value intact. The approval is
    // bound to this exact request before the server asks that same device for
    // the canonical realpath; normalizing here would make `/a/../b` and `/b`
    // indistinguishable before the device proof exists.
    requestedPath: request.requestedPath,
    topicId: request.topicId,
    version: 1,
  };
};

export const getRuntimePathConsentRequest = (plugin: {
  intervention?: unknown;
  state?: unknown;
}): WorkspacePathConsentRequest | undefined => {
  const state = asRecord(plugin.state);
  const intervention = asRecord(plugin.intervention);
  return parseWorkspacePathConsentRequest(
    state?.workspacePathConsent ?? intervention?.workspacePathConsent,
  );
};

/**
 * Convert an operation consent decision to a frozen access root only after it
 * matches the runtime-authored intervention tuple. Prompt/tool arguments never
 * participate in this decision.
 */
export const validateOperationPathConsent = (params: {
  approval: OperationPathConsentApproval;
  /** Device-authored realpath. Omit only for the pre-RPC tuple validation. */
  canonicalRootPath?: string;
  currentOperationId: string;
  currentTopicId: string;
  currentDeviceId?: string;
  request: WorkspacePathConsentRequest | undefined;
}): ExecutionAccessRoot => {
  const {
    approval,
    canonicalRootPath,
    currentDeviceId,
    currentOperationId,
    currentTopicId,
    request,
  } = params;
  if (!request) throw new Error('Path consent is missing runtime-authored intervention evidence');
  if (approval.version !== 1 || approval.scope !== 'operation') {
    throw new Error('Path consent has an unsupported scope or version');
  }

  const approvalModes = normalizeModes(approval.modes);
  const requestModes = normalizeModes(request.modes);
  if (
    !approvalModes ||
    !requestModes ||
    approvalModes.length !== requestModes.length ||
    approvalModes.some((mode) => !requestModes.includes(mode))
  ) {
    throw new Error('Operation path consent modes do not match the pending request');
  }

  const rootPath = normalizeRootPath(approval.rootPath);
  if (
    !isAbsoluteFilesystemPath(approval.rootPath) ||
    approval.requestedPath !== request.requestedPath ||
    approval.sourceOperationId !== request.operationId ||
    approval.topicId !== request.topicId ||
    approval.topicId !== currentTopicId ||
    approval.deviceId !== request.deviceId ||
    approval.deviceId !== currentDeviceId
  ) {
    throw new Error('Path consent does not match the pending operation, topic, device, and root');
  }

  if (
    canonicalRootPath !== undefined &&
    (!isAbsoluteFilesystemPath(canonicalRootPath) || approval.rootPath !== canonicalRootPath)
  ) {
    throw new Error('Path consent canonical root does not match the selected device realpath');
  }

  return {
    deviceId: approval.deviceId,
    modes: approvalModes,
    operationId: currentOperationId,
    rootPath,
    scope: 'operation',
    source: 'user-approval',
    topicId: currentTopicId,
  };
};
