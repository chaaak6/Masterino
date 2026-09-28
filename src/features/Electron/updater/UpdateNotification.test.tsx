import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateNotification } from './UpdateNotification';

type Handler = (payload: any) => void;

const mocks = vi.hoisted(() => ({
  applyDownloadedUpdate: vi.fn(),
  copyToClipboard: vi.fn(),
  downloadUpdate: vi.fn(),
  getUpdaterState: vi.fn(),
  handlers: new Map<string, Handler>(),
  checkUpdate: vi.fn(),
  installLater: vi.fn(),
  installNow: vi.fn(),
  openLogsDirectory: vi.fn(),
  openManualDownload: vi.fn(),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: Handler) => {
    mocks.handlers.set(event, handler);
  },
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
  Icon: () => null,
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('antd', () => ({
  Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ container: 'container', releaseNote: 'releaseNote' }),
  cssVar: {
    boxShadow: 'none',
    colorBgElevated: 'transparent',
    colorBorderSecondary: 'transparent',
    colorFillQuaternary: 'transparent',
    colorText: 'inherit',
    colorTextSecondary: 'inherit',
  },
}));

vi.mock('lucide-react', () => ({
  CircleFadingArrowUp: () => null,
  TriangleAlert: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}));

vi.mock('@/services/electron/autoUpdate', () => ({
  autoUpdateService: {
    applyDownloadedUpdate: mocks.applyDownloadedUpdate,
    checkUpdate: mocks.checkUpdate,
    downloadUpdate: mocks.downloadUpdate,
    getUpdaterState: mocks.getUpdaterState,
    installNow: mocks.installNow,
    installLater: mocks.installLater,
    openManualDownload: mocks.openManualDownload,
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openLogsDirectory: mocks.openLogsDirectory },
}));

const emitUpdaterState = (payload: any) => {
  act(() => mocks.handlers.get('updaterStateChanged')?.(payload));
};

describe('UpdateNotification', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.applyDownloadedUpdate.mockReset();
    mocks.checkUpdate.mockReset();
    mocks.copyToClipboard.mockReset().mockResolvedValue(undefined);
    mocks.downloadUpdate.mockReset().mockResolvedValue(undefined);
    mocks.getUpdaterState
      .mockReset()
      .mockResolvedValue({ autoDownloadEnabled: true, stage: 'idle' });
    mocks.installNow.mockReset();
    mocks.installLater.mockReset();
    mocks.openLogsDirectory.mockReset().mockResolvedValue(undefined);
    mocks.openManualDownload.mockReset().mockResolvedValue('opened');
  });

  it('shows release details and starts a main-process download', async () => {
    render(<UpdateNotification />);

    emitUpdaterState({
      autoDownloadEnabled: false,
      installMode: 'open-dmg',
      stage: 'available',
      updateInfo: { releaseNotes: 'Important fixes', version: '1.1.2' },
    });

    expect(screen.getByText(/1\.1\.2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/1\.1\.2/));
    expect(screen.getByText('Important fixes')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('updater.downloadNewVersion')[0]);

    await waitFor(() => {
      expect(mocks.downloadUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mocks.installNow).not.toHaveBeenCalled();
  });

  it('shows unsigned macOS instructions before opening the installer', async () => {
    mocks.getUpdaterState.mockResolvedValueOnce({
      autoDownloadEnabled: true,
      installMode: 'open-dmg',
      stage: 'downloaded',
      updateInfo: { version: '1.1.4' },
    });
    render(<UpdateNotification />);

    fireEvent.click(await screen.findByText('updater.openInstaller'));
    expect(screen.getByText('updater.unsignedMacWarningTitle')).toBeInTheDocument();
    expect(
      screen.getByText('xattr -dr com.apple.quarantine /Applications/Masterino.app'),
    ).toBeInTheDocument();
    expect(mocks.applyDownloadedUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('updater.copyInstallCommand'));
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        'xattr -dr com.apple.quarantine /Applications/Masterino.app',
      ),
    );

    fireEvent.click(screen.getAllByText('updater.openInstaller')[1]);
    await waitFor(() => expect(mocks.applyDownloadedUpdate).toHaveBeenCalledTimes(1));
  });

  it('dismisses only the current prompt', () => {
    render(<UpdateNotification />);
    emitUpdaterState({
      autoDownloadEnabled: false,
      stage: 'available',
      updateInfo: { version: '1.1.2' },
    });

    fireEvent.click(screen.getByText('updater.later'));

    expect(screen.queryByText('updater.newVersionAvailable')).not.toBeInTheDocument();
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
  });

  it('offers install on exit for a verified Windows update', async () => {
    render(<UpdateNotification />);
    emitUpdaterState({
      autoDownloadEnabled: true,
      installMode: 'restart',
      stage: 'downloaded',
      updateInfo: { version: '1.1.4' },
    });

    expect(screen.queryByText('updater.unsignedMacWarningTitle')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('updater.installLater'));
    await waitFor(() => expect(mocks.installLater).toHaveBeenCalledTimes(1));
  });

  it('shows a localized error and retries a failed check', async () => {
    render(<UpdateNotification />);
    emitUpdaterState({ autoDownloadEnabled: true, errorCode: 'signature', stage: 'error' });

    expect(screen.getByText('updater.error.signature')).toBeInTheDocument();
    fireEvent.click(screen.getByText('updater.retry'));
    await waitFor(() => expect(mocks.checkUpdate).toHaveBeenCalledTimes(1));
  });

  it('shows the exact persisted failure and support actions', async () => {
    render(<UpdateNotification />);
    emitUpdaterState({
      autoDownloadEnabled: true,
      diagnostic: {
        arch: 'arm64',
        channel: 'canary',
        currentVersion: '1.2.2',
        errorCode: 'network',
        errorMessage: 'Update check failed with HTTP 503',
        id: 'check-123',
        manifestUrl: 'https://example.com/canary.json',
        platform: 'darwin',
        schemaVersion: 1,
        stage: 'error',
        startedAt: '2026-08-19T00:00:00.000Z',
        steps: [],
        targetVersion: '1.2.3',
        trigger: 'manual',
      },
      errorCode: 'network',
      errorMessage: 'Update check failed with HTTP 503',
      manualDownloadAvailable: true,
      stage: 'error',
    });

    fireEvent.click(screen.getByText('updater.error.network'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'network: Update check failed with HTTP 503',
    );
    fireEvent.click(screen.getByText('updater.diagnostic.openLogs'));
    fireEvent.click(screen.getByText('updater.diagnostic.manualDownload'));

    await waitFor(() => {
      expect(mocks.openLogsDirectory).toHaveBeenCalledTimes(1);
      expect(mocks.openManualDownload).toHaveBeenCalledTimes(1);
    });
  });
});
