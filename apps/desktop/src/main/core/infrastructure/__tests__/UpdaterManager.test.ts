import { autoUpdater } from 'electron-updater';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as artifactDownloaderModule from '@/modules/updater/artifactDownloader';
import * as installers from '@/modules/updater/installUpdate';
import * as signedManifestModule from '@/modules/updater/signedManifest';
import { netFetch } from '@/utils/net-fetch';

import type { App as AppCore } from '../../App';
import { UpdaterManager } from '../UpdaterManager';

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  progress: vi.fn(),
  cleanup: vi.fn(),
  quit: vi.fn(),
  isWindows: true,
  releaseSingleInstanceLock: vi.fn(),
  shellOpenExternal: vi.fn(),
  shellOpenPath: vi.fn(),
  storeGet: vi.fn(),
  storeSet: vi.fn(),
}));

vi.mock('electron-log', () => ({
  default: { transports: { file: { level: 'info' } } },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: 'stable',
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    forceDevUpdateConfig: false,
    logger: null,
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock('builder-util-runtime', () => ({
  CancellationToken: class {
    cancel = vi.fn();
  },
}));

vi.mock('electron', () => ({
  app: {
    quit: mocks.quit,
    getPath: vi.fn().mockReturnValue('C:/updates'),
    getVersion: vi.fn().mockReturnValue('1.1.3'),
    releaseSingleInstanceLock: mocks.releaseSingleInstanceLock,
  },
  shell: { openExternal: mocks.shellOpenExternal, openPath: mocks.shellOpenPath },
}));

vi.mock('@/const/env', () => ({
  isDev: false,
  get isWindows() {
    return mocks.isWindows;
  },
}));
vi.mock('@/env', () => ({ getDesktopEnv: () => ({ FORCE_DEV_UPDATE_CONFIG: false }) }));
vi.mock('@/modules/updater/configs', () => ({
  BUILD_CHANNEL: 'canary',
  resolveInitialUpdateChannel: (channel?: string) => (channel === 'canary' ? 'canary' : 'stable'),
  UPDATE_CHANNEL: 'canary',
  UPDATE_SERVER_URL: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases',
  updaterConfig: {
    app: { autoCheckUpdate: false, checkUpdateInterval: 3_600_000 },
    enableAppUpdate: true,
  },
}));
vi.mock('@/utils/net-fetch', () => ({ netFetch: vi.fn() }));
vi.mock('@/modules/updater/artifactDownloader', async (importOriginal) => {
  const actual = await importOriginal<typeof artifactDownloaderModule>();
  return {
    ...actual,
    downloadArtifact: vi.fn(),
    verifyArtifact: vi.fn(),
    findCachedArtifact: vi.fn(),
  };
});
vi.mock('@/modules/updater/installUpdate', () => ({
  preflightUpdateInstaller: vi.fn(),
  launchUpdateInstaller: vi.fn(),
}));
vi.mock('@/modules/updater/signedManifest', async (importOriginal) => {
  const actual = await importOriginal<typeof signedManifestModule>();
  return { ...actual, selectUpdateArtifact: vi.fn(), verifySignedManifest: vi.fn() };
});
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const artifact = {
  arch: 'x64' as const,
  path: 'canary/1.1.4/Masterino-1.1.4-setup.exe',
  platform: 'win32' as const,
  sha512: 'signed-sha512',
  size: 100,
};
const manifest = {
  artifacts: [artifact],
  channel: 'canary' as const,
  releaseDate: '2026-08-13T00:00:00.000Z',
  releaseNotes: 'Automatic update',
  version: '1.1.4',
};

describe('UpdaterManager signed OSS flow', () => {
  let manager: UpdaterManager;
  let events: Map<string, (...args: any[]) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cleanup.mockResolvedValue(undefined);
    vi.mocked(artifactDownloaderModule.findCachedArtifact).mockResolvedValue(undefined);
    vi.mocked(installers.preflightUpdateInstaller).mockResolvedValue(undefined);
    vi.mocked(installers.launchUpdateInstaller).mockResolvedValue(undefined);
    events = new Map();
    vi.mocked(autoUpdater.on).mockImplementation((name: string, handler: any) => {
      events.set(name, handler);
      return autoUpdater;
    });
    mocks.storeGet.mockImplementation((key: string) => (key === 'updateChannel' ? 'canary' : true));
    mocks.shellOpenExternal.mockResolvedValue(undefined);
    mocks.shellOpenPath.mockResolvedValue('');
    mocks.isWindows = true;
    vi.mocked(netFetch).mockResolvedValue({
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({}),
      ok: true,
      status: 200,
      // Electron documents Response.url as unreliable; in Electron 41 it is empty.
      url: '',
    } as any);
    vi.mocked(signedManifestModule.verifySignedManifest).mockReturnValue(manifest);
    vi.mocked(signedManifestModule.selectUpdateArtifact).mockReturnValue(artifact);
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
    vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([
      'C:/updates/Masterino-1.1.4-setup.exe',
    ]);
    vi.mocked(artifactDownloaderModule.verifyArtifact).mockResolvedValue(undefined);
    vi.mocked(artifactDownloaderModule.downloadArtifact).mockResolvedValue(
      '/updates/Masterino-1.1.4.dmg',
    );
    const app = {
      browserManager: {
        getMainWindow: () => ({
          broadcast: mocks.broadcast,
          browserWindow: { setProgressBar: mocks.progress },
          webContents: { getURL: () => 'https://masterino.bielcrystal.com/' },
        }),
      },
      isQuiting: false,
      prepareForQuit: mocks.cleanup,
      menuManager: { rebuildAppMenu: vi.fn() },
      storeManager: { get: mocks.storeGet, set: mocks.storeSet },
    } as unknown as AppCore;
    manager = new UpdaterManager(app);
  });

  it('checks the signed OSS manifest when Electron returns an empty response URL', async () => {
    await manager.initialize();
    await manager.checkForUpdates({ manual: true });

    expect(netFetch).toHaveBeenCalledWith(
      'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/canary.json',
      { redirect: 'manual' },
    );
    expect(signedManifestModule.verifySignedManifest).toHaveBeenCalled();

    expect(manager.getUpdaterState()).toMatchObject({
      diagnostic: {
        artifact: {
          arch: artifact.arch,
          path: artifact.path,
          platform: artifact.platform,
          size: artifact.size,
        },
        currentVersion: '1.1.3',
        stage: 'available',
        targetVersion: '1.1.4',
        trigger: 'manual',
      },
      manualDownloadAvailable: true,
      runtime: {
        buildChannel: 'canary',
        currentVersion: '1.1.3',
        updateChannel: 'canary',
      },
    });
    expect(mocks.storeSet).toHaveBeenCalledWith(
      'lastUpdaterDiagnostic',
      expect.objectContaining({ schemaVersion: 1, targetVersion: '1.1.4' }),
    );
  });

  it('opens only a selected artifact from the verified OSS manifest', async () => {
    await manager.initialize();
    await expect(manager.openManualDownload()).resolves.toBe('unavailable');

    await manager.checkForUpdates({ manual: true });

    await expect(manager.openManualDownload()).resolves.toBe('opened');
    expect(mocks.shellOpenExternal).toHaveBeenCalledWith(
      'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/1.1.4/Masterino-1.1.4-setup.exe',
    );
  });

  it('restores the last persisted diagnostic on startup', async () => {
    const persisted = {
      arch: 'arm64',
      channel: 'canary',
      currentVersion: '1.2.2',
      id: 'persisted-check',
      manifestUrl: 'https://example.com/canary.json',
      platform: 'darwin',
      schemaVersion: 1 as const,
      stage: 'error' as const,
      startedAt: '2026-08-19T00:00:00.000Z',
      steps: [],
      trigger: 'automatic' as const,
    };
    mocks.storeGet.mockImplementation((key: string) => {
      if (key === 'lastUpdaterDiagnostic') return persisted;
      if (key === 'updateChannel') return 'canary';
      return true;
    });

    await manager.initialize();

    expect(manager.getUpdaterState().diagnostic).toEqual(persisted);
    expect(manager.getUpdaterState().manualDownloadAvailable).toBe(false);
  });

  it('replaces the persisted diagnostic and redacts credentials and local paths', async () => {
    const persisted = {
      arch: 'arm64',
      channel: 'canary',
      currentVersion: '1.2.2',
      id: 'persisted-check',
      manifestUrl: 'https://example.com/canary.json',
      platform: 'darwin',
      schemaVersion: 1 as const,
      stage: 'error' as const,
      startedAt: '2026-08-19T00:00:00.000Z',
      steps: [],
      trigger: 'automatic' as const,
    };
    mocks.storeGet.mockImplementation((key: string) => {
      if (key === 'lastUpdaterDiagnostic') return persisted;
      if (key === 'updateChannel') return 'canary';
      return true;
    });
    vi.mocked(netFetch).mockRejectedValueOnce(
      new Error(
        'network request failed for https://user:password@example.com/file?token=secret at /Users/alice/update.dmg',
      ),
    );

    await manager.initialize();
    await manager.checkForUpdates({ manual: true });

    const diagnostic = manager.getUpdaterState().diagnostic;
    expect(diagnostic?.id).not.toBe(persisted.id);
    expect(diagnostic?.errorMessage).toBe(
      'network request failed for https://[redacted]@example.com/file?token=[redacted] at [local-path]',
    );
    expect(JSON.stringify(diagnostic)).not.toMatch(/password|secret|Users\/alice/);
  });

  it('records a completed latest-version check', async () => {
    vi.mocked(signedManifestModule.verifySignedManifest).mockReturnValue({
      ...manifest,
      version: '1.1.3',
    });

    await manager.initialize();
    await manager.checkForUpdates({ manual: true });

    expect(manager.getUpdaterState()).toMatchObject({
      diagnostic: {
        finishedAt: expect.any(String),
        stage: 'latest',
        targetVersion: '1.1.3',
      },
      manualDownloadAvailable: false,
      stage: 'latest',
    });
    expect(manager.getUpdaterState().diagnostic?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'check-completed', status: 'success' }),
      ]),
    );
  });

  it('records the exact HTTP status for a network failure', async () => {
    vi.mocked(netFetch).mockResolvedValueOnce({
      headers: new Headers(),
      json: vi.fn(),
      ok: false,
      status: 503,
      url: '',
    } as any);

    await manager.initialize();
    await manager.checkForUpdates({ manual: true });

    expect(manager.getUpdaterState()).toMatchObject({
      diagnostic: {
        errorCode: 'network',
        errorMessage: 'Update check failed with HTTP 503',
        finishedAt: expect.any(String),
        manifestHttpStatus: 503,
        stage: 'error',
      },
      manualDownloadAvailable: false,
      stage: 'error',
    });
  });

  it('keeps the update available when automatic downloads are disabled', async () => {
    mocks.storeGet.mockImplementation((key: string) =>
      key === 'updateChannel' ? 'canary' : false,
    );
    await manager.initialize();
    await manager.checkForUpdates();
    await events.get('update-available')?.({ version: '1.1.4' });
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(manager.getUpdaterState()).toMatchObject({
      autoDownloadEnabled: false,
      stage: 'available',
    });
  });

  it('surfaces manifest verification failures without configuring a download feed', async () => {
    vi.mocked(signedManifestModule.verifySignedManifest).mockImplementation(() => {
      throw new signedManifestModule.SignedManifestError('signature invalid', 'signature');
    });
    await manager.initialize();
    await manager.checkForUpdates({ manual: true });
    expect(manager.getUpdaterState()).toMatchObject({
      diagnostic: { errorCode: 'signature', errorMessage: 'signature invalid' },
      errorCode: 'signature',
      manualDownloadAvailable: false,
      stage: 'error',
    });
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it('reuses a verified cached installer when checking after restart', async () => {
    vi.mocked(artifactDownloaderModule.findCachedArtifact).mockResolvedValue('/cached/installer');
    await manager.initialize();
    await manager.checkForUpdates();
    expect(manager.getUpdaterState().stage).toBe('downloaded');
    expect(artifactDownloaderModule.downloadArtifact).not.toHaveBeenCalled();
  });
  it('downloads explicitly, reports progress, and never installs on quit', async () => {
    await manager.initialize();
    await manager.checkForUpdates();
    expect(artifactDownloaderModule.downloadArtifact).not.toHaveBeenCalled();
    vi.mocked(artifactDownloaderModule.downloadArtifact).mockImplementationOnce(async (options) => {
      options.onProgress?.({ percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 });
      expect(mocks.progress).toHaveBeenCalledWith(0.5);
      options.onVerifying?.();
      expect(manager.getUpdaterState().stage).toBe('verifying');
      return '/cached/installer';
    });
    await manager.downloadUpdate();
    expect(manager.getUpdaterState().stage).toBe('downloaded');
    expect(mocks.progress).toHaveBeenLastCalledWith(-1);
    manager.installLater();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(installers.launchUpdateInstaller).not.toHaveBeenCalled();
  });
  it('waits for managed tasks and starts only one installer', async () => {
    await manager.initialize();
    await manager.checkForUpdates();
    await manager.downloadUpdate();
    let finish!: () => void;
    mocks.cleanup.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const installing = manager.applyDownloadedUpdate();
    await vi.waitFor(() => expect(mocks.cleanup).toHaveBeenCalledOnce());
    await manager.applyDownloadedUpdate();
    expect(installers.launchUpdateInstaller).not.toHaveBeenCalled();
    finish();
    await installing;
    expect(installers.launchUpdateInstaller).toHaveBeenCalledOnce();
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
  it('keeps the App open when cleanup fails', async () => {
    await manager.initialize();
    await manager.checkForUpdates();
    await manager.downloadUpdate();
    mocks.cleanup.mockRejectedValue(new Error('owned process still running'));
    await manager.applyDownloadedUpdate();
    expect(manager.getUpdaterState()).toMatchObject({ stage: 'error', errorCode: 'install' });
    expect(installers.launchUpdateInstaller).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
  });
});
