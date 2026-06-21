/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HeaderTitle from './HeaderTitle';

const toggleMobileTopicMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <span data-testid="topic-toggle-icon" />,
  Flexbox: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: {
    Title: ({ desc, title }: { desc: React.ReactNode; title: React.ReactNode }) => (
      <div>
        <div>{title}</div>
        <div>{desc}</div>
      </div>
    ),
  },
}));

vi.mock('lucide-react', () => ({
  ChevronDown: () => null,
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorFillSecondary: '#f5f5f5',
    colorTextDescription: '#666',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'title' ? '话题' : key === 'untitledGroup' ? '未命名群组' : key),
  }),
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: any) =>
    selector({
      activeGroupId: 'group-1',
      groupMap: {
        'group-1': {
          title: '测试群组',
        },
      },
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) =>
    selector({
      activeGroupId: 'group-1',
      activeTopicId: 'topic-1',
      topicDataMap: {
        'group_group-1': {
          items: [{ id: 'topic-1', title: '话题一' }],
          total: 3,
        },
      },
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) =>
    selector({
      toggleMobileTopic: toggleMobileTopicMock,
    }),
}));

describe('MobileGroupChat HeaderTitle', () => {
  it('shows current group topic and opens the mobile topic panel', () => {
    toggleMobileTopicMock.mockClear();

    render(<HeaderTitle />);

    expect(screen.getByText(/测试群组.*3/)).toBeInTheDocument();
    expect(screen.getByText('话题一')).toBeInTheDocument();

    fireEvent.click(screen.getByText('话题一'));

    expect(toggleMobileTopicMock).toHaveBeenCalled();
  });
});
