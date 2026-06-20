import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { spawn } from 'node:child_process';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

interface DevProcessHandle {
  directPid?: number;
  groupPid?: number;
  isWindows: boolean;
}

const isWindows = process.platform === 'win32';

const DEFAULT_NEXT_HOST = 'localhost';

/**
 * Resolve the Next.js dev port.
 * Priority: -p CLI flag > PORT env var > 3010.
 */
const resolveNextPort = (): number => {
  const pIndex = process.argv.indexOf('-p');
  if (pIndex !== -1 && process.argv[pIndex + 1]) {
    return Number(process.argv[pIndex + 1]);
  }
  if (process.env.PORT) return Number(process.env.PORT);
  return 3010;
};

const NEXT_READY_TIMEOUT_MS = 180_000;
const NEXT_READY_RETRY_MS = 400;
const FORCE_KILL_TIMEOUT_MS = 5_000;

const getPackageScriptCommand = () => process.env.DEV_PACKAGE_MANAGER || 'bun';

let publicPort = 3010;
let nextPort = 3010;
let nextReadyHost = DEFAULT_NEXT_HOST;
let nextRootUrl = `http://${nextReadyHost}:${nextPort}/`;
let nextProcess: ChildProcess | undefined;
let viteProcess: ChildProcess | undefined;
let nextHandle: DevProcessHandle | undefined;
let viteHandle: DevProcessHandle | undefined;
let devReverseProxyServer: http.Server | undefined;
let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
let shuttingDown = false;

const isDevReverseProxyEnabled = () => process.env.DEV_REVERSE_PROXY === '1';

const resolveNextInternalPort = (resolvedPublicPort: number) => {
  if (!isDevReverseProxyEnabled()) return resolvedPublicPort;
  if (process.env.NEXT_INTERNAL_PORT) return Number(process.env.NEXT_INTERNAL_PORT);
  return resolvedPublicPort + 1;
};

const getViteDevInternalOrigin = () =>
  process.env.VITE_DEV_INTERNAL_ORIGIN || 'http://localhost:9876';

const getViteDevInternalUrl = () => new URL(getViteDevInternalOrigin());

const shouldProxyToVite = (url: string | undefined) => {
  if (!url) return false;

  const pathname = new URL(url, 'http://localhost').pathname;

  return (
    pathname === '/package.json' ||
    pathname === '/@react-refresh' ||
    pathname.startsWith('/@vite/') ||
    pathname.startsWith('/@id/') ||
    pathname.startsWith('/@fs/') ||
    pathname.startsWith('/node_modules/') ||
    pathname.startsWith('/packages/') ||
    pathname.startsWith('/src/')
  );
};

const isViteHmrUpgrade = (request: IncomingMessage) => {
  const protocol = request.headers['sec-websocket-protocol'];
  if (
    typeof protocol === 'string' &&
    protocol
      .split(',')
      .map((item) => item.trim())
      .includes('vite-hmr')
  )
    return true;

  return request.url?.startsWith('/?token=') ?? false;
};

const createPackageScriptProcessConfig = ({
  isWindows,
  scriptName,
}: {
  isWindows: boolean;
  scriptName: string;
}): { args: string[]; command: string; options: SpawnOptions } => ({
  args: ['run', scriptName],
  command: getPackageScriptCommand(),
  options: {
    detached: !isWindows,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  },
});

const runPackageScript = (scriptName: string) => {
  const { args, command, options } = createPackageScriptProcessConfig({ isWindows, scriptName });

  return spawn(command, args, options);
};

const createNextDevProcessConfig = ({
  host,
  isWindows,
  port,
}: {
  host: string;
  isWindows: boolean;
  port: number;
}): { args: string[]; command: string; options: SpawnOptions } => {
  const packageManager = getPackageScriptCommand();

  return {
    args:
      packageManager === 'pnpm'
        ? ['exec', 'next', 'dev', '-H', host, '-p', String(port)]
        : ['next', 'dev', '-H', host, '-p', String(port)],
    command: packageManager === 'pnpm' ? 'pnpm' : 'bunx',
    options: {
      detached: !isWindows,
      env: { ...process.env, PORT: String(port) },
      stdio: 'inherit',
      shell: isWindows,
    },
  };
};

const loadEnv = () => {
  const env = process.env.NODE_ENV || 'development';
  const shellEnv = Object.entries(process.env).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === 'string') acc[key] = value;
      return acc;
    },
    {},
  );
  const dotenvEnv: Record<string, string> = {};
  const dotenvResult = dotenv.config({
    override: true,
    path: ['.env', `.env.${env}`, `.env.${env}.local`],
    processEnv: dotenvEnv,
  });

  if (!dotenvResult.parsed) return;

  const expanded = dotenvExpand.expand({
    parsed: dotenvResult.parsed,
    processEnv: { ...dotenvEnv, ...shellEnv },
  });

  Object.assign(process.env, expanded.parsed, shellEnv);
};

const createDevProcessHandle = ({
  isWindows,
  pid,
}: {
  isWindows: boolean;
  pid?: number;
}): DevProcessHandle => ({
  directPid: pid,
  groupPid: isWindows ? undefined : pid,
  isWindows,
});

const sendSignalToDevProcess = (handle: DevProcessHandle | undefined, signal: NodeJS.Signals) => {
  if (!handle) return;

  if (!handle.isWindows && handle.groupPid) {
    try {
      process.kill(-handle.groupPid, signal);
      return;
    } catch {
      // Fall through to the direct child pid below. The wrapper may already be
      // gone while its process group has been reaped.
    }
  }

  if (!handle.directPid) return;

  try {
    process.kill(handle.directPid, signal);
  } catch {
    // The process already exited.
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const proxyHttpRequest = (request: IncomingMessage, response: ServerResponse, target: URL) => {
  const headers = { ...request.headers };

  const proxyRequest = http.request(
    {
      headers,
      hostname: target.hostname,
      method: request.method,
      path: request.url,
      port: target.port,
      protocol: target.protocol,
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on('error', (error) => {
    if (!response.headersSent) response.writeHead(502);
    response.end(`Dev proxy error: ${error.message}`);
  });

  request.pipe(proxyRequest);
};

const proxyUpgradeRequest = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: URL,
) => {
  const targetSocket = net.connect(Number(target.port), target.hostname, () => {
    const rawHeaders = request.rawHeaders
      .map((value, index) => (index % 2 === 0 ? `${value}: ` : `${value}\r\n`))
      .join('');

    targetSocket.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`);
    targetSocket.write(rawHeaders);
    targetSocket.write('\r\n');
    if (head.length > 0) targetSocket.write(head);
    targetSocket.pipe(socket);
    socket.pipe(targetSocket);
  });

  const closeWithError = () => {
    socket.destroy();
    targetSocket.destroy();
  };

  targetSocket.on('error', closeWithError);
  socket.on('error', closeWithError);
};

const startDevReverseProxy = async ({
  host,
  nextPort,
  publicPort,
}: {
  host: string;
  nextPort: number;
  publicPort: number;
}) => {
  if (!isDevReverseProxyEnabled()) return;

  const nextTarget = new URL(`http://localhost:${nextPort}`);
  const viteTarget = getViteDevInternalUrl();

  devReverseProxyServer = http.createServer((request, response) => {
    proxyHttpRequest(request, response, shouldProxyToVite(request.url) ? viteTarget : nextTarget);
  });

  devReverseProxyServer.on('upgrade', (request, socket, head) => {
    proxyUpgradeRequest(request, socket, head, isViteHmrUpgrade(request) ? viteTarget : nextTarget);
  });

  await new Promise<void>((resolve, reject) => {
    devReverseProxyServer?.once('error', reject);
    devReverseProxyServer?.listen(publicPort, host, () => resolve());
  });

  console.log(
    `🔁 Dev reverse proxy listening on http://${host}:${publicPort}/ -> Next ${nextTarget.origin}, Vite ${viteTarget.origin}`,
  );
};

const isPortOpen = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const onDone = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.once('connect', () => onDone(true));
    socket.once('error', () => onDone(false));
    socket.setTimeout(1_000, () => onDone(false));
  });

const waitForNextReady = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < NEXT_READY_TIMEOUT_MS) {
    if (await isPortOpen(nextReadyHost, nextPort)) return;
    await wait(NEXT_READY_RETRY_MS);
  }

  throw new Error(
    `Next server was not ready within ${
      NEXT_READY_TIMEOUT_MS / 1000
    }s on ${nextReadyHost}:${nextPort}`,
  );
};

const prewarmNextRootCompile = async () => {
  const startedAt = Date.now();
  const response = await fetch(nextRootUrl, { signal: AbortSignal.timeout(120_000) });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(
    `✅ Next prewarm request finished (${response.status}) in ${elapsed}s ${nextRootUrl}`,
  );
};

const runNextBackgroundTasks = () => {
  setTimeout(() => {
    console.log(`🔁 Next server URL: ${nextRootUrl}`);
  }, 2_000);

  void (async () => {
    try {
      await waitForNextReady();
      await prewarmNextRootCompile();
    } catch (error) {
      console.warn('⚠️ Next prewarm skipped:', error);
    }
  })();
};

const terminateChildren = () => {
  devReverseProxyServer?.close();
  sendSignalToDevProcess(viteHandle, 'SIGTERM');
  sendSignalToDevProcess(nextHandle, 'SIGTERM');
};

const forceKillChildren = () => {
  sendSignalToDevProcess(viteHandle, 'SIGKILL');
  sendSignalToDevProcess(nextHandle, 'SIGKILL');
};

const clearForceKillTimer = () => {
  if (!forceKillTimer) return;
  clearTimeout(forceKillTimer);
  forceKillTimer = undefined;
};

const hasChildSettled = (child?: ChildProcess) =>
  !child || child.exitCode !== null || child.signalCode !== null;

const clearForceKillTimerWhenChildrenSettle = () => {
  if (!shuttingDown) return;
  if (hasChildSettled(nextProcess) && hasChildSettled(viteProcess)) clearForceKillTimer();
};

const shutdownAll = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    forceKillChildren();
    return;
  }
  shuttingDown = true;

  terminateChildren();

  process.exitCode = signal === 'SIGINT' ? 130 : 143;

  forceKillTimer = setTimeout(() => {
    forceKillTimer = undefined;
    forceKillChildren();
  }, FORCE_KILL_TIMEOUT_MS);
};

const watchChildExit = (child: ChildProcess, name: 'next' | 'vite') => {
  child.once('exit', (code, signal) => {
    if (shuttingDown) {
      clearForceKillTimerWhenChildrenSettle();
      return;
    }

    console.error(
      `❌ ${name} exited unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`,
    );
    shutdownAll('SIGTERM');
  });
};

const main = async () => {
  loadEnv();
  publicPort = resolveNextPort();
  nextPort = resolveNextInternalPort(publicPort);
  const nextBindHost = process.env.NEXT_HOST || DEFAULT_NEXT_HOST;
  nextReadyHost = process.env.NEXT_READY_HOST || DEFAULT_NEXT_HOST;
  nextRootUrl = `http://${nextReadyHost}:${isDevReverseProxyEnabled() ? publicPort : nextPort}/`;

  const forwardedSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of forwardedSignals) {
    process.on(sig, () => shutdownAll(sig));
  }

  process.on('uncaughtException', (error) => {
    console.error('❌ uncaught exception in dev startup:', error);
    shutdownAll('SIGTERM');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandled rejection in dev startup:', reason);
    shutdownAll('SIGTERM');
  });

  process.on('exit', () => {
    forceKillChildren();
  });

  const nextConfig = createNextDevProcessConfig({
    host: nextBindHost,
    isWindows,
    port: nextPort,
  });
  nextProcess = spawn(nextConfig.command, nextConfig.args, nextConfig.options);
  nextHandle = createDevProcessHandle({ isWindows, pid: nextProcess.pid });
  watchChildExit(nextProcess, 'next');

  viteProcess = runPackageScript(process.env.DEV_SPA_SCRIPT || 'dev:spa');
  viteHandle = createDevProcessHandle({ isWindows, pid: viteProcess.pid });
  watchChildExit(viteProcess, 'vite');
  await startDevReverseProxy({ host: nextBindHost, nextPort, publicPort });
  runNextBackgroundTasks();

  await Promise.race([
    new Promise((resolve) => nextProcess?.once('exit', resolve)),
    new Promise((resolve) => viteProcess?.once('exit', resolve)),
  ]);
};

const isMainModule = () => {
  const entry = process.argv[1];
  return !!entry && import.meta.url === pathToFileURL(path.resolve(entry)).href;
};

export const __testing = {
  createPackageScriptProcessConfig,
  createDevProcessHandle,
  createNextDevProcessConfig,
  isViteHmrUpgrade,
  sendSignalToDevProcess,
  shouldProxyToVite,
};

if (isMainModule()) {
  void main().catch((error) => {
    console.error('❌ dev startup sequence failed:', error);
    shutdownAll('SIGTERM');
  });
}
