import type { WorkspaceInitResult, WorkspaceRef } from '@lobechat/types';

import { isDesktop } from '@/const/version';
import { projectSkillService } from '@/services/projectSkill';
import { useElectronStore } from '@/store/electron';

/** A new operation scans its own frozen workspace; retries reuse its captured result. */
export async function scanOperationWorkspace(
  workspace?: WorkspaceRef,
): Promise<WorkspaceInitResult | undefined> {
  if (!workspace || !['device', 'scratch'].includes(workspace.kind) || !workspace.deviceId)
    return undefined;
  const localDeviceId = useElectronStore.getState().gatewayDeviceInfo?.deviceId;
  return projectSkillService.scanWorkspace({
    deviceId: isDesktop && localDeviceId === workspace.deviceId ? undefined : workspace.deviceId,
    scope: workspace.rootPath,
  });
}
