import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type {
  ExecutionContext,
  ExecutionPlanUnroutedReason,
} from '@lobechat/types/src/executionContext';
import type {
  ExecutionTargetByPlatform,
  TopicExecutionSnapshot,
  WorkspaceKind,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';
import { useCallback, useMemo } from 'react';

import {
  type ExecutionAgencyConfig,
  resolveFrozenClientExecutionContext,
} from '@/helpers/executionContext';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { normalizeNewTopicIntent } from '@/helpers/workspacePlatform';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import {
  buildDraftConversationKey,
  isTopicVisibleOnDevice,
  projectWorkspaceSelectors,
  readTopicExecutionSnapshot,
  useProjectWorkspaceStore,
} from '@/store/projectWorkspace';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useLegacyWorkspaceMigration } from './useLegacyWorkspaceMigration';

export type EffectiveWorkspaceState = 'bound' | 'scratch' | 'unbound' | 'unrouted';

/** Picker recommendations. They are never a cwd and never bind anything. */
export interface WorkspaceRecommendation {
  /** `agencyConfig.workingDirByDevice[deviceId]` or the agent default workspace root. */
  agentDefault?: string;
  /** `devices.defaultCwd` of the target device. */
  deviceDefault?: string;
  deviceId?: string;
}

export interface EffectiveWorkspace {
  /** Full accepted execution context for advanced consumers. */
  context: ExecutionContext;
  /** Resolved primary cwd. `undefined` for unbound/unrouted; never a home/Desktop/process fallback. */
  cwd?: string;
  /** Key of the draft intent record for this conversation container. */
  draftKey: string;
  /** Only header-created drafts allow replacing an inherited project. */
  draftRuntimeEditable?: boolean;
  isDraft: boolean;
  loadError?: unknown;
  /** Initial evidence is still loading; consumers must not present this as an empty/unavailable state. */
  loading?: boolean;
  projectUnavailable?: boolean;
  recommendation: WorkspaceRecommendation;
  /** Retry all evidence requests used by this projection. */
  reload?: () => Promise<void>;
  state: EffectiveWorkspaceState;
  target: DeviceExecutionTarget;
  targetDeviceId?: string;
  topicId?: string;
  unroutedReason?: ExecutionPlanUnroutedReason;
  workspace?: WorkspaceRef;
}

export interface UseEffectiveWorkspaceOptions {
  /** Explicit topic scope. Defaults to the active topic; pass `null` to resolve the draft. */
  topicId?: string | null;
}

interface TransitionalTopicMetadata {
  boundDeviceId?: string;
  workingDirectory?: string;
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
}

/**
 * The single renderer-side cwd view. It feeds server-authored evidence
 * (topic snapshot, persisted workspaces, topic grants) plus the draft intent
 * into the accepted `resolveExecutionContext` and returns the derived state.
 *
 * Draft intent and device defaults are surfaced as `recommendation` only;
 * the resolved `cwd` comes exclusively from the contract.
 */
export const useEffectiveWorkspace = (
  agentId?: string,
  options: UseEffectiveWorkspaceOptions = {},
): EffectiveWorkspace => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const canFetch = isLogin || isDesktop;

  // Self-populate the stores this view depends on (SWR dedupes by key).
  const devicesRequest = useDeviceStore((s) => s.useFetchDevices)(canFetch);
  const gatewayRequest = useElectronStore((s) => s.useFetchGatewayDeviceInfo)(isDesktop);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const workspacesRequest = useProjectWorkspaceStore((s) => s.useFetchWorkspaces)(
    canFetch && isDesktop && !!currentDeviceId,
    { deviceId: currentDeviceId },
  );

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const activeGroupId = useChatStore((s) => s.activeGroupId);
  const topicId = options.topicId === undefined ? activeTopicId : options.topicId;
  const resolvedTopicId = topicId ?? undefined;

  const topicRequest = useProjectWorkspaceStore((s) => s.useFetchTopicState)(resolvedTopicId);

  const topic = useChatStore((s) =>
    resolvedTopicId ? topicSelectors.getTopicById(resolvedTopicId)(s) : undefined,
  );
  const agencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  ) as ExecutionAgencyConfig | undefined;
  const chatConfig = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentConfigById(agentId)(s)?.chatConfig : undefined,
  );

  const devices = useDeviceStore((s) => s.devices);
  const isDevicesInit = useDeviceStore((s) => s.isDevicesInit);
  const legacyLocalWorkingDirectory = useLegacyWorkspaceMigration(
    agentId,
    agencyConfig,
    currentDeviceId,
  );

  const draftKey = buildDraftConversationKey({ agentId, groupId: activeGroupId });
  const rawDraft = useProjectWorkspaceStore(projectWorkspaceSelectors.getDraftIntent(draftKey));
  const draft = useMemo(
    () => (rawDraft ? normalizeNewTopicIntent(rawDraft, isDesktop) : undefined),
    [rawDraft],
  );
  const topicState = useProjectWorkspaceStore(
    projectWorkspaceSelectors.getTopicState(resolvedTopicId),
  );
  const workspacesById = useProjectWorkspaceStore((s) => s.workspacesById);
  const grantsByTopicDevice = useProjectWorkspaceStore((s) => s.grantsByTopicDevice);
  const seamAvailable = useProjectWorkspaceStore((s) => s.seamAvailable);
  const reload = useCallback(async () => {
    const requests = [devicesRequest, gatewayRequest, workspacesRequest, topicRequest];
    await Promise.allSettled(requests.map((request) => request?.mutate?.()));
  }, [devicesRequest, gatewayRequest, topicRequest, workspacesRequest]);
  const loading = Boolean(
    devicesRequest?.isLoading ||
    gatewayRequest?.isLoading ||
    workspacesRequest?.isLoading ||
    topicRequest?.isLoading,
  );
  const loadError =
    devicesRequest?.error ??
    gatewayRequest?.error ??
    workspacesRequest?.error ??
    topicRequest?.error;

  return useMemo<EffectiveWorkspace>(() => {
    const isDraft = !resolvedTopicId;
    const isHetero = !!agencyConfig?.heterogeneousProvider;
    const metadata = topic?.metadata as TransitionalTopicMetadata | undefined;

    const snapshot: TopicExecutionSnapshot | undefined = topic
      ? readTopicExecutionSnapshot(topic, topicState)
      : topicState?.snapshot;

    const legacyTopic = topic
      ? {
          boundDeviceId: metadata?.boundDeviceId,
          workingDirectory: metadata?.workingDirectory,
          workspaceId: metadata?.workspaceId,
        }
      : undefined;

    // A draft target switch only changes this draft's platform slot; it never
    // writes the agent's stored defaults.
    const platformKey: keyof ExecutionTargetByPlatform = isDesktop ? 'desktop' : 'web';
    const configuredDraftTarget =
      draft?.target ??
      (isDesktop
        ? 'local'
        : resolveExecutionTarget(agencyConfig, {
            isDesktop: false,
            executionTargetByPlatform: agencyConfig?.executionTargetByPlatform,
          }));
    const newTopicTarget =
      !isDesktop && configuredDraftTarget === 'local' ? 'none' : configuredDraftTarget;
    const executionTargetByPlatform: ExecutionTargetByPlatform | undefined =
      isDraft && newTopicTarget
        ? { ...agencyConfig?.executionTargetByPlatform, [platformKey]: newTopicTarget }
        : agencyConfig?.executionTargetByPlatform;

    const target = resolveExecutionTarget(agencyConfig, {
      executionTargetByPlatform,
      isDesktop,
      isHetero,
      topicSnapshot: snapshot,
    });

    let requestedDeviceId: string | undefined;
    if (isDraft && draft?.target === 'device' && draft.targetDeviceId) {
      requestedDeviceId = draft.targetDeviceId;
    } else if (target === 'local' && isDesktop && !snapshot?.boundDeviceId) {
      // Local means this machine. Without a gateway id the local target is
      // reported as unavailable rather than guessed.
      requestedDeviceId = currentDeviceId;
    }

    // The desktop app is by definition running on its own device, so it counts
    // as online even before the gateway list reflects it.
    const onlineDeviceIds = isDevicesInit
      ? [
          ...devices.filter((device) => device.online).map((device) => device.deviceId),
          ...(isDesktop && currentDeviceId ? [currentDeviceId] : []),
        ]
      : undefined;

    const workspaces: Record<string, WorkspaceRef | undefined> = { ...workspacesById };
    if (topicState?.workspace?.id && !workspaces[topicState.workspace.id]) {
      workspaces[topicState.workspace.id] = topicState.workspace;
    }

    const initialTopicMetadata =
      isDraft && (draft?.workspaceId || (!seamAvailable && draft?.legacyWorkingDirectory))
        ? {
            ...(!seamAvailable && draft?.legacyWorkingDirectory
              ? { workingDirectory: draft.legacyWorkingDirectory }
              : {}),
            ...(draft?.workspaceId ? { workspaceId: draft.workspaceId } : {}),
          }
        : undefined;

    const baseInput = {
      agencyConfig,
      canUseDevice: true,
      chatConfig,
      executionTargetByPlatform,
      initialTopicMetadata,
      isDesktop,
      isHetero,
      onlineDeviceIds,
      requestedDeviceId,
      snapshot,
      topic: legacyTopic,
      workspaces,
    };

    let context = resolveFrozenClientExecutionContext({
      ...baseInput,
      topicGrants: Object.values(grantsByTopicDevice).flat(),
      topicId: resolvedTopicId,
    });

    const projectUnavailable =
      isDesktop &&
      !isTopicVisibleOnDevice(
        {
          id: resolvedTopicId ?? '',
          metadata: {
            ...topic?.metadata,
            ...(snapshot ? { executionSnapshot: snapshot } : {}),
            ...(draft?.workspaceId ? { workspaceId: draft.workspaceId } : {}),
            ...(draft?.legacyWorkingDirectory
              ? { workingDirectory: draft.legacyWorkingDirectory }
              : {}),
            ...(draft?.targetDeviceId ? { boundDeviceId: draft.targetDeviceId } : {}),
          },
        },
        {
          currentDeviceId: currentDeviceId ?? null,
          topicStatesById: resolvedTopicId && topicState ? { [resolvedTopicId]: topicState } : {},
          workspacesById,
        },
      );
    if (projectUnavailable)
      context = {
        ...context,
        cwd: undefined,
        workspace: undefined,
        accessRoots: [],
        env: undefined,
        envFiles: undefined,
        plan: { kind: 'device-unrouted', target: 'device', reason: 'no-bound-device' },
        unresolvedReason: 'device-unrouted',
      };

    const plan = context.plan;
    let state: EffectiveWorkspaceState;
    if (plan.kind === 'device-unrouted') state = 'unrouted';
    else if (context.workspace) state = context.workspace.kind === 'scratch' ? 'scratch' : 'bound';
    else state = 'unbound';

    const targetDeviceId =
      plan.kind === 'device'
        ? plan.deviceId
        : (snapshot?.boundDeviceId ?? legacyTopic?.boundDeviceId);
    const recommendationDeviceId =
      targetDeviceId ??
      requestedDeviceId ??
      snapshot?.boundDeviceId ??
      (isDesktop ? currentDeviceId : agencyConfig?.boundDeviceId);
    const agentDefaultWorkspaceId = recommendationDeviceId
      ? agencyConfig?.defaultWorkspaceByDevice?.[recommendationDeviceId]
      : undefined;
    const recommendation: WorkspaceRecommendation = {
      agentDefault: recommendationDeviceId
        ? ((agentDefaultWorkspaceId
            ? workspacesById[agentDefaultWorkspaceId]?.rootPath
            : undefined) ??
          agencyConfig?.workingDirByDevice?.[recommendationDeviceId] ??
          legacyLocalWorkingDirectory)
        : undefined,
      deviceDefault: recommendationDeviceId
        ? (devices.find((device) => device.deviceId === recommendationDeviceId)?.defaultCwd ??
          undefined)
        : undefined,
      deviceId: recommendationDeviceId,
    };

    return {
      context,
      cwd: context.cwd,
      draftKey,
      draftRuntimeEditable: isDraft && draft?.runtimeEditable === true,
      isDraft,
      loadError,
      loading,
      recommendation: projectUnavailable ? {} : recommendation,
      projectUnavailable,
      reload,
      state,
      target: plan.target,
      targetDeviceId,
      topicId: resolvedTopicId,
      unroutedReason: plan.kind === 'device-unrouted' ? plan.reason : undefined,
      workspace: context.workspace,
    };
  }, [
    agencyConfig,
    chatConfig,
    currentDeviceId,
    devices,
    draft,
    draftKey,
    grantsByTopicDevice,
    isDevicesInit,
    legacyLocalWorkingDirectory,
    loadError,
    loading,
    reload,
    resolvedTopicId,
    seamAvailable,
    topic,
    topicState,
    workspacesById,
  ]);
};
