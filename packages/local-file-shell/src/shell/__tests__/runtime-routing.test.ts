import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ShellProcessManager } from '../process-manager';
import { runCommand } from '../runner';

const python = process.env.MASTERINO_TEST_PYTHON;

describe.runIf(!!python)('packaged Python command routing', () => {
  it('runs spaced script paths and leaves ordinary node/git environments unchanged', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'masterino runtime spaces '));
    const manager = new ShellProcessManager();
    const normal = async () => {
      const node = await runCommand(
        {
          command:
            'node -p "JSON.stringify({executable:process.execPath,path:process.env.PATH,bytecode:process.env.PYTHONDONTWRITEBYTECODE})"',
          cwd,
        },
        { processManager: manager },
      );
      expect(node.success).toBe(true);
      expect(node.exit_code).toBe(0);
      const git = await runCommand({ command: 'git --version', cwd }, { processManager: manager });
      expect(git.success).toBe(true);
      expect(git.exit_code).toBe(0);
      expect(git.stdout).toContain('git version');
      return JSON.parse(node.stdout!.trim());
    };
    try {
      const before = await normal();
      const script = path.join(cwd, 'build slides 中文.py');
      await writeFile(
        script,
        'import json, sys\nfrom pathlib import Path\nimport pptx\nPath("result.txt").write_text(sys.argv[1], encoding="utf-8")\nprint(json.dumps({"isolated":sys.flags.isolated,"bytecode":sys.dont_write_bytecode,"executable":sys.executable,"package":pptx.__file__}))\n',
      );
      const result = await runCommand(
        { command: script, runtime: 'bundled-python', cwd },
        {
          processManager: manager,
          executable: {
            path: python!,
            args: ['-I', '-B', '-X', 'utf8', script, '中文 argument with spaces'],
          },
        },
      );
      expect(result.success).toBe(true);
      expect(result.exit_code).toBe(0);
      const info = JSON.parse(result.stdout!.trim());
      expect(info.isolated).toBe(1);
      expect(info.bytecode).toBe(true);
      expect(info.package).toContain('python-runtime');
      expect(await readFile(path.join(cwd, 'result.txt'), 'utf8')).toBe(
        '中文 argument with spaces',
      );
      expect(await normal()).toEqual(before);
      expect(before.path.toLowerCase()).not.toContain('python-runtime');
    } finally {
      await manager.cleanupAll();
      await rm(cwd, { force: true, recursive: true });
    }
  }, 20_000);
});
