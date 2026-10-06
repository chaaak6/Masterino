import childProcess from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  formatPythonEnvironment,
  getBundledPythonInfo,
  prepareProjectPythonEnvironment,
} from '../pythonRuntime';

vi.mock('node:child_process', () => ({ default: { execFile: vi.fn() } }));

describe('bundled Python agent context', () => {
  it('provides the quoted executable and importable preinstalled packages', () => {
    const context = formatPythonEnvironment({
      executable: '/Applications/Masterino Test.app/Contents/Resources/python-runtime/bin/python3',
      sitePackages: '/app/python-runtime/lib/python3.12/site-packages',
      version: '3.12.14',
      venvRoot: '/User Data/python-environments',
      packages: {
        'python-pptx': '1.0.2',
        'Pillow': '12.3.0',
        'lxml': '6.1.3',
        'XlsxWriter': '3.2.9',
        'typing-extensions': '4.16.0',
      },
    });
    expect(context).toContain(
      '"/Applications/Masterino Test.app/Contents/Resources/python-runtime/bin/python3"',
    );
    expect(context).toContain('Python 3.12.14');
    expect(context).toContain('/app/python-runtime/lib/python3.12/site-packages');
    expect(context).toContain('-I -B -X utf8');
    expect(context).toContain('-m venv --without-pip --system-site-packages');
    expect(context).not.toContain('/User Data/python-environments/project-env');
    expect(context).toContain('project path');
    expect(context).toContain('existing project');
    expect(context).not.toContain('-m pip for package management');
    expect(context).not.toContain('prioritizes this interpreter directory on PATH');
    expect(context).toContain('-B');
    expect(context).toContain('python-pptx==1.0.2 (import pptx)');
    expect(context).toContain('Pillow==12.3.0 (import PIL)');
    expect(context).toContain('lxml==6.1.3');
    expect(context).toContain('XlsxWriter==3.2.9 (import xlsxwriter)');
    expect(context).toContain('typing-extensions==4.16.0 (import typing_extensions)');
    expect(context).not.toContain('at startup');
    expect(context).toContain('detected');
    expect(context).toContain('.masterino-tmp/<topic-id>/');
    expect(context).toContain('temporary=true');
    expect(context).toContain('cwd kept at the workspace root');
    expect(context).toContain('source code explicitly requested by the user');
    expect(context).toContain('do not run extra discovery or import probes');
  });

  it('keeps dependencies separate by project and writes pinned constraints', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'masterino-python-env-'));
    try {
      const info = {
        executable: '/app/python',
        sitePackages: '/app/packages',
        version: '3.12',
        venvRoot: root,
        packages: { 'python-pptx': '1.0.2' },
      };
      const first = await prepareProjectPythonEnvironment(info, '/project-one');
      const second = await prepareProjectPythonEnvironment(info, '/project-two');
      expect(first.MASTERINO_PYTHON_ENVIRONMENT).not.toBe(second.MASTERINO_PYTHON_ENVIRONMENT);
      expect(await prepareProjectPythonEnvironment(info, '/project-one')).toEqual(first);
      expect(await readFile(first.PIP_CONSTRAINT, 'utf8')).toBe('python-pptx==1.0.2\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')(
    'retries an unavailable probe instead of caching failure for the process lifetime',
    async () => {
      const probe = vi.spyOn(childProcess, 'execFile').mockImplementation((...args: any[]) => {
        args.at(-1)(new Error('temporary failure'));
        return {} as never;
      });
      try {
        await expect(getBundledPythonInfo()).resolves.toBeUndefined();
        await expect(getBundledPythonInfo()).resolves.toBeUndefined();
        expect(probe).toHaveBeenCalledTimes(2);
      } finally {
        probe.mockRestore();
      }
    },
  );

  it('does not advertise an interpreter when the runtime is unavailable', () => {
    expect(formatPythonEnvironment(undefined)).toContain('unavailable');
    expect(formatPythonEnvironment(undefined)).not.toContain('python3');
  });
});
