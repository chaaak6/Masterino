import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkingSidebar from './index';

const workspace = vi.hoisted(() => ({
  cwd: undefined as string | undefined,
  target: 'none',
  targetDeviceId: undefined as string | undefined,
}));
const runtime = vi.hoisted(() => ({ local: false }));

vi.mock('@/hooks/useEffectiveWorkspace', () => ({
  useEffectiveWorkspace: () => workspace,
}));
vi.mock('@/const/version', () => ({
  get isDesktop() {
    return runtime.local;
  },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (select: (state: unknown) => unknown) => select({ activeAgentId: 'agent' }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgencyConfigById: () => () => undefined },
  agentSelectors: { isCurrentAgentHeterogeneous: () => false },
  chatConfigByIdSelectors: { isLocalSystemEnabledById: () => () => runtime.local },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (select: (state: unknown) => unknown) => select({}),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (select: (state: unknown) => unknown) =>
    select({ setWorkingSidebarTab: vi.fn(), status: { workingSidebarTab: 'files' } }),
}));
vi.mock('@/features/ChatInput/ControlBar/useRepoType', () => ({
  useRepoType: () => undefined,
}));
vi.mock('@/features/RightPanel', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./Files', () => ({
  default: ({ deviceId, workingDirectory }: { deviceId?: string; workingDirectory: string }) => (
    <output>{`${deviceId ?? 'local'}: ${workingDirectory}`}</output>
  ),
}));
vi.mock('./ProgressSection', () => ({ default: () => null }));
vi.mock('./ResourcesSection', () => ({ default: () => null }));
vi.mock('./Review', () => ({ default: () => null }));

describe('Agent workspace file panel', () => {
  beforeEach(() => {
    Object.assign(workspace, { cwd: undefined, target: 'none', targetDeviceId: undefined });
    runtime.local = false;
  });

  it('opens files on the device associated with the active topic instead of the agent default', () => {
    Object.assign(workspace, {
      cwd: '/workspace/docs',
      target: 'device',
      targetDeviceId: 'device-b',
    });
    render(<WorkingSidebar />);
    expect(screen.getByRole('button', { name: 'workingPanel.files.title' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('device-b: /workspace/docs');
  });

  it('keeps desktop local files on the local adapter', () => {
    runtime.local = true;
    Object.assign(workspace, {
      cwd: '/workspace/docs',
      target: 'local',
      targetDeviceId: 'local-id',
    });
    render(<WorkingSidebar />);
    expect(screen.getByRole('status')).toHaveTextContent('local: /workspace/docs');
  });

  it('does not display a file panel for an unrouted workspace', () => {
    Object.assign(workspace, { target: 'device', targetDeviceId: 'device-b' });
    render(<WorkingSidebar />);
    expect(screen.queryByRole('button', { name: 'workingPanel.files.title' })).not.toBeInTheDocument();
  });
});
