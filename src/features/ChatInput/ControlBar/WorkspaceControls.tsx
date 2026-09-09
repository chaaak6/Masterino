'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useEffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

import CloudRepoSwitcher from './CloudRepoSwitcher';
import GitStatus from './GitStatus';
import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import { useBindWorkspaceOnce } from './useBindWorkspaceOnce';
import { useRepoType } from './useRepoType';
import WorkspaceChip from './WorkspaceChip';
import WorkspacePicker from './WorkspacePicker';

interface WorkspaceControlsProps {
  agentId: string;
  /**
   * Force the workspace cluster to show even when the runtime isn't in local
   * mode. Heterogeneous agents always run inside a working directory, so they
   * pass `true`; normal agents only surface it for device-capable plans.
   */
  alwaysShowWorkspace?: boolean;
}

/**
 * Workspace/Project control strip shared by the chat-input control bars:
 * target switcher + read-only workspace chip + git status.
 *
 * All state comes from `useEffectiveWorkspace` (the accepted contract).
 * Header drafts can edit their inherited choices until first send. Recent
 * drafts have no user-selectable workspace. A
 * workspace-group draft, a bound topic, or a scratch topic gets a read-only
 * chip. Target switches only touch the draft intent or the current topic
 * snapshot, never the agent's stored defaults.
 */
const WorkspaceControls = memo<WorkspaceControlsProps>(
  ({ agentId, alwaysShowWorkspace = false }) => {
    const { t } = useTranslation('chat');
    const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
    const effective = useEffectiveWorkspace(agentId);
    const bind = useBindWorkspaceOnce(effective, agentId);
    const editableDraft = effective.isDraft && !effective.topicId && effective.draftRuntimeEditable;

    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    const setDraftTargetIntent = useProjectWorkspaceStore((s) => s.setDraftTargetIntent);

    const handleSelectTarget = useCallback(
      (target: DeviceExecutionTarget, deviceId?: string) => {
        // Existing topics and project-scoped new pages are rendered read-only.
        // This guard also makes an unexpected stale callback harmless.
        if (!effective.isDraft || effective.topicId) return;
        const targetDeviceId =
          target === 'device'
            ? deviceId
            : target === 'local'
              ? (deviceId ?? currentDeviceId)
              : undefined;
        setDraftTargetIntent(effective.draftKey, { target, targetDeviceId });
      },
      [
        currentDeviceId,
        effective.draftKey,
        effective.isDraft,
        effective.topicId,
        setDraftTargetIntent,
      ],
    );

    const isDeviceTarget = effective.target === 'local' || effective.target === 'device';
    const isLocalDevice =
      isDesktop && !!effective.targetDeviceId && effective.targetDeviceId === currentDeviceId;
    const displayTarget =
      !isDesktop && effective.target === 'local'
        ? 'device'
        : isLocalDevice
          ? 'local'
          : effective.target;
    const cwd = effective.cwd;

    // Local machine probes the filesystem for repoType; a remote device's repoType
    // comes from the cached `workingDirs` entry (we can't probe a remote fs here).
    const localRepoType = useRepoType(isLocalDevice ? cwd : undefined);
    const remoteDirs = useDeviceStore(
      deviceSelectors.getDeviceWorkingDirs(effective.targetDeviceId),
    );
    const remoteRepoType = remoteDirs.find((d) => d.path === cwd)?.repoType;
    const repoType = isLocalDevice ? localRepoType : remoteRepoType;

    const renderWorkspace = () => {
      // Web has no local filesystem — cloud / heterogeneous agents browse the repo
      // through the cloud repo switcher when they are not routed to a device.
      if (!isDesktop) {
        return !isDeviceTarget && (isHeterogeneous || alwaysShowWorkspace) ? (
          <CloudRepoSwitcher agentId={agentId} />
        ) : null;
      }

      // Plain chat (plan none) has no execution environment: nothing to pick,
      // nothing to bind, no service call.
      if (!isDeviceTarget || (!alwaysShowWorkspace && effective.context.plan.kind === 'none')) {
        return null;
      }

      if (editableDraft) {
        return (
          <WorkspacePicker
            bind={bind}
            effective={effective}
            onClear={() => {
              useProjectWorkspaceStore.getState().setDraftWorkspaceIntent(effective.draftKey, {
                legacyWorkingDirectory: undefined,
                workspaceId: undefined,
              });
            }}
          />
        );
      }

      if (effective.state === 'bound' || effective.state === 'scratch') {
        return (
          <>
            <WorkspaceChip effective={effective} repoType={repoType} />
            {cwd && repoType && (
              <GitStatus
                deviceId={isLocalDevice ? undefined : effective.targetDeviceId}
                isGithub={repoType === 'github'}
                path={cwd}
              />
            )}
          </>
        );
      }

      // Projects are selected through the sidebar. Recent drafts stay directory-free;
      // local tools allocate a scratch directory only when they actually need one.
      return null;
    };

    const targetReadOnly =
      !effective.isDraft ||
      !!effective.topicId ||
      (!editableDraft && effective.state === 'bound' && effective.workspace?.kind === 'device');

    return (
      <>
        <HeteroDeviceSwitcher
          agentId={agentId}
          boundDeviceId={effective.targetDeviceId ?? effective.recommendation.deviceId}
          executionTarget={displayTarget}
          readOnly={targetReadOnly}
          onSelectTarget={handleSelectTarget}
        />
        {effective.projectUnavailable ? (
          <span>{t('workspaceRuntime.otherDeviceProject')}</span>
        ) : (
          renderWorkspace()
        )}
      </>
    );
  },
);

WorkspaceControls.displayName = 'WorkspaceControls';

export default WorkspaceControls;
