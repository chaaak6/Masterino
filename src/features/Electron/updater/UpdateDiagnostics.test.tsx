import type { UpdaterState } from '@lobechat/electron-client-ipc';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateDiagnostics } from './UpdateDiagnostics';

const mocks = vi.hoisted(() => ({
  checkUpdate: vi.fn(),
  i18n: { language: 'en-US' },
  copyToClipboard: vi.fn(),
  openLogsDirectory: vi.fn(),
  openManualDownload: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    actions: 'actions',
    details: 'details',
    error: 'error',
    grid: 'grid',
    label: 'label',
    steps: 'steps',
    stepTime: 'stepTime',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: mocks.i18n, t: (key: string) => key }),
}));

vi.mock('@/services/electron/autoUpdate', () => ({
  autoUpdateService: {
    checkUpdate: mocks.checkUpdate,
    openManualDownload: mocks.openManualDownload,
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openLogsDirectory: mocks.openLogsDirectory },
}));

const state: UpdaterState = {
  autoDownloadEnabled: true,
  diagnostic: {
    arch: 'arm64',
    artifact: {
      arch: 'arm64',
      path: 'canary/1.2.3/Masterino-1.2.3-unsigned-arm64.dmg',
      platform: 'darwin',
      size: 123,
    },
    channel: 'canary',
    currentVersion: '1.2.2',
    errorCode: 'network',
    errorMessage: 'Update check failed with HTTP 503',
    failedStep: 'manifest-received',
    id: 'check-123',
    manifestHttpStatus: 503,
    manifestUrl: 'https://example.com/canary.json',
    platform: 'darwin',
    schemaVersion: 1,
    stage: 'error',
    startedAt: '2026-08-19T00:00:00.000Z',
    steps: [
      {
        at: '2026-08-19T00:00:01.000Z',
        detail: 'HTTP 503',
        name: 'manifest-received',
        status: 'error',
      },
    ],
    targetVersion: '1.2.3',
    trigger: 'manual',
  },
  manualDownloadAvailable: true,
  runtime: {
    arch: 'arm64',
    buildChannel: 'canary',
    currentVersion: '1.2.2',
    platform: 'darwin',
    updateChannel: 'canary',
  },
  stage: 'error',
};

describe('UpdateDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.i18n.language = 'en-US';
    mocks.checkUpdate.mockResolvedValue(undefined);
    mocks.copyToClipboard.mockResolvedValue(undefined);
    mocks.openLogsDirectory.mockResolvedValue(undefined);
    mocks.openManualDownload.mockResolvedValue('opened');
  });

  it('shows runtime data, the exact failure and structured steps', () => {
    render(<UpdateDiagnostics state={state} />);

    expect(screen.getByText('1.2.2')).toBeInTheDocument();
    expect(screen.getByText('darwin/arm64')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'network: Update check failed with HTTP 503',
    );
    expect(screen.getAllByText('updater.diagnostic.step.manifestReceived')).toHaveLength(2);
    expect(screen.getByText('updater.diagnostic.failureStage')).toBeInTheDocument();
    expect(screen.getAllByText(/HTTP 503/)).toHaveLength(2);
  });

  it.each(['zh-CN', 'en-US', 'vi-VN'])('formats diagnostic dates in %s', (language) => {
    mocks.i18n.language = language;
    render(<UpdateDiagnostics state={state} />);

    expect(
      screen.getByText(new Date(state.diagnostic!.startedAt).toLocaleString(language)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new Date(state.diagnostic!.steps[0].at).toLocaleTimeString(language)),
    ).toBeInTheDocument();
  });

  it('copies a support-ready diagnostic report and opens support actions', async () => {
    render(<UpdateDiagnostics state={state} />);

    fireEvent.click(screen.getByText('updater.diagnostic.copy'));
    fireEvent.click(screen.getByText('updater.diagnostic.openLogs'));
    fireEvent.click(screen.getByText('updater.diagnostic.manualDownload'));

    await waitFor(() => {
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        expect.stringContaining('Error: network: Update check failed with HTTP 503'),
      );
      expect(mocks.openLogsDirectory).toHaveBeenCalledTimes(1);
      expect(mocks.openManualDownload).toHaveBeenCalledTimes(1);
    });
  });

  it('hides manual download without a currently verified artifact and can recheck', async () => {
    render(
      <UpdateDiagnostics showCheckAction state={{ ...state, manualDownloadAvailable: false }} />,
    );

    expect(screen.queryByText('updater.diagnostic.manualDownload')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('updater.diagnostic.checkNow'));
    await waitFor(() => expect(mocks.checkUpdate).toHaveBeenCalledTimes(1));
  });
});
