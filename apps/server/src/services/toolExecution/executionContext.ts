import type { GatewayToolCallExecutionContext } from '@lobechat/device-gateway-client';

import type { ToolExecutionContext } from './types';

/**
 * Project the immutable operation authority onto the device-gateway wire
 * shape. This is a server-to-device channel, so resolved env values are
 * allowed; renderer-facing dispatch uses an envRef instead.
 */
export const toGatewayExecutionContext = (
  context: ToolExecutionContext,
): GatewayToolCallExecutionContext | undefined => {
  const frozen = context.executionContext;
  if (!frozen) return;

  return {
    approvalMode: frozen.approvalMode,
    accessRoots: frozen.accessRoots?.map((root) => ({
      ...root,
      deviceId: context.activeDeviceId,
      operationId: context.operationId,
      topicId: context.topicId,
    })),
    cwd: frozen.cwd,
    env: frozen.env?.values,
    envFiles: frozen.envFiles,
    workspaceKind: frozen.workspace?.kind,
    workspaceRootPath: frozen.workspace?.rootPath,
  };
};
