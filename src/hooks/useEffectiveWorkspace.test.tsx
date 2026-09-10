/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDraftConversationKey, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import { useEffectiveWorkingDirectory } from './useEffectiveWorkingDirectory';
import { useEffectiveWorkspace } from './useEffectiveWorkspace';

const mocks = vi.hoisted(() => ({
  activeGroupId: undefined as string | undefined,
  activeTopicId: undefined as string | undefined,
  agencyConfig: undefined as Record<string, any> | undefined,
  chatConfig: undefined as Record<string, any> | undefined,
  currentDeviceId: 'desktop-1' as string | undefined,
  devices: [] as Array<{ defaultCwd: string | null; deviceId: string; online: boolean }>,
  isDesktop: true,
  isDevicesInit: true,
  legacyLocalPath: undefined as string | undefined,
  topic: undefined as Record<string, any> | undefined,
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return mocks.isDesktop;
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: any) => unknown) =>
    selector({
      localAgentWorkingDirectoryMap: mocks.legacyLocalPath
        ? { 'agent-1': mocks.legacyLocalPath }
        : {},
    }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgencyConfigById: () => () => mocks.agencyConfig },
  agentSelectors: { getAgentConfigById: () => () => ({ chatConfig: mocks.chatConfig }) },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: any) => unknown) =>
    selector({ activeGroupId: mocks.activeGroupId, activeTopicId: mocks.activeTopicId }),
}));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { getTopicById: () => () => mocks.topic },
}));
vi.mock('@/store/device', () => ({
  useDeviceStore: (selector: (state: any) => unknown) =>
    selector({
      devices: mocks.devices,
      isDevicesInit: mocks.isDevicesInit,
      useFetchDevices: vi.fn(),
    }),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: any) => unknown) =>
    selector({
      gatewayDeviceInfo: mocks.currentDeviceId ? { deviceId: mocks.currentDeviceId } : undefined,
      useFetchGatewayDeviceInfo: vi.fn(),
    }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: any) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: () => false },
}));

const boundSnapshot = (workspaceId: string, workspaceKind: 'device' | 'scratch') => ({
  boundDeviceId: 'desktop-1',
  target: 'local' as const,
  targetCapturedAt: '2026-09-03T00:00:00.000Z',
  version: 1 as const,
  workspaceBoundAt: '2026-09-03T00:00:00.000Z',
  workspaceId,
  workspaceKind,
});

const resetProjectWorkspaceStore = () => {
  useProjectWorkspaceStore.setState({
    draftByConversationKey: {},
    grantsByTopicDevice: {},
    seamAvailable: false,
    topicStatesById: {},
    workspaceIdsByDevice: {},
    workspacesById: {},
  });
};

describe('useEffectiveWorkspace', () => {
  beforeEach(() => {
    mocks.activeGroupId = undefined;
    mocks.activeTopicId = undefined;
    mocks.agencyConfig = undefined;
    mocks.chatConfig = undefined;
    mocks.currentDeviceId = 'desktop-1';
    mocks.devices = [{ defaultCwd: '/Users/me/Desktop', deviceId: 'desktop-1', online: true }];
    mocks.isDesktop = true;
    mocks.isDevicesInit = true;
    mocks.legacyLocalPath = undefined;
    mocks.topic = undefined;
    resetProjectWorkspaceStore();
  });

  it('keeps editability scoped to the header draft and drops it when a topic exists', () => {
    useProjectWorkspaceStore
      .getState()
      .setDraftWorkspaceIntent(buildDraftConversationKey({ agentId: 'agent-1' }), {
        runtimeEditable: true,
        target: 'local',
      });
    const { result, rerender } = renderHook(() => useEffectiveWorkspace('agent-1'));
    expect(result.current.draftRuntimeEditable).toBe(true);
    mocks.activeTopicId = 'topic-sent';
    rerender();
    expect(result.current.draftRuntimeEditable).toBe(false);
  });

  it('does not expose a foreign cwd as local even when the remote workspace is cached', () => {
    mocks.activeTopicId = 'foreign';
    mocks.topic = {
      id: 'foreign',
      metadata: {
        executionSnapshot: { ...boundSnapshot('remote-ws', 'device'), boundDeviceId: 'other-mac' },
      },
    };
    useProjectWorkspaceStore.setState({
      workspacesById: {
        'remote-ws': {
          id: 'remote-ws',
          deviceId: 'other-mac',
          kind: 'device',
          rootPath: '/same/path',
        },
      },
    });
    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));
    expect(result.current).toMatchObject({
      projectUnavailable: true,
      state: 'unrouted',
      target: 'device',
      targetDeviceId: 'other-mac',
    });
    expect(result.current.cwd).toBeUndefined();
    expect(result.current.context.accessRoots).toEqual([]);
  });

  it('does not adopt an unowned historical path on this machine', () => {
    mocks.activeTopicId = 'legacy';
    mocks.topic = { id: 'legacy', metadata: { workingDirectory: '/same/path' } };
    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));
    expect(result.current.projectUnavailable).toBe(true);
    expect(result.current.cwd).toBeUndefined();
  });

  it('returns bound with the persisted workspace root as cwd', () => {
    mocks.activeTopicId = 'topic-1';
    mocks.topic = {
      id: 'topic-1',
      metadata: { executionSnapshot: boundSnapshot('ws-a', 'device') },
    };
    useProjectWorkspaceStore.setState({
      workspacesById: {
        'ws-a': { deviceId: 'desktop-1', id: 'ws-a', kind: 'device', rootPath: '/projects/a/' },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.state).toBe('bound');
    expect(result.current.cwd).toBe('/projects/a');
    expect(result.current.targetDeviceId).toBe('desktop-1');
    expect(result.current.workspace?.id).toBe('ws-a');
    expect(result.current.isDraft).toBe(false);
  });

  it('returns scratch for a topic bound to a scratch workspace', () => {
    mocks.activeTopicId = 'topic-1';
    mocks.topic = { id: 'topic-1' };
    useProjectWorkspaceStore.setState({
      topicStatesById: {
        'topic-1': {
          snapshot: boundSnapshot('ws-scratch', 'scratch'),
          workspace: {
            deviceId: 'desktop-1',
            id: 'ws-scratch',
            kind: 'scratch',
            rootPath: '/tmp/masterino/topic-1',
          },
        },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.state).toBe('scratch');
    expect(result.current.cwd).toBe('/tmp/masterino/topic-1');
  });

  it('reloads persisted topic grants for a scratch topic after renderer state resets', () => {
    mocks.activeTopicId = 'topic-1';
    mocks.topic = { id: 'topic-1' };
    useProjectWorkspaceStore.setState({
      seamAvailable: true,
      topicStatesById: {
        'topic-1': {
          snapshot: boundSnapshot('ws-scratch', 'scratch'),
          workspace: {
            deviceId: 'desktop-1',
            id: 'ws-scratch',
            kind: 'scratch',
            rootPath: '/tmp/masterino/topic-1',
          },
        },
      },
    });
    const fetchTopicGrants = vi.spyOn(
      useProjectWorkspaceStore.getState(),
      'useFetchTopicGrants',
    );

    renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(fetchTopicGrants).toHaveBeenCalledWith('topic-1', 'desktop-1');
  });

  it('keeps an unbound desktop draft at cwd undefined and only recommends defaults', () => {
    mocks.agencyConfig = { workingDirByDevice: { 'desktop-1': '/Users/me/agent-default' } };

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.state).toBe('unbound');
    expect(result.current.cwd).toBeUndefined();
    expect(result.current.isDraft).toBe(true);
    expect(result.current.target).toBe('local');
    expect(result.current.targetDeviceId).toBe('desktop-1');
    expect(result.current.recommendation).toEqual({
      agentDefault: '/Users/me/agent-default',
      deviceDefault: '/Users/me/Desktop',
      deviceId: 'desktop-1',
    });
  });

  it('does not select the agent sandbox default on a new desktop topic page', () => {
    mocks.agencyConfig = { executionTargetByPlatform: { desktop: 'sandbox' } };

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.isDraft).toBe(true);
    expect(result.current.target).toBe('local');
    expect(result.current.state).toBe('unbound');
    expect(result.current.cwd).toBeUndefined();
  });

  it('keeps a legacy localStorage cwd visible as a migration recommendation', () => {
    mocks.legacyLocalPath = '/Users/me/legacy-project';

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.cwd).toBeUndefined();
    expect(result.current.recommendation.agentDefault).toBe('/Users/me/legacy-project');
  });

  it('never falls back to home, Desktop or process.cwd for an unbound native topic', () => {
    mocks.activeTopicId = 'topic-plain';
    mocks.topic = { id: 'topic-plain', metadata: {} };

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.state).toBe('unbound');
    expect(result.current.cwd).toBeUndefined();
    expect(result.current.context.unresolvedReason).toBe('no-workspace');
  });

  it('returns unrouted when the bound device is offline instead of degrading to sandbox', () => {
    mocks.isDesktop = false;
    mocks.currentDeviceId = undefined;
    mocks.devices = [{ defaultCwd: null, deviceId: 'desktop-1', online: false }];
    mocks.activeTopicId = 'topic-1';
    mocks.topic = {
      id: 'topic-1',
      metadata: { executionSnapshot: boundSnapshot('ws-a', 'device') },
    };
    useProjectWorkspaceStore.setState({
      workspacesById: {
        'ws-a': { deviceId: 'desktop-1', id: 'ws-a', kind: 'device', rootPath: '/projects/a' },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.state).toBe('unrouted');
    expect(result.current.unroutedReason).toBe('bound-device-offline');
    expect(result.current.cwd).toBeUndefined();
    expect(result.current.target).toBe('local');
  });

  it('reports the local target as unrouted when the desktop gateway id is unavailable', () => {
    mocks.currentDeviceId = undefined;
    mocks.isDevicesInit = false;

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.state).toBe('unrouted');
    expect(result.current.unroutedReason).toBe('no-bound-device');
  });

  it('resolves an explicit draft workspace intent but ignores recommendations', () => {
    mocks.agencyConfig = { workingDirByDevice: { 'desktop-1': '/Users/me/recommended' } };
    useProjectWorkspaceStore.setState({
      draftByConversationKey: {
        'draft::agent-1': { updatedAt: 1, workspaceId: 'ws-a' },
      },
      workspacesById: {
        'ws-a': { deviceId: 'desktop-1', id: 'ws-a', kind: 'device', rootPath: '/projects/a' },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.state).toBe('bound');
    expect(result.current.cwd).toBe('/projects/a');
    expect(result.current.draftKey).toBe('draft::agent-1');
  });

  it('uses an explicit legacy draft cwd for execution without inventing a formal workspace id', () => {
    useProjectWorkspaceStore.setState({
      draftByConversationKey: {
        'draft::agent-1': {
          legacyWorkingDirectory: '/projects/legacy',
          target: 'local',
          targetDeviceId: 'desktop-1',
          updatedAt: 1,
        },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.cwd).toBe('/projects/legacy');
    expect(result.current.workspace).toMatchObject({
      deviceId: 'desktop-1',
      kind: 'device',
      rootPath: '/projects/legacy',
    });
    expect(result.current.workspace?.id).toBeUndefined();
  });

  it('scopes draft intent by agent and group', () => {
    mocks.activeGroupId = 'group-1';
    useProjectWorkspaceStore.setState({
      draftByConversationKey: {
        'draft::agent-1': { updatedAt: 1, workspaceId: 'ws-a' },
      },
      workspacesById: {
        'ws-a': { deviceId: 'desktop-1', id: 'ws-a', kind: 'device', rootPath: '/projects/a' },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.draftKey).toBe('draft:group-1:agent-1');
    expect(result.current.state).toBe('unbound');
  });

  it('applies a draft target switch without reading agent defaults for the topic', () => {
    useProjectWorkspaceStore.setState({
      draftByConversationKey: {
        'draft::agent-1': { target: 'sandbox', updatedAt: 1 },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.target).toBe('sandbox');
    expect(result.current.cwd).toBe('/workspace');
    expect(result.current.workspace?.kind).toBe('sandbox');
  });

  it('composes topic grants as access roots without changing the primary cwd', () => {
    mocks.activeTopicId = 'topic-1';
    mocks.topic = {
      id: 'topic-1',
      metadata: { executionSnapshot: boundSnapshot('ws-a', 'device') },
    };
    useProjectWorkspaceStore.setState({
      grantsByTopicDevice: {
        'topic-1::desktop-1': [
          {
            createdAt: 'now',
            deviceId: 'desktop-1',
            id: 'wag_1',
            modes: ['read'],
            requestedVia: {},
            rootPath: '/data/reports',
            scope: 'topic',
            topicId: 'topic-1',
            userId: 'u',
          },
        ],
      },
      workspacesById: {
        'ws-a': { deviceId: 'desktop-1', id: 'ws-a', kind: 'device', rootPath: '/projects/a' },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkspace('agent-1'));

    expect(result.current.cwd).toBe('/projects/a');
    expect(result.current.context.accessRoots).toEqual([
      expect.objectContaining({ rootPath: '/projects/a', scope: 'primary' }),
      expect.objectContaining({ grantId: 'wag_1', rootPath: '/data/reports', scope: 'topic' }),
    ]);
  });
});

describe('useEffectiveWorkingDirectory', () => {
  beforeEach(() => {
    mocks.activeTopicId = undefined;
    mocks.topic = undefined;
    mocks.agencyConfig = { workingDirByDevice: { 'desktop-1': '/Users/me/agent-default' } };
    mocks.currentDeviceId = 'desktop-1';
    mocks.isDesktop = true;
    mocks.isDevicesInit = true;
    mocks.devices = [{ defaultCwd: '/Users/me/Desktop', deviceId: 'desktop-1', online: true }];
    resetProjectWorkspaceStore();
  });

  it('is a thin wrapper that returns undefined while unbound', () => {
    const { result } = renderHook(() => useEffectiveWorkingDirectory('agent-1'));
    expect(result.current).toBeUndefined();
  });

  it('returns the bound cwd', () => {
    mocks.activeTopicId = 'topic-1';
    mocks.topic = {
      id: 'topic-1',
      metadata: { executionSnapshot: boundSnapshot('ws-a', 'device') },
    };
    useProjectWorkspaceStore.setState({
      workspacesById: {
        'ws-a': { deviceId: 'desktop-1', id: 'ws-a', kind: 'device', rootPath: '/projects/a' },
      },
    });

    const { result } = renderHook(() => useEffectiveWorkingDirectory('agent-1'));
    expect(result.current).toBe('/projects/a');
  });
});
