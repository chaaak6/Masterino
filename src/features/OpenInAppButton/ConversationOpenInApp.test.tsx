import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import ConversationOpenInApp from './ConversationOpenInApp';

const state = vi.hoisted(() => ({
  chat: { activeAgentId: 'agent', activeTopicId: null as string | null },
  projects: {
    draftByConversationKey: {
      draft: { legacyWorkingDirectory: '/legacy', target: 'local', targetDeviceId: 'device' },
    },
    seamAvailable: true,
    workspacesById: {},
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (select: (value: typeof state.chat) => unknown) => select(state.chat),
}));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { currentTopicWorkingDirectory: () => '/current' },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (select: (value: object) => unknown) =>
    select({ gatewayDeviceInfo: { deviceId: 'device' } }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (select: (value: object) => unknown) => select({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgentWorkingDirectoryById: () => () => undefined },
  chatConfigByIdSelectors: { isLocalSystemEnabledById: () => () => true },
}));
vi.mock('@/store/projectWorkspace', () => ({
  buildDraftConversationKey: () => 'draft',
  useProjectWorkspaceStore: (select: (value: typeof state.projects) => unknown) =>
    select(state.projects),
}));
vi.mock('./index', () => ({
  default: ({
    draftFolderPath,
    workingDirectory,
  }: {
    draftFolderPath?: string;
    workingDirectory: string;
  }) => <span>{draftFolderPath ?? workingDirectory}</span>,
}));

it('uses a legacy path only for a draft on a server without workspace support', () => {
  const { rerender } = render(<ConversationOpenInApp />);
  expect(screen.getByText('/current')).toBeInTheDocument();

  state.projects.seamAvailable = false;
  rerender(<ConversationOpenInApp />);
  expect(screen.getByText('/legacy')).toBeInTheDocument();

  state.chat.activeTopicId = 'topic';
  rerender(<ConversationOpenInApp />);
  expect(screen.getByText('/current')).toBeInTheDocument();
});
