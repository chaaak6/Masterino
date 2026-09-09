import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeviceToolCallExecutionContext } from '../../types';
import { prepareToolCallExecution } from '../executionBoundary';

describe('prepareToolCallExecution', () => {
  let tempRoot: string;
  let homeDir: string;
  let workspace: string;

  const primaryContext = (): DeviceToolCallExecutionContext => ({
    accessRoots: [
      {
        modes: ['read', 'write', 'exec'],
        rootPath: workspace,
        scope: 'primary',
        source: 'workspace',
      },
    ],
    cwd: workspace,
    workspaceRootPath: workspace,
  });

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'execution-boundary-'));
    homeDir = path.join(tempRoot, 'home');
    workspace = path.join(homeDir, 'project');
    await mkdir(path.join(homeDir, '.ssh'), { recursive: true });
    await mkdir(workspace, { recursive: true });
    workspace = await realpath(workspace);
    await writeFile(path.join(homeDir, '.ssh', 'id_ed25519'), 'secret');
    await writeFile(path.join(workspace, 'README.md'), 'safe');
    await symlink(path.join(homeDir, '.ssh'), path.join(workspace, 'link'));
  });

  it('fails closed for a context-free local-system command even without trace metadata', async () => {
    await expect(
      prepareToolCallExecution({
        apiName: 'runCommand',
        args: { command: 'id' },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it('grants only the selected file while keeping workspace directory access recursive', async () => {
    const selected = path.join(homeDir, 'selected.txt');
    const sibling = path.join(homeDir, 'sibling.txt');
    await writeFile(selected, 'selected');
    await writeFile(sibling, 'sibling');
    const context: DeviceToolCallExecutionContext = {
      ...primaryContext(),
      accessRoots: [
        ...primaryContext().accessRoots!,
        {
          target: 'file',
          rootPath: selected,
          modes: ['read'],
          scope: 'operation',
          source: 'user-approval',
          operationId: 'op-1',
        },
      ],
    };
    const trace = {
      deviceId: 'device-1',
      operationId: 'op-1',
      toolCallId: 'call-1',
      topicId: 't-1',
    };
    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: selected },
        context,
        homeDir,
        trace,
      }),
    ).resolves.toBeDefined();
    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: sibling },
        context,
        homeDir,
        trace,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
    await mkdir(path.join(workspace, 'nested'));
    await writeFile(path.join(workspace, 'nested/a.txt'), 'allowed');
    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: 'nested/a.txt' },
        context,
        homeDir,
        trace,
      }),
    ).resolves.toBeDefined();
  });

  it('overrides model cwd with the primary cwd without retaining the supplied value', async () => {
    const result = await prepareToolCallExecution({
      apiName: 'runCommand',
      args: { command: 'pwd', cwd: '/tmp/evil', env: { MODEL_SECRET: 'drop' } },
      context: { ...primaryContext(), env: { WORKSPACE_ENV: 'kept' } },
      homeDir,
      trace: { deviceId: 'device-1', operationId: 'op-1', toolCallId: 'call-1', topicId: 't-1' },
    });

    expect(result.args).toMatchObject({ cwd: workspace, env: { WORKSPACE_ENV: 'kept' } });
    expect(result.scopeAudit).toEqual([
      expect.objectContaining({
        cwdOverridden: true,
        mode: 'exec',
        scopeVerdict: 'primary',
      }),
    ]);
    expect(JSON.stringify(result.warnings)).not.toContain('/tmp/evil');
    expect(JSON.stringify(result)).not.toContain('MODEL_SECRET');
  });

  it.each([
    ['readFile', { path: 'link/id_ed25519' }],
    ['writeFile', { content: 'x', path: 'link/new-key' }],
  ])('denies %s when a workspace symlink escapes the primary root', async (apiName, args) => {
    await expect(
      prepareToolCallExecution({ apiName, args, context: primaryContext(), homeDir }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('denies exec when the approved cwd itself realpaths into a sensitive root', async () => {
    const linkedCwd = path.join(workspace, 'link');
    await expect(
      prepareToolCallExecution({
        apiName: 'runCommand',
        args: { command: 'pwd' },
        context: {
          accessRoots: [
            {
              modes: ['exec'],
              rootPath: linkedCwd,
              scope: 'primary',
              source: 'workspace',
            },
          ],
          cwd: linkedCwd,
          workspaceRootPath: linkedCwd,
        },
        homeDir,
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it.each(['root', 'home'])('hard-denies an overbroad %s workspace root', async (kind) => {
    const cwd = kind === 'root' ? path.parse(workspace).root : homeDir;
    await expect(
      prepareToolCallExecution({
        apiName: 'runCommand',
        args: { command: 'pwd' },
        context: {
          accessRoots: [{ modes: ['exec'], rootPath: cwd, scope: 'primary', source: 'workspace' }],
          cwd,
        },
        homeDir,
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('realpaths home traversal before evaluating a topic grant', async () => {
    const grantRoot = path.join(homeDir, 'grant');
    await mkdir(grantRoot);
    const context: DeviceToolCallExecutionContext = {
      ...primaryContext(),
      accessRoots: [
        ...primaryContext().accessRoots!,
        {
          deviceId: 'device-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          grantId: 'grant-1',
          modes: ['read'],
          rootPath: grantRoot,
          scope: 'topic',
          source: 'user-approval',
          topicId: 'topic-1',
        },
      ],
    };

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: '~/grant/../.ssh/id_ed25519' },
        context,
        homeDir,
        trace: { deviceId: 'device-1', topicId: 'topic-1' },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('allows structured direct operation consent for read only', async () => {
    const outside = path.join(homeDir, 'shared');
    await mkdir(outside);
    await writeFile(path.join(outside, 'note.txt'), 'shared');
    const context: DeviceToolCallExecutionContext = {
      ...primaryContext(),
      accessRoots: [
        ...primaryContext().accessRoots!,
        {
          modes: ['read', 'write'],
          operationId: 'op-1',
          rootPath: outside,
          scope: 'operation',
          source: 'direct-user-message',
        },
      ],
    };
    const trace = { operationId: 'op-1' };

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: path.join(outside, 'note.txt') },
        context,
        homeDir,
        trace,
      }),
    ).resolves.toMatchObject({
      scopeAudit: [expect.objectContaining({ scopeVerdict: 'consent:op-1' })],
    });
    await expect(
      prepareToolCallExecution({
        apiName: 'writeFile',
        args: { content: 'no', path: path.join(outside, 'new.txt') },
        context,
        homeDir,
        trace,
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('records which root source and canonical root authorized a successful read', async () => {
    const outside = path.join(homeDir, 'shared');
    const nested = path.join(outside, 'deep');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'note.txt'), 'shared');
    const realOutside = await realpath(outside);
    const roots = (source: 'direct-user-message' | 'user-approval') => [
      ...primaryContext().accessRoots!,
      {
        modes: ['read' as const],
        operationId: 'op-1',
        rootPath: outside,
        scope: 'operation' as const,
        source,
      },
    ];
    // The tool reads a file below the authorized root; the audit has to name both.
    const args = { path: path.join(nested, 'note.txt') };
    const trace = { operationId: 'op-1' };

    // `consent:op-1` alone is ambiguous, so the UI needs the source to tell an
    // auto-allowed direct-message root from an explicitly approved one.
    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args,
        context: { ...primaryContext(), accessRoots: roots('direct-user-message') },
        homeDir,
        trace,
      }),
    ).resolves.toMatchObject({
      scopeAudit: [
        {
          path: await realpath(path.join(nested, 'note.txt')),
          rootPath: realOutside,
          scopeVerdict: 'consent:op-1',
          source: 'direct-user-message',
        },
      ],
    });

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args,
        context: { ...primaryContext(), accessRoots: roots('user-approval') },
        homeDir,
        trace,
      }),
    ).resolves.toMatchObject({
      scopeAudit: [
        { rootPath: realOutside, scopeVerdict: 'consent:op-1', source: 'user-approval' },
      ],
    });

    // A read inside the primary workspace is never an auto-allowed extra root.
    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: path.join(workspace, 'README.md') },
        context: primaryContext(),
        homeDir,
        trace,
      }),
    ).resolves.toMatchObject({
      scopeAudit: [{ rootPath: workspace, scopeVerdict: 'primary', source: 'workspace' }],
    });
  });

  it('names one shared root for several targets read under it', async () => {
    const outside = path.join(homeDir, 'shared');
    await mkdir(path.join(outside, 'deep'), { recursive: true });
    await writeFile(path.join(outside, 'a.txt'), 'a');
    await writeFile(path.join(outside, 'deep', 'b.txt'), 'b');
    const realOutside = await realpath(outside);

    const result = await prepareToolCallExecution({
      apiName: 'readFiles',
      args: { paths: [path.join(outside, 'a.txt'), path.join(outside, 'deep', 'b.txt')] },
      context: {
        ...primaryContext(),
        accessRoots: [
          ...primaryContext().accessRoots!,
          {
            modes: ['read'],
            operationId: 'op-1',
            rootPath: outside,
            scope: 'operation',
            source: 'direct-user-message',
          },
        ],
      },
      homeDir,
      trace: { operationId: 'op-1' },
    });

    expect(result.scopeAudit.map(({ rootPath }) => rootPath)).toEqual([realOutside, realOutside]);
    expect(new Set(result.scopeAudit.map(({ path: target }) => target)).size).toBe(2);
  });

  it('does not auto-consent to direct-message roots outside the user home', async () => {
    const outsideHome = path.join(tempRoot, 'system-mount');
    await mkdir(outsideHome);
    const target = path.join(outsideHome, 'note.txt');
    await writeFile(target, 'outside');

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: target },
        context: {
          accessRoots: [
            {
              modes: ['read'],
              operationId: 'op-outside',
              rootPath: outsideHome,
              scope: 'operation',
              source: 'direct-user-message',
            },
          ],
        },
        homeDir,
        trace: { operationId: 'op-outside' },
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('allows a direct-message read below a device-approved mount container', async () => {
    const mountRoot = path.join(tempRoot, 'Volumes');
    const project = path.join(mountRoot, 'ExternalDisk', 'project');
    const target = path.join(project, 'note.txt');
    await mkdir(project, { recursive: true });
    await writeFile(target, 'mounted');

    await expect(
      prepareToolCallExecution({
        allowedMountRoots: [mountRoot],
        apiName: 'readFile',
        args: { path: target },
        context: {
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
        homeDir,
        trace: { operationId: 'op-mounted' },
      }),
    ).resolves.toMatchObject({
      args: { path: await realpath(target) },
      scopeAudit: [expect.objectContaining({ scopeVerdict: 'consent:op-mounted' })],
    });
  });

  it.each([
    ['the mount container itself', (mountRoot: string) => mountRoot],
    ['a sibling outside the mount container', (_mountRoot: string, outside: string) => outside],
  ])('rejects direct-message consent rooted at %s', async (_label, rootForCase) => {
    const mountRoot = path.join(tempRoot, 'Volumes');
    const outside = path.join(tempRoot, 'outside-mount');
    await mkdir(mountRoot);
    await mkdir(outside);
    const directRoot = rootForCase(mountRoot, outside);
    const target = path.join(directRoot, 'note.txt');
    await writeFile(target, 'not-authorized');

    await expect(
      prepareToolCallExecution({
        allowedMountRoots: [mountRoot],
        apiName: 'readFile',
        args: { path: target },
        context: {
          accessRoots: [
            {
              modes: ['read'],
              operationId: 'op-rejected',
              rootPath: directRoot,
              scope: 'operation',
              source: 'direct-user-message',
            },
          ],
        },
        homeDir,
        trace: { operationId: 'op-rejected' },
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('realpaths traversal before checking an approved mount container', async () => {
    const mountRoot = path.join(tempRoot, 'Volumes');
    const project = path.join(mountRoot, 'ExternalDisk', 'project');
    const outside = path.join(tempRoot, 'outside-mount');
    await mkdir(project, { recursive: true });
    await mkdir(outside);
    const target = path.join(outside, 'secret.txt');
    await writeFile(target, 'secret');

    await expect(
      prepareToolCallExecution({
        allowedMountRoots: [mountRoot],
        apiName: 'readFile',
        args: { path: path.join(project, '..', '..', '..', 'outside-mount', 'secret.txt') },
        context: {
          accessRoots: [
            {
              modes: ['read'],
              operationId: 'op-traversal',
              rootPath: project,
              scope: 'operation',
              source: 'direct-user-message',
            },
          ],
        },
        homeDir,
        trace: { operationId: 'op-traversal' },
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('allows an explicit absolute read on an unbound topic when an operation root covers it', async () => {
    const file = path.join(workspace, 'notes.txt');
    await writeFile(file, 'notes');

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: file },
        context: {
          accessRoots: [
            {
              modes: ['read'],
              operationId: 'op-unbound',
              rootPath: workspace,
              scope: 'operation',
              source: 'direct-user-message',
            },
          ],
        },
        homeDir,
        trace: { operationId: 'op-unbound' },
      }),
    ).resolves.toMatchObject({
      args: { path: file },
      scopeAudit: [expect.objectContaining({ scopeVerdict: 'consent:op-unbound' })],
    });
  });

  it('allows an explicit user-approved operation root to cover a declared write', async () => {
    const outside = path.join(homeDir, 'approved-write');
    await mkdir(outside);

    await expect(
      prepareToolCallExecution({
        apiName: 'writeFile',
        args: { content: 'approved', path: path.join(outside, 'new.txt') },
        context: {
          ...primaryContext(),
          accessRoots: [
            ...primaryContext().accessRoots!,
            {
              modes: ['write'],
              operationId: 'op-write',
              rootPath: outside,
              scope: 'operation',
              source: 'user-approval',
            },
          ],
        },
        homeDir,
        trace: { operationId: 'op-write' },
      }),
    ).resolves.toMatchObject({
      scopeAudit: [expect.objectContaining({ mode: 'write', scopeVerdict: 'consent:op-write' })],
    });
  });

  it('allows an explicit absolute write without primary cwd only when user approval covers it', async () => {
    const outside = path.join(homeDir, 'approved-unbound-write');
    await mkdir(outside);
    const target = path.join(outside, 'new.txt');

    await expect(
      prepareToolCallExecution({
        apiName: 'writeFile',
        args: { content: 'approved', path: target },
        context: {
          accessRoots: [
            {
              modes: ['write'],
              operationId: 'op-write',
              rootPath: outside,
              scope: 'operation',
              source: 'user-approval',
            },
          ],
        },
        homeDir,
        trace: { operationId: 'op-write' },
      }),
    ).resolves.toMatchObject({
      scopeAudit: [expect.objectContaining({ mode: 'write', scopeVerdict: 'consent:op-write' })],
    });
  });

  it('fails closed when an operation root is missing its operation tuple', async () => {
    const outside = path.join(homeDir, 'stale-operation-root');
    await mkdir(outside);
    const file = path.join(outside, 'note.txt');
    await writeFile(file, 'stale');

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: file },
        context: {
          ...primaryContext(),
          accessRoots: [
            ...primaryContext().accessRoots!,
            {
              modes: ['read'],
              rootPath: outside,
              scope: 'operation',
              source: 'user-approval',
            },
          ],
        },
        homeDir,
        trace: { operationId: 'op-current' },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('requires explicit intervention for an out-of-scope structured read', async () => {
    const outside = path.join(homeDir, 'outside.txt');
    await writeFile(outside, 'outside');
    const canonicalOutside = await realpath(outside);

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: outside },
        context: primaryContext(),
        homeDir,
        trace: {
          deviceId: 'device-1',
          operationId: 'op-read',
          topicId: 'topic-1',
          toolCallId: 'call-1',
        },
      }),
    ).rejects.toMatchObject({
      code: 'INTERVENTION_REQUIRED',
      scopeAudit: [expect.objectContaining({ mode: 'read', path: canonicalOutside })],
    });
  });

  it.each([
    [{ grantId: undefined }, { deviceId: 'device-1', topicId: 'topic-1' }],
    [{ deviceId: undefined }, { deviceId: 'device-1', topicId: 'topic-1' }],
    [{ deviceId: 'device-2' }, { deviceId: 'device-1', topicId: 'topic-1' }],
    [{ topicId: 'topic-2' }, { deviceId: 'device-1', topicId: 'topic-1' }],
    [{ expiresAt: '2020-01-01T00:00:00.000Z' }, { deviceId: 'device-1', topicId: 'topic-1' }],
    [{ modes: ['write'] as Array<'write'> }, { deviceId: 'device-1', topicId: 'topic-1' }],
    [{ source: 'workspace' as const }, { deviceId: 'device-1', topicId: 'topic-1' }],
  ])('fails closed for incomplete or mismatched topic grant evidence', async (override, trace) => {
    const outside = path.join(homeDir, 'shared');
    await mkdir(outside);
    await writeFile(path.join(outside, 'note.txt'), 'shared');
    const context: DeviceToolCallExecutionContext = {
      ...primaryContext(),
      accessRoots: [
        ...primaryContext().accessRoots!,
        {
          deviceId: 'device-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          grantId: 'grant-1',
          modes: ['read'],
          rootPath: outside,
          scope: 'topic',
          source: 'user-approval',
          topicId: 'topic-1',
          ...override,
        },
      ],
    };

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: path.join(outside, 'note.txt') },
        context,
        homeDir,
        now: new Date('2026-09-03T00:00:00.000Z'),
        trace,
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('requires a one-operation user approval before reading credentials', async () => {
    const credential = path.join(workspace, '.env');
    await writeFile(credential, 'TOKEN=secret');

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: credential },
        context: primaryContext(),
        homeDir,
        trace: { operationId: 'op-credential' },
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });

    const approved: DeviceToolCallExecutionContext = {
      ...primaryContext(),
      accessRoots: [
        ...primaryContext().accessRoots!,
        {
          modes: ['read'],
          operationId: 'op-credential',
          rootPath: credential,
          scope: 'operation',
          source: 'user-approval',
        },
      ],
    };
    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: credential },
        context: approved,
        homeDir,
        trace: { operationId: 'op-credential' },
      }),
    ).resolves.toMatchObject({
      scopeAudit: [expect.objectContaining({ scopeVerdict: 'consent:op-credential' })],
    });
  });

  it('hard-denies a private key even when an operation approval is present', async () => {
    const privateKey = path.join(workspace, 'id_rsa');
    await writeFile(privateKey, 'secret');
    const context: DeviceToolCallExecutionContext = {
      ...primaryContext(),
      accessRoots: [
        ...primaryContext().accessRoots!,
        {
          modes: ['read'],
          operationId: 'op-key',
          rootPath: privateKey,
          scope: 'operation',
          source: 'user-approval',
        },
      ],
    };

    await expect(
      prepareToolCallExecution({
        apiName: 'readFile',
        args: { path: privateKey },
        context,
        homeDir,
        trace: { operationId: 'op-key' },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('injects the context cwd for search without consulting ambient fallbacks', async () => {
    const result = await prepareToolCallExecution({
      apiName: 'grepContent',
      args: { pattern: 'needle' },
      context: primaryContext(),
      homeDir,
    });
    expect(result.args).toMatchObject({ cwd: workspace, path: workspace, scope: workspace });
  });

  it('rejects a glob pattern that traverses outside the authorized search root', async () => {
    await expect(
      prepareToolCallExecution({
        apiName: 'globFiles',
        args: { pattern: '../../**/*' },
        context: primaryContext(),
        homeDir,
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('drops model-provided env when the execution context has no resolved env', async () => {
    const result = await prepareToolCallExecution({
      apiName: 'runCommand',
      args: { command: 'pwd', env: { MODEL_SECRET: 'drop' } },
      context: primaryContext(),
      homeDir,
    });

    expect(result.args).not.toHaveProperty('env');
    expect(JSON.stringify(result)).not.toContain('MODEL_SECRET');
  });

  it('keeps context-free non-local-system calls on the explicit legacy branch', async () => {
    const args = { platform: 'openclaw' };
    await expect(
      prepareToolCallExecution({ apiName: 'checkPlatformCapability', args }),
    ).resolves.toEqual({
      args,
      legacy: true,
      scopeAudit: [],
      warnings: [],
    });
  });

  it('fails closed when a v2 operation loses its execution context in transit', async () => {
    await expect(
      prepareToolCallExecution({
        apiName: 'runCommand',
        args: { command: 'pwd' },
        trace: { operationId: 'op-v2', topicId: 'topic-v2' },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
  });
});
