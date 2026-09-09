import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConstVersion from '@/const/version';

import { buildDraftConversationKey } from './draftKey';
import {
  checkDesktopProjectSend,
  ProjectDeviceMismatchError,
  resolvePendingTopicExecutionIntent,
} from './topicExecutionIntent';

const mocks = vi.hoisted(() => ({
  agentConfig: undefined as any,
  getDeviceInfo: vi.fn(),
  getTopicState: vi.fn(),
  isDesktop: true,
  workspaceState: {
    draftByConversationKey: {},
    topicStatesById: {},
    workspacesById: {},
  } as any,
}));

vi.mock('@/const/version', async (importOriginal) => {
  const actual = await importOriginal<typeof ConstVersion>();
  return {
    ...actual,
    get isDesktop() {
      return mocks.isDesktop;
    },
  };
});

vi.mock('@/services/projectWorkspace', () => ({
  projectWorkspaceService: { getTopicState: mocks.getTopicState },
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: mocks.getDeviceInfo },
}));

vi.mock('@/store/agent', () => ({ getAgentStoreState: () => ({}) }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { getAgentConfigById: () => () => mocks.agentConfig },
}));
vi.mock('./store', () => ({
  getProjectWorkspaceStoreState: () => mocks.workspaceState,
}));

describe('resolvePendingTopicExecutionIntent', () => {
  beforeEach(() => {
    mocks.agentConfig = undefined;
    mocks.getDeviceInfo.mockReset();
    mocks.getTopicState.mockReset();
    mocks.isDesktop = true;
    mocks.workspaceState = {
      draftByConversationKey: {},
      topicStatesById: {},
      workspacesById: {},
    };
  });

  afterEach(() => vi.clearAllMocks());

  it('checks old links before sending and keeps lookup errors distinct from ownership errors', async () => {
    mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'mac' });
    mocks.getTopicState.mockResolvedValue({ unresolvedProject: true });
    await expect(
      checkDesktopProjectSend({ topicId: 'old-link', isNewTopic: false }),
    ).rejects.toBeInstanceOf(ProjectDeviceMismatchError);
    expect(mocks.workspaceState.topicStatesById).toEqual({});
    const networkError = new Error('connection lost');
    mocks.getTopicState.mockRejectedValue(networkError);
    await expect(checkDesktopProjectSend({ topicId: 'old-link', isNewTopic: false })).rejects.toBe(
      networkError,
    );
  });

  it('freezes desktop chat-only topics as local instead of rewriting target to none', async () => {
    mocks.agentConfig = { chatConfig: { toolMode: 'chat' } };
    mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'desktop-device' });

    await expect(
      resolvePendingTopicExecutionIntent({ agentId: 'agent-1', isNewTopic: true }),
    ).resolves.toEqual({
      draftKey: buildDraftConversationKey({ agentId: 'agent-1' }),
      intent: {
        platform: 'desktop',
        target: 'local',
        targetDeviceId: 'desktop-device',
      },
    });
  });

  it('defaults every new desktop topic to local unless the user explicitly selects sandbox', async () => {
    mocks.agentConfig = {
      agencyConfig: { executionTargetByPlatform: { desktop: 'sandbox' } },
    };
    mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'desktop-device' });

    await expect(
      resolvePendingTopicExecutionIntent({ agentId: 'agent-1', isNewTopic: true }),
    ).resolves.toEqual({
      draftKey: buildDraftConversationKey({ agentId: 'agent-1' }),
      intent: {
        platform: 'desktop',
        target: 'local',
        targetDeviceId: 'desktop-device',
      },
    });
  });

  it('uses web none as the native new-topic default and never probes desktop IPC', async () => {
    mocks.isDesktop = false;

    const result = await resolvePendingTopicExecutionIntent({
      agentId: 'agent-1',
      isNewTopic: true,
    });

    expect(result?.intent).toEqual({ platform: 'web', target: 'none' });
    expect(mocks.getDeviceInfo).not.toHaveBeenCalled();
  });

  it('lets an explicit draft workspace and target override the agent platform default', async () => {
    const draftKey = buildDraftConversationKey({ agentId: 'agent-1', groupId: 'group-1' });
    mocks.agentConfig = {
      agencyConfig: { executionTargetByPlatform: { desktop: 'sandbox' } },
    };
    mocks.workspaceState.draftByConversationKey[draftKey] = {
      target: 'device',
      targetDeviceId: 'draft-device',
      updatedAt: 1,
      workspaceId: 'workspace-1',
    };
    mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'draft-device' });
    mocks.workspaceState.workspacesById['workspace-1'] = {
      deviceId: 'draft-device',
      id: 'workspace-1',
      kind: 'device',
      rootPath: '/repo',
    };

    const result = await resolvePendingTopicExecutionIntent({
      agentId: 'agent-1',
      groupId: 'group-1',
      isNewTopic: true,
    });

    expect(result?.intent).toEqual({
      platform: 'desktop',
      target: 'device',
      targetDeviceId: 'draft-device',
      workspaceId: 'workspace-1',
    });
  });

  it('gives an existing server snapshot priority over changed agent defaults', async () => {
    mocks.agentConfig = {
      agencyConfig: { executionTargetByPlatform: { desktop: 'sandbox' } },
    };

    const result = await resolvePendingTopicExecutionIntent({
      agentId: 'agent-1',
      isNewTopic: false,
      topicId: 'topic-1',
      topicSnapshot: {
        boundDeviceId: 'frozen-device',
        target: 'local',
        targetCapturedAt: '2026-09-04T00:00:00.000Z',
        version: 1,
      },
    });

    expect(result).toEqual({
      intent: {
        platform: 'desktop',
        target: 'local',
        targetDeviceId: 'frozen-device',
      },
    });
    expect(mocks.getDeviceInfo).not.toHaveBeenCalled();
  });
});

describe('foreign project direct-link guard', () => {
  it.each([true, false])('only rejects a foreign project on desktop=%s', async (desktop) => {
    mocks.isDesktop = desktop;
    mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'mac-a' });
    const call = resolvePendingTopicExecutionIntent({
      agentId: 'agent-1',
      isNewTopic: false,
      topicId: 'foreign',
      topicSnapshot: {
        version: 1,
        target: 'local',
        targetCapturedAt: '',
        workspaceId: 'ws',
        workspaceKind: 'device',
        boundDeviceId: 'mac-b',
      },
    });
    if (desktop) await expect(call).rejects.toThrow('another device');
    else await expect(call).resolves.toMatchObject({ intent: { targetDeviceId: 'mac-b' } });
  });
});

describe('legacy path project ownership', () => {
  it.each([undefined, 'mac-b'])('rejects path-only project with owner %s', async (owner) => {
    mocks.isDesktop = true;
    mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'mac-a' });
    await expect(
      resolvePendingTopicExecutionIntent({
        isNewTopic: false,
        topicId: 'legacy',
        topicMetadata: { workingDirectory: '/same/path', boundDeviceId: owner },
      }),
    ).rejects.toThrow('another device');
  });
  it('keeps a proven local legacy project usable and retains its device identity', async () => {
    mocks.isDesktop = true;
    mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'mac-a' });
    await expect(
      resolvePendingTopicExecutionIntent({
        isNewTopic: false,
        topicId: 'legacy',
        topicMetadata: { workingDirectory: '/same/path', boundDeviceId: 'mac-a' },
      }),
    ).resolves.toMatchObject({ intent: { targetDeviceId: 'mac-a' } });
  });
});

it('blocks a direct URL when only the server knows the unresolved legacy project', async () => {
  mocks.isDesktop = true;
  mocks.getDeviceInfo.mockResolvedValue({ deviceId: 'mac-a' });
  mocks.workspaceState = {
    draftByConversationKey: {},
    workspacesById: {},
    topicStatesById: { hidden: { unresolvedProject: true } },
  };
  await expect(
    resolvePendingTopicExecutionIntent({ isNewTopic: false, topicId: 'hidden' }),
  ).rejects.toThrow('another device');
});

it('still allows a new non-project desktop topic to target another gateway device', async () => {
  mocks.isDesktop = true;
  mocks.agentConfig = undefined;
  mocks.workspaceState = {
    draftByConversationKey: {
      [buildDraftConversationKey({ agentId: 'agent-1' })]: {
        target: 'device',
        targetDeviceId: 'other-device',
      },
    },
    workspacesById: {},
    topicStatesById: {},
  };
  await expect(
    resolvePendingTopicExecutionIntent({ agentId: 'agent-1', isNewTopic: true }),
  ).resolves.toMatchObject({ intent: { target: 'device', targetDeviceId: 'other-device' } });
});
