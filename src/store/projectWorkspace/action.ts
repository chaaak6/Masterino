import type { WorkspaceAccessGrant } from '@lobechat/types/src/executionContext';
import type { WorkspaceKind, WorkspaceRef } from '@lobechat/types/src/projectWorkspace';
import type { SWRResponse } from 'swr';

import { decideWorkspaceBind } from '@/helpers/executionContext';
import { mutate, useClientDataSWR } from '@/libs/swr';
import {
  type BindTopicWorkspaceInput,
  type BindTopicWorkspaceResult,
  type CaptureTopicTargetInput,
  type GetOrCreateDeviceWorkspaceInput,
  type GrantTopicAccessInput,
  isProjectWorkspaceSeamUnavailableError,
  isWorkspaceAlreadyBoundError,
  type ProjectWorkspaceItem,
  type ProjectWorkspaceService,
  projectWorkspaceService,
  type TopicGrantRefInput,
  type TopicWorkspaceState,
  type UpdateProjectWorkspaceInput,
} from '@/services/projectWorkspace';
import { type StoreSetter } from '@/store/types';

import { buildTopicDeviceKey } from './draftKey';
import type {
  PathConsentDecision,
  ProjectWorkspaceErrorCode,
  ProjectWorkspaceOutcome,
  WorkspaceDraftIntent,
} from './initialState';
import { type ProjectWorkspaceStore } from './store';

type Setter = StoreSetter<ProjectWorkspaceStore>;

const SWR_LIST_KEY = 'projectWorkspace:list';
const SWR_TOPIC_STATE_KEY = 'projectWorkspace:topicState';
const SWR_GRANTS_KEY = 'projectWorkspace:grants';

export const projectWorkspaceSwrKeys = {
  grants: (topicId: string, deviceId: string) => [SWR_GRANTS_KEY, topicId, deviceId] as const,
  list: (deviceId?: string) => [SWR_LIST_KEY, deviceId ?? ''] as const,
  topicState: (topicId: string) => [SWR_TOPIC_STATE_KEY, topicId] as const,
};

export const toWorkspaceRef = (item: ProjectWorkspaceItem): WorkspaceRef => ({
  deviceId: item.deviceId,
  displayName: item.displayName,
  id: item.id,
  kind: item.kind,
  rootPath: item.rootPath,
});

const toErrorOutcome = (error: unknown): ProjectWorkspaceOutcome<never> => {
  let code: ProjectWorkspaceErrorCode = 'UNKNOWN';
  if (isWorkspaceAlreadyBoundError(error)) code = 'WORKSPACE_ALREADY_BOUND';
  else if (isProjectWorkspaceSeamUnavailableError(error)) code = 'SEAM_UNAVAILABLE';
  const message = error instanceof Error ? error.message : undefined;
  return { code, message, ok: false };
};

export const projectWorkspaceSlice =
  (service: ProjectWorkspaceService = projectWorkspaceService) =>
  (set: Setter, get: () => ProjectWorkspaceStore, _api?: unknown) =>
    new ProjectWorkspaceActionImpl(set, get, service, _api);

export class ProjectWorkspaceActionImpl {
  readonly #get: () => ProjectWorkspaceStore;
  readonly #service: ProjectWorkspaceService;
  readonly #set: Setter;
  readonly #topicGrantLoads = new Map<string, Promise<WorkspaceAccessGrant[]>>();
  readonly #topicGrantMutationVersions = new Map<string, number>();

  constructor(
    set: Setter,
    get: () => ProjectWorkspaceStore,
    service: ProjectWorkspaceService,
    _api?: unknown,
  ) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#service = service;
  }

  // ─── Workspace rows ───

  upsertWorkspaces = (items: ProjectWorkspaceItem[]): void => {
    if (items.length === 0) return;
    const workspacesById = { ...this.#get().workspacesById };
    const workspaceIdsByDevice = { ...this.#get().workspaceIdsByDevice };

    for (const item of items) {
      workspacesById[item.id] = item;
      if (!item.deviceId) continue;
      const ids = workspaceIdsByDevice[item.deviceId] ?? [];
      if (!ids.includes(item.id)) workspaceIdsByDevice[item.deviceId] = [...ids, item.id];
    }

    this.#set({ workspaceIdsByDevice, workspacesById }, false, 'upsertWorkspaces');
  };

  useFetchWorkspaces = (
    enabled: boolean,
    filter: { deviceId?: string; kind?: WorkspaceKind } = {},
  ): SWRResponse<ProjectWorkspaceItem[]> =>
    useClientDataSWR<ProjectWorkspaceItem[]>(
      enabled && this.#get().seamAvailable ? projectWorkspaceSwrKeys.list(filter.deviceId) : null,
      async () => {
        try {
          return await this.#service.list(filter);
        } catch (error) {
          if (!isProjectWorkspaceSeamUnavailableError(error)) throw error;
          this.#set({ seamAvailable: false }, false, 'disableUnavailableSeam');
          return [];
        }
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          this.upsertWorkspaces(data);
          this.#set({ isWorkspacesInit: true }, false, 'fetchWorkspaces');
        },
      },
    );

  refreshWorkspaces = async (deviceId?: string): Promise<void> => {
    await mutate(projectWorkspaceSwrKeys.list(deviceId));
  };

  /**
   * Formal device workspace get-or-create. This is the only way a directory
   * becomes a workspace row; it never touches topic state or agent defaults.
   */
  getOrCreateDeviceWorkspace = async (
    input: GetOrCreateDeviceWorkspaceInput,
  ): Promise<ProjectWorkspaceOutcome<ProjectWorkspaceItem>> => {
    try {
      const item = await this.#service.getOrCreateDeviceWorkspace(input);
      this.upsertWorkspaces([item]);
      return { ok: true, value: item };
    } catch (error) {
      const outcome = toErrorOutcome(error);
      this.#recordError(outcome);
      return outcome;
    }
  };

  /** Persist workspace display/runtime settings and immediately refresh the local projection. */
  updateWorkspace = async (
    id: string,
    value: UpdateProjectWorkspaceInput,
  ): Promise<ProjectWorkspaceOutcome<ProjectWorkspaceItem>> => {
    try {
      const item = await this.#service.updateWorkspace(id, value);
      this.upsertWorkspaces([item]);
      return { ok: true, value: item };
    } catch (error) {
      const outcome = toErrorOutcome(error);
      this.#recordError(outcome);
      return outcome;
    }
  };

  // ─── Topic state ───

  setTopicState = (topicId: string, state: TopicWorkspaceState | undefined): void => {
    const topicStatesById = { ...this.#get().topicStatesById };
    if (state) topicStatesById[topicId] = state;
    else delete topicStatesById[topicId];
    this.#set({ topicStatesById }, false, 'setTopicState');
  };

  useFetchTopicState = (topicId?: string | null): SWRResponse<TopicWorkspaceState | undefined> =>
    useClientDataSWR<TopicWorkspaceState | undefined>(
      topicId && this.#get().seamAvailable ? projectWorkspaceSwrKeys.topicState(topicId) : null,
      async () => {
        try {
          const state = await this.#service.getTopicState(topicId!);
          return state ?? undefined;
        } catch (error) {
          if (!isProjectWorkspaceSeamUnavailableError(error)) throw error;
          this.#set({ seamAvailable: false }, false, 'disableUnavailableSeam');
          return undefined;
        }
      },
      {
        onSuccess: (state) => {
          this.setTopicState(topicId!, state ?? undefined);
          if (state?.workspace?.id) {
            const existing = this.#get().workspacesById[state.workspace.id];
            if (!existing) {
              this.upsertWorkspaces([
                {
                  deviceId: state.workspace.deviceId,
                  displayName: state.workspace.displayName,
                  id: state.workspace.id,
                  kind: state.workspace.kind,
                  rootPath: state.workspace.rootPath,
                },
              ]);
            }
          }
        },
      },
    );

  refreshTopicState = async (topicId: string): Promise<void> => {
    await mutate(projectWorkspaceSwrKeys.topicState(topicId));
  };

  /**
   * Bind-once. A local `decideWorkspaceBind` pre-check rejects an in-place
   * change (including scratch → project) without a round-trip when the topic
   * state is already known; the server remains the authority otherwise.
   */
  bindTopicWorkspace = async (
    input: BindTopicWorkspaceInput,
  ): Promise<ProjectWorkspaceOutcome<BindTopicWorkspaceResult>> => {
    const current = this.#get().topicStatesById[input.topicId];
    const nextItem = this.#get().workspacesById[input.workspaceId];

    if (current && nextItem) {
      const decision = decideWorkspaceBind(
        {
          snapshot: current.snapshot
            ? {
                workspaceId: current.snapshot.workspaceId,
                workspaceKind: current.snapshot.workspaceKind,
              }
            : undefined,
          workspace: current.workspace,
        },
        toWorkspaceRef(nextItem),
      );
      if (!decision.allowed) {
        const outcome: ProjectWorkspaceOutcome<never> = {
          code: 'WORKSPACE_ALREADY_BOUND',
          ok: false,
        };
        this.#recordError(outcome, input.topicId);
        return outcome;
      }
    }

    try {
      const result = await this.#service.bindTopic(input);
      this.setTopicState(input.topicId, { snapshot: result.snapshot, workspace: result.workspace });
      return { ok: true, value: result };
    } catch (error) {
      const outcome = toErrorOutcome(error);
      this.#recordError(outcome, input.topicId);
      return outcome;
    }
  };

  /** Server-authored target capture for an existing topic. Never writes agent config. */
  captureTopicTarget = async (
    input: CaptureTopicTargetInput,
  ): Promise<ProjectWorkspaceOutcome<TopicWorkspaceState>> => {
    try {
      const snapshot = await this.#service.captureTarget(input);
      const next: TopicWorkspaceState = {
        snapshot,
        workspace: this.#get().topicStatesById[input.topicId]?.workspace,
      };
      this.setTopicState(input.topicId, next);
      return { ok: true, value: next };
    } catch (error) {
      const outcome = toErrorOutcome(error);
      this.#recordError(outcome, input.topicId);
      return outcome;
    }
  };

  // ─── Draft intent (client-only, never a binding) ───

  setDraftWorkspaceIntent = (
    key: string,
    intent: Omit<WorkspaceDraftIntent, 'updatedAt'>,
  ): void => {
    const previous = this.#get().draftByConversationKey[key];
    this.#set(
      {
        draftByConversationKey: {
          ...this.#get().draftByConversationKey,
          [key]: { ...previous, ...intent, updatedAt: Date.now() },
        },
      },
      false,
      'setDraftWorkspaceIntent',
    );
  };

  setDraftTargetIntent = (
    key: string,
    intent: Pick<WorkspaceDraftIntent, 'target' | 'targetDeviceId'>,
  ): void => {
    const previous = this.#get().draftByConversationKey[key];
    const changedDevice =
      previous?.target !== intent.target || previous?.targetDeviceId !== intent.targetDeviceId;
    this.setDraftWorkspaceIntent(key, {
      ...intent,
      ...(previous?.runtimeEditable && changedDevice
        ? { legacyWorkingDirectory: undefined, workspaceId: undefined }
        : {}),
    });
  };

  clearDraftIntent = (key: string): void => {
    if (!(key in this.#get().draftByConversationKey)) return;
    const draftByConversationKey = { ...this.#get().draftByConversationKey };
    delete draftByConversationKey[key];
    this.#set({ draftByConversationKey }, false, 'clearDraftIntent');
  };

  /** Integrate seam: topic creation reads and clears the draft in one step. */
  consumeDraftIntent = (key: string): WorkspaceDraftIntent | undefined => {
    const intent = this.#get().draftByConversationKey[key];
    this.clearDraftIntent(key);
    return intent;
  };

  focusWorkspacePicker = (): void => {
    this.#set(
      { pickerFocusNonce: this.#get().pickerFocusNonce + 1 },
      false,
      'focusWorkspacePicker',
    );
  };

  // ─── Topic grants (consent memory) ───

  setTopicGrants = (topicId: string, deviceId: string, grants: WorkspaceAccessGrant[]): void => {
    this.#set(
      {
        grantsByTopicDevice: {
          ...this.#get().grantsByTopicDevice,
          [buildTopicDeviceKey(topicId, deviceId)]: grants,
        },
      },
      false,
      'setTopicGrants',
    );
  };

  /**
   * Load persisted topic authority once per topic/device and publish it before
   * allowing runtime callers to continue. The explicit store-key presence check
   * distinguishes an authoritative empty response from an unhydrated renderer.
   */
  ensureTopicGrantsLoaded = async (
    topicId: string,
    deviceId: string,
    options: { revalidate?: boolean } = {},
  ): Promise<WorkspaceAccessGrant[]> => {
    const key = buildTopicDeviceKey(topicId, deviceId);
    const existing = this.#topicGrantLoads.get(key);
    if (existing) return existing;

    const current = this.#get().grantsByTopicDevice;
    if (!options.revalidate && Object.prototype.hasOwnProperty.call(current, key)) {
      return current[key];
    }
    if (!this.#get().seamAvailable) return current[key] ?? [];

    const mutationVersion = this.#topicGrantMutationVersions.get(key) ?? 0;
    const request = (async () => {
      try {
        const grants = await this.#service.listGrants({ deviceId, topicId });
        if ((this.#topicGrantMutationVersions.get(key) ?? 0) !== mutationVersion) {
          return this.#get().grantsByTopicDevice[key] ?? [];
        }
        this.setTopicGrants(topicId, deviceId, grants);
        return grants;
      } catch (error) {
        if (!isProjectWorkspaceSeamUnavailableError(error)) throw error;
        this.#set({ seamAvailable: false }, false, 'disableUnavailableSeam');
        return this.#get().grantsByTopicDevice[key] ?? [];
      } finally {
        this.#topicGrantLoads.delete(key);
      }
    })();
    this.#topicGrantLoads.set(key, request);
    return request;
  };

  useFetchTopicGrants = (
    topicId?: string | null,
    deviceId?: string | null,
  ): SWRResponse<WorkspaceAccessGrant[]> =>
    useClientDataSWR<WorkspaceAccessGrant[]>(
      topicId && deviceId && this.#get().seamAvailable
        ? projectWorkspaceSwrKeys.grants(topicId, deviceId)
        : null,
      () => this.ensureTopicGrantsLoaded(topicId!, deviceId!, { revalidate: true }),
      {
        fallbackData: [],
        onSuccess: (grants) => this.setTopicGrants(topicId!, deviceId!, grants),
      },
    );

  /**
   * Persists a topic-scoped grant. The device-side realpath proof and the
   * operation `accessRoots` rebuild happen at integrate wiring; the UI only
   * reports success when the server acknowledged the grant.
   */
  grantTopicAccess = async (
    input: GrantTopicAccessInput,
  ): Promise<ProjectWorkspaceOutcome<WorkspaceAccessGrant>> => {
    try {
      const grant = await this.#service.grant(input);
      const key = buildTopicDeviceKey(input.topicId, input.deviceId);
      this.#topicGrantMutationVersions.set(
        key,
        (this.#topicGrantMutationVersions.get(key) ?? 0) + 1,
      );
      const existing = (this.#get().grantsByTopicDevice[key] ?? []).filter(
        (item) => item.id !== grant.id,
      );
      this.setTopicGrants(input.topicId, input.deviceId, [...existing, grant]);
      return { ok: true, value: grant };
    } catch (error) {
      const outcome = toErrorOutcome(error);
      this.#recordError(outcome, input.topicId);
      return outcome;
    }
  };

  revokeTopicGrant = async (
    input: TopicGrantRefInput,
  ): Promise<ProjectWorkspaceOutcome<WorkspaceAccessGrant>> => {
    try {
      const grant = await this.#service.revoke(input);
      const key = buildTopicDeviceKey(input.topicId, input.deviceId);
      this.#topicGrantMutationVersions.set(
        key,
        (this.#topicGrantMutationVersions.get(key) ?? 0) + 1,
      );
      this.setTopicGrants(
        input.topicId,
        input.deviceId,
        (this.#get().grantsByTopicDevice[key] ?? []).filter((item) => item.id !== input.id),
      );
      return { ok: true, value: grant };
    } catch (error) {
      const outcome = toErrorOutcome(error);
      this.#recordError(outcome, input.topicId);
      return outcome;
    }
  };

  // ─── Operation path consent (client-only, integrate reads it) ───

  setOperationPathConsent = (
    messageId: string,
    decision: Omit<PathConsentDecision, 'at'>,
  ): void => {
    this.#set(
      {
        operationConsentByMessage: {
          ...this.#get().operationConsentByMessage,
          [messageId]: { ...decision, at: Date.now() },
        },
      },
      false,
      'setOperationPathConsent',
    );
  };

  clearOperationPathConsent = (messageId: string): void => {
    if (!(messageId in this.#get().operationConsentByMessage)) return;
    const operationConsentByMessage = { ...this.#get().operationConsentByMessage };
    delete operationConsentByMessage[messageId];
    this.#set({ operationConsentByMessage }, false, 'clearOperationPathConsent');
  };

  clearLastError = (): void => {
    if (!this.#get().lastError) return;
    this.#set({ lastError: undefined }, false, 'clearLastError');
  };

  #recordError(outcome: ProjectWorkspaceOutcome<never>, topicId?: string): void {
    if (outcome.ok) return;
    this.#set(
      {
        lastError: { at: Date.now(), code: outcome.code, message: outcome.message, topicId },
        ...(outcome.code === 'SEAM_UNAVAILABLE' ? { seamAvailable: false } : {}),
      },
      false,
      'recordError',
    );
  }
}

export type ProjectWorkspaceAction = Pick<
  ProjectWorkspaceActionImpl,
  keyof ProjectWorkspaceActionImpl
>;
