import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DesktopFileMenuBridge from './index';

const fixtures = vi.hoisted(() => ({
  agentState: {
    activeAgentId: undefined as string | undefined,
    builtinAgentIdMap: {} as Record<string, string>,
  },
  chatState: {
    activeAgentId: undefined as string | undefined,
    switchTopic: vi.fn(),
  },
  handlers: new Map<string, () => void>(),
  navigate: vi.fn(),
}));

vi.mock('@lobechat/const', () => ({
  SESSION_CHAT_URL: (agentId: string) => `/agent/${agentId}`,
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: () => void) => {
    fixtures.handlers.set(event, handler);
  },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => fixtures.navigate,
}));

vi.mock('@/routes/(main)/home/_layout/hooks/useCreateMenuItems', () => ({
  useCreateMenuItems: () => ({
    createAgent: vi.fn(),
    createEmptyGroup: vi.fn(),
    createPage: vi.fn(),
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: Object.assign(
    (selector: (state: typeof fixtures.agentState) => unknown) => selector(fixtures.agentState),
    { getState: () => fixtures.agentState },
  ),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: (state: typeof fixtures.agentState) => state.builtinAgentIdMap.inbox,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof fixtures.chatState) => unknown) => selector(fixtures.chatState),
    { getState: () => fixtures.chatState },
  ),
}));

const createNewTopic = () => {
  act(() => {
    fixtures.handlers.get('createNewTopic')?.();
  });
};

describe('DesktopFileMenuBridge new topic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.handlers.clear();
    fixtures.agentState.activeAgentId = undefined;
    fixtures.agentState.builtinAgentIdMap = {};
    fixtures.chatState.activeAgentId = undefined;
  });

  it('uses the active conversation when the menu event arrives after hydration', () => {
    render(<DesktopFileMenuBridge />);
    fixtures.agentState.activeAgentId = 'agent-current';
    fixtures.chatState.activeAgentId = 'agent-current';

    createNewTopic();

    expect(fixtures.chatState.switchTopic).toHaveBeenCalledWith(null, {
      resetFileSelection: true,
    });
    expect(fixtures.navigate).not.toHaveBeenCalled();
  });

  it('opens home while the inbox is unavailable instead of producing an invalid agent URL', () => {
    render(<DesktopFileMenuBridge />);

    createNewTopic();

    expect(fixtures.navigate).toHaveBeenCalledWith('/');
    expect(fixtures.chatState.switchTopic).not.toHaveBeenCalled();
  });

  it('uses the inbox available at event time when outside a conversation', () => {
    render(<DesktopFileMenuBridge />);
    fixtures.agentState.builtinAgentIdMap.inbox = 'agent-inbox';

    createNewTopic();

    expect(fixtures.navigate).toHaveBeenCalledWith('/agent/agent-inbox');
    expect(fixtures.chatState.switchTopic).not.toHaveBeenCalled();
  });
});
