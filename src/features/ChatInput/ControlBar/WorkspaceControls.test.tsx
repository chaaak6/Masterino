/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';

import WorkspaceControls from './WorkspaceControls';

const mocks = vi.hoisted(() => ({
  deviceSwitcherProps: {} as Record<string, unknown>,
  effective: {} as EffectiveWorkspace,
  seamAvailable: false,
  desktop: true,
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return mocks.desktop;
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useEffectiveWorkspace', () => ({
  useEffectiveWorkspace: () => mocks.effective,
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { isAgentHeterogeneousById: () => () => false },
}));
vi.mock('@/store/device', () => ({
  deviceSelectors: { getDeviceWorkingDirs: () => () => [] },
  useDeviceStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: object) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));
vi.mock('@/store/projectWorkspace', () => ({
  useProjectWorkspaceStore: (selector: (state: object) => unknown) =>
    selector({
      captureTopicTarget: vi.fn(),
      seamAvailable: mocks.seamAvailable,
      setDraftTargetIntent: vi.fn(),
    }),
}));
vi.mock('./CloudRepoSwitcher', () => ({ default: () => <div data-testid="cloud-repo" /> }));
vi.mock('./GitStatus', () => ({ default: () => <div data-testid="git-status" /> }));
vi.mock('./HeteroDeviceSwitcher', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.deviceSwitcherProps = props;
    return <div data-testid="device-switcher" />;
  },
}));
vi.mock('./WorkspaceChip', () => ({ default: () => <div data-testid="workspace-chip" /> }));
vi.mock('./WorkspacePicker', () => ({ default: () => <div data-testid="workspace-picker" /> }));
vi.mock('./useBindWorkspaceOnce', () => ({ useBindWorkspaceOnce: () => ({}) }));
vi.mock('./useRepoType', () => ({ useRepoType: () => undefined }));

describe('WorkspaceControls topic ownership', () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.deviceSwitcherProps = {};
    mocks.seamAvailable = false;
    mocks.effective = {
      context: {
        cwd: '/projects/legacy',
        plan: { deviceId: 'device-1', kind: 'device', target: 'local' },
        version: 1,
        workspace: {
          deviceId: 'device-1',
          kind: 'device',
          rootPath: '/projects/legacy',
        },
      },
      cwd: '/projects/legacy',
      draftKey: 'draft::agent-1',
      isDraft: true,
      recommendation: { deviceId: 'device-1' },
      state: 'bound',
      target: 'local',
      targetDeviceId: 'device-1',
      workspace: { deviceId: 'device-1', kind: 'device', rootPath: '/projects/legacy' },
    };
  });

  it('labels an unavailable project without exposing local directory controls', () => {
    mocks.effective = {
      ...mocks.effective,
      projectUnavailable: true,
      cwd: undefined,
      workspace: undefined,
      state: 'unrouted',
      target: 'device',
      targetDeviceId: 'other-device',
    };
    render(<WorkspaceControls agentId="agent-1" />);
    expect(screen.getByText('workspaceRuntime.otherDeviceProject')).toBeDefined();
    expect(screen.queryByTestId('workspace-chip')).toBeNull();
    expect(mocks.deviceSwitcherProps.executionTarget).toBe('device');
    expect(mocks.deviceSwitcherProps.boundDeviceId).toBe('other-device');
  });

  it('Web projects retain their device identity without directory or Git controls', () => {
    mocks.desktop = false;
    mocks.effective.isDraft = false;
    render(<WorkspaceControls agentId="agent-1" />);
    expect(screen.queryByTestId('workspace-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('git-status')).not.toBeInTheDocument();
    expect(mocks.deviceSwitcherProps.executionTarget).toBe('device');
    expect(mocks.deviceSwitcherProps.readOnly).toBe(true);
  });

  it('keeps a historical workspace readable but immutable on an old server', () => {
    render(<WorkspaceControls agentId="agent-1" />);

    expect(screen.getByTestId('workspace-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-picker')).not.toBeInTheDocument();
  });

  it.each([true, false])('keeps a Recent draft directory-free (workspace API: %s)', (available) => {
    mocks.seamAvailable = available;
    mocks.effective = {
      ...mocks.effective,
      context: {
        ...mocks.effective.context,
        cwd: undefined,
        workspace: undefined,
      },
      cwd: undefined,
      isDraft: true,
      state: 'unbound',
      topicId: undefined,
      workspace: undefined,
    };

    render(<WorkspaceControls agentId="agent-1" />);

    expect(screen.queryByTestId('workspace-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-chip')).not.toBeInTheDocument();
    expect(mocks.deviceSwitcherProps.readOnly).toBe(false);
  });

  it.each(['bound', 'unbound'] as const)(
    'lets header drafts edit target and directory while %s',
    (state) => {
      mocks.effective = { ...mocks.effective, draftRuntimeEditable: true, state };
      render(<WorkspaceControls agentId="agent-1" />);
      expect(screen.getByTestId('workspace-picker')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-chip')).not.toBeInTheDocument();
      expect(mocks.deviceSwitcherProps.readOnly).toBe(false);
    },
  );

  it('locks a header-created project after the first message even if its draft flag remains', () => {
    mocks.effective = {
      ...mocks.effective,
      draftRuntimeEditable: true,
      isDraft: false,
      topicId: 'sent-topic',
    };
    render(<WorkspaceControls agentId="agent-1" />);
    expect(screen.queryByTestId('workspace-picker')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-chip')).toBeInTheDocument();
    expect(mocks.deviceSwitcherProps.readOnly).toBe(true);
  });

  it('locks the target and hides project selection after the first message', () => {
    mocks.seamAvailable = true;
    mocks.effective = {
      ...mocks.effective,
      context: {
        ...mocks.effective.context,
        cwd: undefined,
        workspace: undefined,
      },
      cwd: undefined,
      isDraft: false,
      state: 'unbound',
      topicId: 'topic-recent',
      workspace: undefined,
    };

    render(<WorkspaceControls agentId="agent-1" />);

    expect(screen.queryByTestId('workspace-picker')).not.toBeInTheDocument();
    expect(mocks.deviceSwitcherProps.readOnly).toBe(true);
  });

  it('shows a locked workspace for a draft opened from a workspace group', () => {
    mocks.seamAvailable = true;
    mocks.effective = {
      ...mocks.effective,
      isDraft: true,
      state: 'bound',
      topicId: undefined,
    };

    render(<WorkspaceControls agentId="agent-1" />);

    expect(screen.getByTestId('workspace-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-picker')).not.toBeInTheDocument();
    expect(mocks.deviceSwitcherProps.readOnly).toBe(true);
  });

  it('keeps sandbox selectable only on a new topic page', () => {
    mocks.seamAvailable = true;
    mocks.effective = {
      ...mocks.effective,
      context: {
        ...mocks.effective.context,
        cwd: '/workspace',
        plan: { kind: 'sandbox', target: 'sandbox' },
        workspace: { kind: 'sandbox', rootPath: '/workspace' },
      },
      cwd: '/workspace',
      isDraft: true,
      state: 'bound',
      target: 'sandbox',
      targetDeviceId: undefined,
      topicId: undefined,
      workspace: { kind: 'sandbox', rootPath: '/workspace' },
    };

    render(<WorkspaceControls agentId="agent-1" />);

    expect(mocks.deviceSwitcherProps.readOnly).toBe(false);
    expect(screen.queryByTestId('workspace-picker')).not.toBeInTheDocument();
  });
});
