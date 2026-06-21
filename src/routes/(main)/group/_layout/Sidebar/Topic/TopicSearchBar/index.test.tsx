/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TopicSearchBar from './index';

const useSearchTopicsMock = vi.hoisted(() => vi.fn());
const chatState = vi.hoisted(() => ({
  activeAgentId: 'agent-1' as string | undefined,
  activeGroupId: 'group-1' as string | undefined,
  useSearchTopics: useSearchTopicsMock,
}));

vi.mock('@lobehub/ui', () => ({
  SearchBar: () => <input aria-label="search-topic" />,
}));

vi.mock('ahooks', () => ({
  useUnmount: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector(chatState),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: any) => selector({ isMobile: true }),
}));

describe('Group TopicSearchBar', () => {
  it('searches topics in the active group scope', () => {
    useSearchTopicsMock.mockClear();
    chatState.activeGroupId = 'group-1';

    render(<TopicSearchBar />);

    expect(useSearchTopicsMock).toHaveBeenCalledWith('', { groupId: 'group-1' });
  });

  it('falls back to agent scope when no active group exists', () => {
    useSearchTopicsMock.mockClear();
    chatState.activeGroupId = undefined;

    render(<TopicSearchBar />);

    expect(useSearchTopicsMock).toHaveBeenCalledWith('', { agentId: 'agent-1' });
  });
});
