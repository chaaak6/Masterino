import type { SpawnOptions } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

interface DevProcessHandle {
  directPid?: number;
  groupPid?: number;
  isWindows: boolean;
}

interface DevStartupTestingExports {
  __testing: {
    createPackageScriptProcessConfig: (params: { isWindows: boolean; scriptName: string }) => {
      args: string[];
      command: string;
      options: SpawnOptions;
    };
    createNextDevProcessConfig: (params: { host: string; isWindows: boolean; port: number }) => {
      args: string[];
      command: string;
      options: SpawnOptions;
    };
    createDevProcessHandle: (params: { isWindows: boolean; pid?: number }) => DevProcessHandle;
    isViteHmrUpgrade: (request: { headers: Record<string, string>; url?: string }) => boolean;
    sendSignalToDevProcess: (handle: DevProcessHandle | undefined, signal: NodeJS.Signals) => void;
    shouldProxyToVite: (url: string | undefined) => boolean;
  };
}

const loadTestingExports = async () => {
  const modulePath = '../../scripts/devStartupSequence' + '.mts';
  return (await import(modulePath)) as unknown as DevStartupTestingExports;
};

describe('devProcessCleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should save the detached process group pid on Unix', async () => {
    const { createDevProcessHandle } = (await loadTestingExports()).__testing;

    expect(createDevProcessHandle({ isWindows: false, pid: 1234 })).toEqual({
      directPid: 1234,
      groupPid: 1234,
      isWindows: false,
    });
  });

  it('should run package scripts through bun instead of npm', async () => {
    const { createPackageScriptProcessConfig } = (await loadTestingExports()).__testing;

    expect(
      createPackageScriptProcessConfig({ isWindows: false, scriptName: 'dev:spa' }),
    ).toMatchObject({
      args: ['run', 'dev:spa'],
      command: 'bun',
      options: {
        detached: true,
        shell: false,
        stdio: 'inherit',
      },
    });
  });

  it('should allow container dev scripts to run through pnpm', async () => {
    vi.stubEnv('DEV_PACKAGE_MANAGER', 'pnpm');
    const { createPackageScriptProcessConfig } = (await loadTestingExports()).__testing;

    expect(
      createPackageScriptProcessConfig({ isWindows: false, scriptName: 'dev:spa:container' }),
    ).toMatchObject({
      args: ['run', 'dev:spa:container'],
      command: 'pnpm',
    });
  });

  it('should bind Next dev to the configured host', async () => {
    vi.stubEnv('DEV_PACKAGE_MANAGER', 'pnpm');
    const { createNextDevProcessConfig } = (await loadTestingExports()).__testing;

    expect(
      createNextDevProcessConfig({ host: '0.0.0.0', isWindows: false, port: 3210 }),
    ).toMatchObject({
      args: ['exec', 'next', 'dev', '-H', '0.0.0.0', '-p', '3210'],
      command: 'pnpm',
    });
  });

  it('should pass the internal Next port to the Next child process env', async () => {
    vi.stubEnv('DEV_PACKAGE_MANAGER', 'pnpm');
    const { createNextDevProcessConfig } = (await loadTestingExports()).__testing;

    const config = createNextDevProcessConfig({ host: '0.0.0.0', isWindows: false, port: 3211 });

    expect(config.options.env).toMatchObject({ PORT: '3211' });
  });

  it('should identify Vite dev asset paths for the hot reverse proxy', async () => {
    const { shouldProxyToVite } = (await loadTestingExports()).__testing;

    expect(shouldProxyToVite('/@vite/client')).toBe(true);
    expect(shouldProxyToVite('/@react-refresh')).toBe(true);
    expect(shouldProxyToVite('/src/spa/entry.web.tsx')).toBe(true);
    expect(shouldProxyToVite('/node_modules/vite/dist/client/env.mjs')).toBe(true);
    expect(shouldProxyToVite('/packages/const/src/version.ts')).toBe(true);
    expect(shouldProxyToVite('/package.json?import')).toBe(true);
    expect(shouldProxyToVite('/trpc/lambda/foo')).toBe(false);
  });

  it('should identify Vite HMR websocket upgrades for the hot reverse proxy', async () => {
    const { isViteHmrUpgrade } = (await loadTestingExports()).__testing;

    expect(isViteHmrUpgrade({ headers: { 'sec-websocket-protocol': 'vite-hmr' }, url: '/' })).toBe(
      true,
    );
    expect(isViteHmrUpgrade({ headers: {}, url: '/?token=abc' })).toBe(true);
    expect(isViteHmrUpgrade({ headers: {}, url: '/_next/webpack-hmr' })).toBe(false);
  });

  it('should signal the saved process group without requiring the direct child to be alive', async () => {
    const { sendSignalToDevProcess } = (await loadTestingExports()).__testing;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    sendSignalToDevProcess(
      {
        directPid: 1234,
        groupPid: 1234,
        isWindows: false,
      },
      'SIGTERM',
    );

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
  });

  it('should fall back to the direct child pid when the process group is already gone', async () => {
    const { sendSignalToDevProcess } = (await loadTestingExports()).__testing;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid < 0) throw new Error('missing process group');
      return true;
    });

    sendSignalToDevProcess(
      {
        directPid: 1234,
        groupPid: 1234,
        isWindows: false,
      },
      'SIGKILL',
    );

    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenNthCalledWith(1, -1234, 'SIGKILL');
    expect(kill).toHaveBeenNthCalledWith(2, 1234, 'SIGKILL');
  });

  it('should signal only the direct child pid on Windows', async () => {
    const { createDevProcessHandle, sendSignalToDevProcess } = (await loadTestingExports())
      .__testing;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    sendSignalToDevProcess(createDevProcessHandle({ isWindows: true, pid: 1234 }), 'SIGTERM');

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM');
  });
});
