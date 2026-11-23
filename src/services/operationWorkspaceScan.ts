import {
  isWorkspaceScanErrorCode,
  type WorkspaceScanErrorCode,
} from '@lobechat/device-control/workspaceError';
import type { WorkspaceInitResult, WorkspaceRef } from '@lobechat/types';

import { isDesktop } from '@/const/version';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { projectSkillService } from '@/services/projectSkill';
import { useElectronStore } from '@/store/electron';
import { isMacOS } from '@/utils/platform';

export class OperationWorkspaceScanError extends Error {
  constructor(
    message: string,
    readonly code: WorkspaceScanErrorCode,
    readonly localMacDeviceId?: string,
  ) {
    super(message);
  }
}

/** A new operation scans its own frozen workspace; retries reuse its captured result. */
export async function scanOperationWorkspace(
  workspace?: WorkspaceRef,
): Promise<WorkspaceInitResult | undefined> {
  if (!workspace || !['device', 'scratch'].includes(workspace.kind) || !workspace.deviceId)
    return undefined;
  const localDeviceId = isDesktop
    ? (useElectronStore.getState().gatewayDeviceInfo?.deviceId ??
      (await gatewayConnectionService.getDeviceInfo().catch(() => undefined))?.deviceId)
    : undefined;
  const local = isDesktop && localDeviceId === workspace.deviceId;
  try {
    return await projectSkillService.scanWorkspace({
      deviceId: local ? undefined : workspace.deviceId,
      scope: workspace.rootPath,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const { code, data } = error as Error & {
      code?: unknown;
      data?: { errorData?: { workspaceScanCode?: unknown } };
    };
    const scanCode = local ? code : data?.errorData?.workspaceScanCode;
    if (!isWorkspaceScanErrorCode(scanCode)) throw error;
    throw new OperationWorkspaceScanError(
      error.message,
      scanCode,
      local && isMacOS() ? localDeviceId : undefined,
    );
  }
}
