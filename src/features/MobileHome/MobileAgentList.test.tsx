import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const homeState = vi.hoisted(() => ({
  agentGroups: [] as any[],
  isAgentListInit: true,
  pinnedAgents: [] as any[],
  ungroupedAgents: [] as any[],
}));

vi.mock('@/hooks/useFetchAgentList', () => ({
  useFetchAgentList: vi.fn(),
}));

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) =>
    selector({
      agentMap: {
        'inbox-agent': {
          avatar: '🦁',
          title: 'MasterLion',
        },
      },
      builtinAgentIdMap: {
        inbox: 'inbox-agent',
      },
    }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (id: string) => (state: any) => state.agentMap[id] || {},
  },
  builtinAgentSelectors: {
    inboxAgentId: (state: any) => state.builtinAgentIdMap.inbox,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: () => 20,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'inbox.title' ? '小宗狮AI' : key),
  }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: any) => selector(homeState),
}));

vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    agentGroups: (state: typeof homeState) => state.agentGroups,
    isAgentListInit: (state: typeof homeState) => state.isAgentListInit,
    pinnedAgents: (state: typeof homeState) => state.pinnedAgents,
    ungroupedAgentsLimited: () => (state: typeof homeState) => state.ungroupedAgents,
  },
}));

vi.mock('./MobileAgentListItem', () => ({
  default: ({ item }: any) => <div data-testid={`mobile-${item.type}`}>{item.title}</div>,
}));

import MobileAgentList from './MobileAgentList';

describe('MobileAgentList', () => {
  it('keeps the built-in inbox assistant visible when the custom agent list is empty', () => {
    homeState.agentGroups = [];
    homeState.isAgentListInit = true;
    homeState.pinnedAgents = [];
    homeState.ungroupedAgents = [];

    render(<MobileAgentList />);

    expect(screen.getByText('小宗狮AI')).toBeInTheDocument();
  });

  it('keeps the built-in inbox assistant visible while the agent list is loading', () => {
    homeState.agentGroups = [];
    homeState.isAgentListInit = false;
    homeState.pinnedAgents = [];
    homeState.ungroupedAgents = [];

    render(<MobileAgentList />);

    expect(screen.getByText('小宗狮AI')).toBeInTheDocument();
  });

  it('renders agent and group rows with mobile list markup', () => {
    homeState.isAgentListInit = true;
    homeState.agentGroups = [
      {
        id: 'folder-1',
        items: [{ id: 'group-1', title: '群组会话', type: 'group' }],
        name: '工作群组',
      },
    ];
    homeState.ungroupedAgents = [{ id: 'agent-1', title: '移动助手', type: 'agent' }];

    render(<MobileAgentList />);

    expect(screen.getByTestId('mobile-agent-list')).toBeInTheDocument();
    expect(screen.getByText('工作群组')).toBeInTheDocument();
    expect(screen.getByText('群组会话')).toBeInTheDocument();
    expect(screen.getByText('移动助手')).toBeInTheDocument();
  });
});
