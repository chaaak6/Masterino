import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './index';

const workspace = vi.hoisted(() => ({ loading: false, projectUnavailable: false }));

vi.mock('@/hooks/useEffectiveWorkspace', () => ({ useEffectiveWorkspace: () => workspace }));
vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right }: { left: ReactNode; right: ReactNode }) => (
    <>
      {left}
      {right}
    </>
  ),
}));
vi.mock('@/features/OpenInAppButton', () => ({
  default: ({ workingDirectory }: { workingDirectory: string }) => (
    <button type="button">Open {workingDirectory}</button>
  ),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) =>
    selector({ localAgentWorkingDirectoryMap: {} }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgencyConfigById: () => () => undefined },
  chatConfigByIdSelectors: { isLocalSystemEnabledById: () => () => true },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) => selector({ activeAgentId: 'agent' }),
}));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { currentTopicWorkingDirectory: () => '/bound-project' },
}));
vi.mock('@/store/electron', () => ({ useElectronStore: () => 'current-device' }));
vi.mock('./HeaderActions', () => ({
  default: ({ showWorkspaceActions }: { showWorkspaceActions?: boolean }) => (
    <div>{showWorkspaceActions === false ? 'History actions only' : 'Workspace actions'}</div>
  ),
}));
vi.mock('./Tags', () => ({
  default: ({ showWorkspaceActions }: { showWorkspaceActions?: boolean }) => (
    <div>{showWorkspaceActions === false ? 'Topic title only' : 'Open project folder'}</div>
  ),
}));
vi.mock('./ShareButton', () => ({ default: () => null }));
vi.mock('./WorkingPanelToggle', () => ({ default: () => null }));

describe('conversation header workspace actions', () => {
  beforeEach(() => {
    workspace.loading = false;
    workspace.projectUnavailable = false;
  });

  it.each(['projectUnavailable', 'loading'] as const)(
    'keeps folder and app launch actions hidden when %s',
    (blocked) => {
      workspace[blocked] = true;

      render(<Header />);

      expect(screen.queryByRole('button', { name: /Open/ })).not.toBeInTheDocument();
      expect(screen.getByText('History actions only')).toBeInTheDocument();
      expect(screen.getByText('Topic title only')).toBeInTheDocument();
    },
  );

  it('keeps the bound folder and its app launcher on the owning device', () => {
    render(<Header />);

    expect(screen.getByRole('button', { name: 'Open /bound-project' })).toBeInTheDocument();
    expect(screen.getByText('Workspace actions')).toBeInTheDocument();
    expect(screen.getByText('Open project folder')).toBeInTheDocument();
  });
});
