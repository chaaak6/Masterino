import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareToolCallExecution } from '../executionBoundary';
import { writeLocalFile } from '../write';

describe('temporary workspace files', () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'masterino-temp-files-')));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const write = async (name: string, content: string, topicId: string, temporary = true) => {
    const prepared = await prepareToolCallExecution({
      apiName: 'writeFile',
      args: { path: name, content, temporary },
      context: {
        cwd: workspace,
        workspaceRootPath: workspace,
        accessRoots: [
          {
            rootPath: workspace,
            modes: ['read', 'write', 'exec'],
            scope: 'primary',
            source: 'workspace',
          },
        ],
      },
      trace: { topicId },
    });
    return writeLocalFile(prepared.args);
  };

  it('returns the managed script path and leaves only deliverables at the workspace root', async () => {
    const result = await write('generate.py', 'print("中文")', 'tpc_first');
    const expected = path.join(workspace, '.masterino-tmp', 'tpc_first', 'generate.py');
    expect(result).toEqual({ success: true, path: expected });
    expect(await readFile(expected, 'utf8')).toBe('print("中文")');
    await write('report.txt', '交付物', 'tpc_first', false);
    expect((await readdir(workspace)).sort()).toEqual(['.masterino-tmp', 'report.txt']);
  });
  it('reuses a script within a topic and isolates two topics with the same file name', async () => {
    await write('generate.py', 'first', 'tpc_first');
    await write('generate.py', 'corrected', 'tpc_first');
    await write('generate.py', 'second topic', 'tpc_second');
    expect(
      await readFile(path.join(workspace, '.masterino-tmp/tpc_first/generate.py'), 'utf8'),
    ).toBe('corrected');
    expect(
      await readFile(path.join(workspace, '.masterino-tmp/tpc_second/generate.py'), 'utf8'),
    ).toBe('second topic');
    expect(await readdir(path.join(workspace, '.masterino-tmp/tpc_first'))).toEqual([
      'generate.py',
    ]);
  });

  it('preserves user-requested source code and presentation sidecars at their requested paths', async () => {
    await write('src/main.py', 'user source', 'tpc_first', false);
    await write('deck.pptx.masterino.json', '{}', 'tpc_first', false);
    expect(await readFile(path.join(workspace, 'src/main.py'), 'utf8')).toBe('user source');
    expect(await readFile(path.join(workspace, 'deck.pptx.masterino.json'), 'utf8')).toBe('{}');
    expect(await readdir(workspace)).not.toContain('.masterino-tmp');
  });

  it.each(['../escape.py', '/tmp/escape.py', 'C:\\temp\\escape.py', 'nested/../escape.py'])(
    'rejects an invalid temporary name: %s',
    async (name) => {
      await expect(write(name, 'bad', 'tpc_first')).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
      expect(await readdir(workspace)).toEqual([]);
    },
  );

  it('requires a bound topic and rejects a symlinked temporary directory', async () => {
    await expect(write('script.py', 'bad', '')).rejects.toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    });
    await expect(write('script.py', 'bad', '../other')).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
    });
    await mkdir(path.join(workspace, 'user-code'));
    await symlink(
      path.join(workspace, 'user-code'),
      path.join(workspace, '.masterino-tmp'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(write('script.py', 'bad', 'tpc_first')).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
    });
    expect(await readdir(path.join(workspace, 'user-code'))).toEqual([]);
  });

  it('does not silently write an unprepared temporary request at the project root', async () => {
    const result = await writeLocalFile({
      path: path.join(workspace, 'script.py'),
      content: 'bad',
      temporary: true,
    });
    expect(result.success).toBe(false);
    expect(await readdir(workspace)).toEqual([]);
  });
  it('scopes explicit managed paths from older tool schemas to the bound topic', async () => {
    const result = await write(
      '.masterino-tmp/ppt-task/generate.py',
      'old-schema',
      'tpc_first',
      false,
    );
    expect(result).toEqual({
      success: true,
      path: path.join(workspace, '.masterino-tmp/tpc_first/generate.py'),
    });
    expect(await readdir(path.join(workspace, '.masterino-tmp'))).toEqual(['tpc_first']);
  });
  it.runIf(process.platform === 'win32')('hides the managed root in Windows Explorer', async () => {
    await write('generate.py', 'print("ok")', 'tpc_first');
    const { stdout } = await promisify(execFile)('attrib.exe', [
      path.join(workspace, '.masterino-tmp'),
    ]);
    expect(stdout.split(workspace)[0]).toContain('H');
  });
});
