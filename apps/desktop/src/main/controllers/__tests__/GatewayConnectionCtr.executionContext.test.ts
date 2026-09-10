import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  manageLocalAttachment,
  prepareLocalAttachment,
  receiveLocalAttachment,
} from '@lobechat/device-control';
import * as localFileShell from '@lobechat/local-file-shell';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ExecutionEnvService from '../../services/executionEnvSrv';
import GatewayConnectionCtr from '../GatewayConnectionCtr';
import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';
import LocalFileCtr from '../LocalFileCtr';
import RemoteServerConfigCtr from '../RemoteServerConfigCtr';
import ShellCommandCtr from '../ShellCommandCtr';

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/mock/app'), getPath: vi.fn(() => '/mock') },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
}));

vi.mock('electron-is', () => ({ linux: false, macOS: false, windows: false }));

vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://example.test',
  isDev: false,
  isLinux: false,
  isMac: false,
  isWindows: false,
}));

vi.mock('@/services/imessageBridgeSrv', () => ({ default: class ImessageBridgeService {} }));
vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('fast-glob', () => ({ default: vi.fn() }));
vi.mock('fflate', () => ({ unzipSync: vi.fn() }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('GatewayConnectionCtr execution context boundary', () => {
  let tempRoot: string;
  let workspace: string;
  const handleRunCommand = vi.fn(async (_args: { cwd?: string }) => ({
    success: true,
    stdout: 'ok',
  }));
  const readFile = vi.fn(async () => ({ content: 'safe' }));
  const spawnLhHeteroExec = vi.fn();
  const resolveExecutionEnv = vi.fn(async () => ({ MANAGED: 'resolved', SHARED: 'managed' }));

  const localFileCtr = {
    handleEditFile: vi.fn(),
    handleGlobFiles: vi.fn(),
    handleGrepContent: vi.fn(),
    handleLocalFilesSearch: vi.fn(),
    handleMoveFiles: vi.fn(),
    handleRenameFile: vi.fn(),
    handleWriteFile: vi.fn(),
    listLocalFiles: vi.fn(),
    readFile,
    readFiles: vi.fn(),
  } as unknown as LocalFileCtr;

  const shellCommandCtr = {
    handleGetCommandOutput: vi.fn(),
    handleKillCommand: vi.fn(),
    handleRunCommand,
  } as unknown as ShellCommandCtr;

  const makeController = (allowedMountRoots: string[] = []) =>
    new GatewayConnectionCtr({
      appStoragePath: path.join(tempRoot, 'app-storage'),
      getController: (Controller: unknown) => {
        if (Controller === LocalFileCtr) return localFileCtr;
        if (Controller === ShellCommandCtr) return shellCommandCtr;
        if (Controller === RemoteServerConfigCtr) {
          return {
            getAccessToken: vi.fn(async () => 'token'),
            getRemoteServerUrl: vi.fn(async () => 'https://example.test'),
          };
        }
        if (Controller === HeterogeneousAgentCtr) return { spawnLhHeteroExec };
        return {};
      },
      getService: (Service: unknown) =>
        Service === ExecutionEnvService
          ? { resolve: resolveExecutionEnv }
          : { getDeviceId: () => 'device-1' },
      storeManager: {
        get: (key: string, fallback: unknown) =>
          key === 'localFileWorkspaceRoots' ? allowedMountRoots : fallback,
      },
    } as any);

  const context = () => ({
    accessRoots: [
      {
        modes: ['read' as const, 'write' as const, 'exec' as const],
        rootPath: workspace,
        scope: 'primary' as const,
        source: 'workspace' as const,
      },
    ],
    cwd: workspace,
    env: { SHARED: 'server-wins', WORKSPACE_ENV: 'kept' },
    envFiles: ['.env'],
    workspaceRootPath: workspace,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(path.join(tmpdir(), 'desktop-execution-context-'));
    workspace = path.join(tempRoot, 'workspace');
    await mkdir(workspace);
    workspace = await realpath(workspace);
    await writeFile(path.join(workspace, '.env'), 'FILE_ONLY=from-file\nSHARED=from-file\n');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempRoot, { force: true, recursive: true });
  });

  it('rejects foreign-device local IPC before file, shell or env access', async () => {
    const result = await makeController().executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: 'echo must-not-run', cwd: workspace },
      trace: {
        deviceId: 'other-device',
        topicId: 'foreign-topic',
        operationId: 'op',
        toolCallId: 'call',
      },
    });
    expect(result).toMatchObject({
      success: false,
      content: expect.stringContaining('DEVICE_MISMATCH'),
    });
    expect(handleRunCommand).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(resolveExecutionEnv).not.toHaveBeenCalled();
  });

  it('routes exact-trace cancellation into the running Office reader and removes it after completion', async () => {
    const controller = makeController();
    const file = path.join(workspace, 'data.xlsx');
    await writeFile(file, 'fixture');
    const trace = {
      deviceId: 'device-1',
      topicId: 'topic-1',
      operationId: 'operation-1',
      toolCallId: 'office-1',
    };
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const reader = vi
      .spyOn(localFileShell, 'readOfficeDocument')
      .mockImplementation(async (_params, options) => {
        const signal = options!.signal!;
        expect(signal).toBeInstanceOf(AbortSignal);
        started();
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      });
    const request = {
      apiName: 'readOfficeDocument',
      args: { path: file, aggregateColumn: 'A' },
      executionContext: context(),
      trace,
    };
    const execution = controller.executeLocalToolCall(request);
    await ready;
    const duplicate = controller.executeLocalToolCall(request);
    expect(await controller.cancelLocalOfficeRead({ ...trace, topicId: 'another-topic' })).toEqual({
      cancelled: false,
    });
    expect(await controller.cancelLocalOfficeRead(trace)).toEqual({ cancelled: true });
    expect(await execution).toMatchObject({ success: false, content: 'Office read cancelled' });
    expect(await duplicate).toMatchObject({ success: false });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(await controller.cancelLocalOfficeRead(trace)).toEqual({ cancelled: false });
  });

  it('authorizes the first absolute write in prepared topic scratch, without sibling grants', async () => {
    const controller = makeController();
    const scratch = path.join(tempRoot, 'app-storage', 'scratch-workspaces');
    const source = path.join(workspace, 'source.xlsx');
    await writeFile(source, 'fixture');
    const ref = await receiveLocalAttachment(scratch, 'device-1', {
      originalPath: source,
      data: Buffer.from('fixture'),
      name: 'source.xlsx',
      mime: 'application/xlsx',
      draftId: 'draft',
    });
    await prepareLocalAttachment(scratch, 'device-1', ref, 'topic-1');
    const root = await realpath(path.join(scratch, 'topic-1'));
    const trace = {
      deviceId: 'device-1',
      topicId: 'topic-1',
      operationId: 'operation-1',
      toolCallId: 'absolute-write',
    };
    vi.mocked(localFileCtr.handleWriteFile).mockResolvedValue({ success: true } as never);
    const result = await controller.executeLocalToolCall({
      apiName: 'writeFile',
      args: { path: path.join(root, 'sales-report.html'), content: '<html>report</html>' },
      executionContext: { accessRoots: [] },
      trace,
    });
    expect(result).toMatchObject({ success: true, state: { localScratch: { root } } });
    for (const denied of [
      path.join(scratch, 'topic-2', 'report.html'),
      path.join(workspace, 'sibling.html'),
    ]) {
      const output = await controller.executeLocalToolCall({
        apiName: 'writeFile',
        args: { path: denied, content: 'denied' },
        executionContext: {
          accessRoots: [
            {
              target: 'file',
              rootPath: source,
              modes: ['read'],
              scope: 'operation',
              source: 'user-approval',
            },
          ],
        },
        trace: { ...trace, toolCallId: denied },
      });
      expect(output).toMatchObject({ success: false, content: 'SCOPE_DENIED' });
    }
    expect(localFileCtr.handleWriteFile).toHaveBeenCalledTimes(1);
    const nested = await controller.executeLocalToolCall({
      apiName: 'writeFile',
      args: { path: path.join(workspace, 'nested', 'report.html'), content: 'allowed' },
      executionContext: context(),
      trace: { ...trace, toolCallId: 'existing-workspace' },
    });
    expect(nested.success).toBe(true);
    expect(nested.state).not.toHaveProperty('localScratch');
  });

  it('rejects scratch topic aliases and symlink escapes', async () => {
    const controller = makeController();
    const scratch = path.join(tempRoot, 'app-storage', 'scratch-workspaces');
    await mkdir(path.join(scratch, 'topic-b'), { recursive: true });
    await symlink(path.join(scratch, 'topic-b'), path.join(scratch, 'topic-a'));
    await symlink(workspace, path.join(scratch, 'topic-external'));
    for (const topicId of ['topic-a', 'topic-external']) {
      const result = await controller.executeLocalToolCall({
        apiName: 'writeFile',
        args: { path: path.join(scratch, topicId, 'report.html'), content: 'denied' },
        executionContext: { accessRoots: [] },
        trace: { deviceId: 'device-1', topicId, operationId: 'op', toolCallId: topicId },
      });
      expect(result.success).toBe(false);
      await expect(
        (controller as any).executeDeviceRpc('ensureScratchWorkspace', { topicId }),
      ).rejects.toThrow('SCOPE_DENIED');
    }
    expect(localFileCtr.handleWriteFile).not.toHaveBeenCalled();
  });

  it('lazily prepares scratch and exposes evidence only after a successful tool', async () => {
    const controller = makeController();
    const trace = {
      deviceId: 'device-1',
      operationId: 'operation-1',
      toolCallId: 'call-1',
      topicId: 'topic-1',
    };
    const result = await controller.executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: 'pwd' },
      executionContext: { accessRoots: [] },
      trace,
    });
    expect(result.success).toBe(true);
    const cwd = handleRunCommand.mock.calls.at(-1)?.[0]?.cwd;
    expect(cwd).toContain('scratch-workspaces');
    expect(result.state).toMatchObject({ localScratch: { root: cwd } });
    const evidence = await (controller as any).executeDeviceRpc('getLocalScratchExecution', trace);
    expect(evidence).toEqual({ root: cwd });
    expect(
      await (controller as any).executeDeviceRpc('getLocalScratchExecution', {
        ...trace,
        toolCallId: 'unexecuted',
      }),
    ).toBeNull();
    await controller.executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: 'pwd' },
      executionContext: { accessRoots: [] },
      trace,
    });
    expect(handleRunCommand).toHaveBeenCalledTimes(1);
  });

  it('resolves an attachment ID on device, hides its path and rejects a foreign topic', async () => {
    const root = path.join(tempRoot, 'app-storage', 'scratch-workspaces');
    const ref = await receiveLocalAttachment(root, 'device-1', {
      draftId: 'draft-id',
      name: 'private.txt',
      mime: 'text/plain',
      data: Buffer.from('hello'),
    });
    await manageLocalAttachment(root, 'device-1', {
      action: 'bindMessage',
      ref,
      messageId: 'message-id',
      topicId: 'bound-topic',
    });
    const prepared = await prepareLocalAttachment(root, 'device-1', ref, 'bound-topic');
    readFile.mockResolvedValueOnce({ content: prepared.path });
    const controller = makeController();
    const request = {
      apiName: 'readFile',
      args: { attachmentId: ref.attachmentId },
      executionContext: context(),
      trace: {
        deviceId: 'device-1',
        topicId: 'bound-topic',
        operationId: 'op-id',
        toolCallId: 'read-id',
      },
    };
    const result = await controller.executeLocalToolCall(request);
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(prepared.path);
    expect(result.content).toContain(`attachment:${ref.attachmentId}`);
    expect(readFile).toHaveBeenCalledTimes(1);
    handleRunCommand.mockImplementationOnce(async (args) => {
      const env = (args as { env?: Record<string, string> }).env;
      expect(env?.ATTACHMENT_FILE).toBe(prepared.path);
      return {
        success: true,
        stdout: `${prepared.path} ${path.dirname(prepared.path)} ${encodeURI(prepared.path)}`,
      };
    });
    const computed = await controller.executeLocalToolCall({
      ...request,
      apiName: 'runCommand',
      args: { attachmentId: ref.attachmentId, command: 'test-command' },
      trace: { ...request.trace, toolCallId: 'compute' },
    });
    expect(computed.success).toBe(true);
    expect(JSON.stringify(computed)).not.toContain(path.dirname(prepared.path));
    expect(computed.content).toContain(`attachment:${ref.attachmentId}`);
    const denied = await controller.executeLocalToolCall({
      ...request,
      trace: { ...request.trace, topicId: 'foreign-topic', toolCallId: 'foreign-call' },
    });
    expect(denied.success).toBe(false);
    expect(denied.content).toContain('ATTACHMENT_NOT_AVAILABLE');
    expect(readFile).toHaveBeenCalledTimes(1);
    const ambiguous = await controller.executeLocalToolCall({
      ...request,
      args: { ...request.args, path: prepared.path },
      trace: { ...request.trace, toolCallId: 'ambiguous' },
    });
    expect(ambiguous.content).toBe('INVALID_ATTACHMENT_TOOL_REQUEST');
  });

  it.each(['readFile', 'readFiles'])(
    'redacts legacy attachment paths in %s while preserving workspace paths',
    async (apiName) => {
      const root = path.join(tempRoot, 'app-storage', 'scratch-workspaces');
      const attachments = [];
      for (const name of ['first.txt', 'second.txt']) {
        const ref = await receiveLocalAttachment(root, 'device-1', {
          draftId: 'legacy-draft',
          name,
          mime: 'text/plain',
          data: Buffer.from('hello'),
        });
        const prepared = await prepareLocalAttachment(root, 'device-1', ref, 'legacy-topic');
        attachments.push(prepared);
      }
      const workspaceFile = path.join(workspace, 'ordinary.txt');
      await writeFile(workspaceFile, 'ordinary');
      const paths = [...attachments.map(({ path: filename }) => filename), workspaceFile];
      if (apiName === 'readFile')
        readFile.mockResolvedValueOnce({ content: `${paths[0]} ${workspaceFile}` });
      else
        vi.spyOn(localFileCtr, 'readFiles').mockResolvedValueOnce(
          paths.map((filename) => ({
            filename,
            content: filename,
            charCount: filename.length,
            createdTime: new Date(0),
            fileType: 'txt',
            lineCount: 1,
            loc: [1, 1] as [number, number],
            modifiedTime: new Date(0),
            totalCharCount: filename.length,
            totalLineCount: 1,
          })),
        );
      const result = await makeController().executeLocalToolCall({
        apiName,
        args: apiName === 'readFiles' ? { paths } : { path: paths[0] },
        executionContext: context(),
        trace: {
          deviceId: 'device-1',
          topicId: 'legacy-topic',
          operationId: 'legacy-op',
          toolCallId: 'legacy-read',
        },
      });
      expect(result.success).toBe(true);
      const serialized = JSON.stringify(result);
      for (const item of apiName === 'readFiles' ? attachments : attachments.slice(0, 1)) {
        expect(serialized).not.toContain(path.dirname(item.path));
        expect(result.content).toContain(`attachment:${item.ref.attachmentId}`);
      }
      expect(serialized).not.toContain('.attachments');
      expect(result.content).toContain(workspaceFile);
      expect(serialized).toContain('consent:legacy-op');
    },
  );

  it.each([
    { success: false, stdout: 'failed' },
    { success: true, exit_code: 1, stdout: '', stderr: '' },
  ])('does not publish scratch evidence when the command fails: %j', async (output) => {
    handleRunCommand.mockResolvedValueOnce(output);
    const controller = makeController();
    const trace = {
      deviceId: 'device-1',
      topicId: 'topic-failed',
      operationId: 'op',
      toolCallId: 'call',
    };
    const result = await controller.executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: 'false' },
      executionContext: { accessRoots: [] },
      trace,
    });
    expect(result.state).toMatchObject('exit_code' in output ? { exitCode: 1 } : output);
    expect(result.state).not.toHaveProperty('localScratch');
    expect(
      await (controller as any).executeDeviceRpc('getLocalScratchExecution', trace),
    ).toBeNull();
  });

  it('deduplicates concurrent delivery and renews proof when replaying a delayed success', async () => {
    const controller = makeController();
    const trace = {
      deviceId: 'device-1',
      topicId: 'topic-replay',
      operationId: 'op',
      toolCallId: 'call',
    };
    const request = {
      apiName: 'runCommand',
      args: { command: 'pwd' },
      executionContext: { accessRoots: [] },
      trace,
    };
    await Promise.all([
      controller.executeLocalToolCall(request),
      controller.executeLocalToolCall(request),
    ]);
    expect(handleRunCommand).toHaveBeenCalledTimes(1);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    try {
      await controller.executeLocalToolCall({
        ...request,
        trace: { ...trace, topicId: 'another-topic' },
      });
      expect(handleRunCommand).toHaveBeenCalledTimes(2);
      const replay = await controller.executeLocalToolCall(request);
      expect(handleRunCommand).toHaveBeenCalledTimes(2);
      expect(replay.state).toMatchObject({
        localScratch: await (controller as any).executeDeviceRpc('getLocalScratchExecution', trace),
      });
    } finally {
      clock.mockRestore();
    }
  });

  it('executes a standalone renderer tool call through the main-process boundary', async () => {
    const file = path.join(workspace, 'safe.txt');
    await writeFile(file, 'safe');
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'readFile',
      args: { path: 'safe.txt' },
      executionContext: context(),
      trace: {
        deviceId: 'device-1',
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(result).toMatchObject({ success: true });
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: file }));
  });

  it('blocks an absolute standalone renderer read outside the frozen workspace', async () => {
    const outside = path.join(tempRoot, 'outside.txt');
    await writeFile(outside, 'secret');
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'readFile',
      args: { path: outside },
      executionContext: context(),
      trace: {
        deviceId: 'device-1',
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(result).toMatchObject({ content: 'INTERVENTION_REQUIRED', success: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each(['scratch', 'device'] as const)(
    'executes an external %s read without path consent while auto-approve is active',
    async (workspaceKind) => {
      const outside = path.join(tempRoot, `${workspaceKind}-outside.txt`);
      await writeFile(outside, 'allowed by auto-run');
      const canonicalOutside = await realpath(outside);
      const controller = makeController();

      const result = await controller.executeLocalToolCall({
        apiName: 'readFile',
        args: { path: outside },
        executionContext: {
          ...context(),
          approvalMode: 'auto-run',
          workspaceKind,
        },
        trace: {
          deviceId: 'device-1',
          operationId: 'op-1',
          toolCallId: 'call-1',
          topicId: 'topic-1',
        },
      });

      expect(result).toMatchObject({ success: true });
      expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: canonicalOutside }));
    },
  );

  it('fails closed when standalone tool_execute loses its execution context', async () => {
    const file = path.join(workspace, 'safe.txt');
    await writeFile(file, 'safe');
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'readFile',
      args: { path: file },
      trace: {
        deviceId: 'device-1',
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(result).toMatchObject({ content: 'WORKSPACE_REQUIRED', success: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects a context-free renderer runCommand without trace metadata', async () => {
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: 'id' },
    });

    expect(result).toMatchObject({ content: 'WORKSPACE_REQUIRED', success: false });
    expect(handleRunCommand).not.toHaveBeenCalled();
  });

  it('overrides model runCommand.cwd and returns redacted scope evidence', async () => {
    const controller = makeController();
    const result = await (controller as any).executeToolCall(
      'runCommand',
      { command: 'pwd', cwd: '/tmp/evil', env: { MODEL_SECRET: 'drop' } },
      context(),
      { deviceId: 'device-1', operationId: 'op-1', toolCallId: 'call-1', topicId: 'topic-1' },
    );

    expect(handleRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: workspace,
        env: { FILE_ONLY: 'from-file', SHARED: 'server-wins', WORKSPACE_ENV: 'kept' },
      }),
    );
    expect(result.state.scopeAudit).toEqual([
      expect.objectContaining({ cwdOverridden: true, scopeVerdict: 'primary' }),
    ]);
    expect(JSON.stringify(result.state.workspaceWarnings)).not.toContain('/tmp/evil');
    expect(JSON.stringify(result)).not.toContain('MODEL_SECRET');
  });

  it('resolves an envRef in main and merges it over workspace dotenv files', async () => {
    const controller = makeController();
    const executionContext = context();
    delete executionContext.env;

    await controller.executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: 'env' },
      executionContext: {
        ...executionContext,
        envRef: { agentId: 'agent-1', topicId: 'topic-1', workspaceId: 'workspace-1' },
      },
      trace: {
        deviceId: 'device-1',
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(resolveExecutionEnv).toHaveBeenCalledWith({
      agentId: 'agent-1',
      topicId: 'topic-1',
      workspaceId: 'workspace-1',
    });
    expect(handleRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { FILE_ONLY: 'from-file', MANAGED: 'resolved', SHARED: 'managed' },
      }),
    );
  });

  it('injects deterministic skill directories after resolving managed env', async () => {
    const controller = makeController();
    const skillDir = path.join(workspace, '.skills', 'deploy');
    await mkdir(skillDir, { recursive: true });

    await controller.executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: './run.sh', env: { SKILL_DIR: '/tmp/forged' } },
      executionContext: {
        accessRoots: [
          {
            modes: ['read', 'exec'],
            operationId: 'op-1',
            rootPath: skillDir,
            scope: 'operation',
            source: 'user-approval',
          },
        ],
        cwd: skillDir,
        envFiles: ['.env'],
        envRef: { agentId: 'agent-1', topicId: 'topic-1', workspaceId: 'workspace-1' },
        workspaceRootPath: workspace,
      },
      purpose: 'skill-script',
      trace: {
        deviceId: 'device-1',
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(handleRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: skillDir,
        env: {
          FILE_ONLY: 'from-file',
          MANAGED: 'resolved',
          SHARED: 'managed',
          SKILL_DIR: skillDir,
          WORKSPACE_DIR: workspace,
        },
      }),
    );
  });

  it('spawns a gateway agent run with only the server-frozen cwd and environment', async () => {
    const controller = makeController();

    const result = await (controller as any).executeAgentRun({
      agentType: 'codex',
      cwd: '/tmp/legacy',
      env: { LEGACY_SECRET: 'drop' },
      executionContext: context(),
      jwt: 'operation-jwt',
      operationId: 'op-1',
      prompt: 'run in the project',
      topicId: 'topic-1',
      type: 'agent_run_request',
    });

    expect(result).toEqual({ status: 'accepted' });
    expect(spawnLhHeteroExec).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: workspace,
        env: { FILE_ONLY: 'from-file', SHARED: 'server-wins', WORKSPACE_ENV: 'kept' },
        operationId: 'op-1',
        topicId: 'topic-1',
      }),
    );
    expect(JSON.stringify(spawnLhHeteroExec.mock.calls[0])).not.toContain('LEGACY_SECRET');
  });

  it('returns WORKSPACE_REQUIRED before spawning when v2 context has no cwd', async () => {
    const controller = makeController();
    const result = await (controller as any).executeToolCall(
      'runCommand',
      { command: 'pwd' },
      { accessRoots: [] },
    );

    expect(result).toMatchObject({ content: 'WORKSPACE_REQUIRED', success: false });
    expect(handleRunCommand).not.toHaveBeenCalled();
  });

  it('requires intervention before a symlink may read outside the primary root', async () => {
    const outside = path.join(tempRoot, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(workspace, 'link'));
    const controller = makeController();

    const result = await (controller as any).executeToolCall(
      'readFile',
      { path: 'link/secret.txt' },
      context(),
    );

    expect(result).toMatchObject({ content: 'INTERVENTION_REQUIRED', success: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('returns runtime-authored structured consent metadata for an out-of-scope read', async () => {
    const outside = path.join(tempRoot, 'shared');
    await mkdir(outside);
    const file = path.join(outside, 'note.txt');
    await writeFile(file, 'shared');
    const canonicalFile = await realpath(file);
    const controller = makeController();

    const result = await (controller as any).executeToolCall(
      'readFile',
      { path: file },
      context(),
      { deviceId: 'device-1', operationId: 'op-1', toolCallId: 'call-1', topicId: 'topic-1' },
    );

    expect(result).toMatchObject({
      content: 'INTERVENTION_REQUIRED',
      state: {
        workspacePathConsent: {
          actualCwd: workspace,
          deviceId: 'device-1',
          modes: ['read'],
          operationId: 'op-1',
          primaryCwd: workspace,
          requestedPath: canonicalFile,
          topicId: 'topic-1',
          version: 1,
        },
      },
      success: false,
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('uses the device-local approved mount list for a gateway direct-message read', async () => {
    const mountRoot = path.join(tempRoot, 'Volumes');
    const project = path.join(mountRoot, 'ExternalDisk', 'project');
    const file = path.join(project, 'note.txt');
    await mkdir(project, { recursive: true });
    await writeFile(file, 'mounted');
    const canonicalFile = await realpath(file);
    const controller = makeController([mountRoot]);

    const result = await (controller as any).executeToolCall(
      'readFile',
      { path: file },
      {
        accessRoots: [
          {
            modes: ['read'],
            operationId: 'op-mounted',
            rootPath: project,
            scope: 'operation',
            source: 'direct-user-message',
          },
        ],
      },
      {
        deviceId: 'device-1',
        operationId: 'op-mounted',
        toolCallId: 'call-mounted',
        topicId: 'topic-1',
      },
    );

    expect(result).toMatchObject({ success: true });
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: canonicalFile }));
    expect(result.state.scopeAudit).toEqual([
      expect.objectContaining({ scopeVerdict: 'consent:op-mounted' }),
    ]);
  });
});
