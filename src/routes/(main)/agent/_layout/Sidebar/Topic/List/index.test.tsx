/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GroupTopicList from '@/routes/(main)/group/_layout/Sidebar/Topic/List';
import { useElectronStore } from '@/store/electron';

import TopicList from './index';

const pushMock = vi.hoisted(() => vi.fn());
const closeAllTopicsDrawerMock = vi.hoisted(() => vi.fn());
const permissionMock = vi.hoisted(() => ({
  create_content: true,
}));

const environment = vi.hoisted(() => ({ desktop: true }));
vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return environment.desktop;
  },
}));
vi.mock('@/store/electron', async () => {
  const { createWithEqualityFn } = await import('zustand/traditional');
  return { useElectronStore: createWithEqualityFn(() => ({ gatewayDeviceInfo: undefined })) };
});
vi.mock('@/hooks/useDeviceTopics', () => ({
  useDeviceTopics: (selector: (state: { topicLength: number }) => unknown) =>
    selector({ topicLength: 0 }),
}));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: any) => selector({ activeGroupId: 'group-1' }),
}));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector({}) }));
vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: { topicGroupMode: () => 'flat' },
}));
vi.mock('@/routes/(main)/group/_layout/Sidebar/Topic/AllTopicsDrawer', () => ({
  default: () => null,
}));
vi.mock('@/routes/(main)/group/_layout/Sidebar/Topic/TopicListContent/ByTimeMode', () => ({
  default: () => null,
}));
vi.mock('@/routes/(main)/group/_layout/Sidebar/Topic/TopicListContent/FlatMode', () => ({
  default: () => null,
}));

vi.mock('@/features/NavPanel/components/EmptyNavItem', () => ({
  default: ({
    disabled,
    onClick,
    title,
  }: {
    disabled?: boolean;
    onClick: () => void;
    title: string;
  }) => (
    <button disabled={disabled} type="button" onClick={disabled ? undefined : onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => <div data-testid="skeleton-list" />,
}));

vi.mock('@/hooks/useFetchChatTopics', () => ({
  useFetchChatTopics: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content') => ({
    allowed: permissionMock[action],
    reason: permissionMock[action] ? '' : 'requires member',
  }),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (state: {
      activeAgentId: string;
      allTopicsDrawerOpen: boolean;
      closeAllTopicsDrawer: () => void;
      isUndefinedTopics: boolean;
      topicLength: number;
    }) => unknown,
  ) =>
    selector({
      activeAgentId: 'agent-1',
      allTopicsDrawerOpen: false,
      closeAllTopicsDrawer: closeAllTopicsDrawerMock,
      isUndefinedTopics: false,
      topicLength: 0,
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentTopicLength: (state: { topicLength: number }) => state.topicLength,
    isUndefinedTopics: (state: { isUndefinedTopics: boolean }) => state.isUndefinedTopics,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../AllTopicsDrawer', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-open={String(open)} data-testid="all-topics-drawer" />
  ),
}));

vi.mock('../hooks/useAgentTopicGroupMode', () => ({
  useAgentTopicGroupMode: () => ({ topicGroupMode: 'flat' }),
}));

vi.mock('../TopicListContent/ByProjectMode', () => ({
  default: () => <div data-testid="workspace-mode" />,
}));

vi.mock('../TopicListContent/ByTimeMode', () => ({
  default: () => <div data-testid="by-time-mode" />,
}));

vi.mock('../TopicListContent/FlatMode', () => ({
  default: () => <div data-testid="flat-mode" />,
}));

vi.mock('@/features/AgentTopicSidebar', () => ({
  WorkspaceMode: () => <div data-testid="workspace-mode" />,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe('Agent topic list', () => {
  beforeEach(() => {
    pushMock.mockReset();
    closeAllTopicsDrawerMock.mockReset();
    permissionMock.create_content = true;
    environment.desktop = true;
    useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'local' } as any });
  });

  it('opens the agent chat route from the empty start topic entry', () => {
    render(<TopicList />);

    expect(screen.getByTestId('workspace-mode')).toBeInTheDocument();
    expect(screen.queryByTestId('flat-mode')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopic' }));

    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1');
  });

  it('disables the empty start topic entry for workspace viewers', () => {
    permissionMock.create_content = false;

    render(<TopicList />);

    const startButton = screen.getByRole('button', { name: 'actions.addNewTopic' });
    expect(startButton).toBeDisabled();

    fireEvent.click(startButton);

    expect(pushMock).not.toHaveBeenCalled();
  });
});

// No chat-store change or forced rerender: Electron subscription alone must resolve the loading state.
describe.each([
  ['Agent', TopicList],
  ['Group', GroupTopicList],
] as const)('%s identity loading', (_name, List) => {
  it('shows skeleton until device identity arrives, then shows the real empty state', () => {
    environment.desktop = true;
    useElectronStore.setState({ gatewayDeviceInfo: undefined });
    render(<List />);
    expect(screen.getByTestId('skeleton-list')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'actions.addNewTopic' })).not.toBeInTheDocument();
    act(() => useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'local' } as any }));
    expect(screen.queryByTestId('skeleton-list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actions.addNewTopic' })).toBeInTheDocument();
  });
  it('does not wait for a local device on Web', () => {
    environment.desktop = false;
    useElectronStore.setState({ gatewayDeviceInfo: undefined });
    render(<List />);
    expect(screen.queryByTestId('skeleton-list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actions.addNewTopic' })).toBeInTheDocument();
  });
});
