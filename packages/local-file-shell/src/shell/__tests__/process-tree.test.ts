import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ShellProcessManager } from '../process-manager';
import { runCommand } from '../runner';

describe('command process trees', () => {
  for (const action of ['kill', 'cleanupAll'] as const) {
    it(`${action} stops descendants without stopping another command`, async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'masterino-process-tree-'));
      const child = path.join(directory, 'child.cjs');
      const parent = path.join(directory, 'parent.cjs');
      const ready = path.join(directory, 'ready');
      const parentReady = path.join(directory, 'parent-ready');
      const unexpected = path.join(directory, 'unexpected');
      const independent = path.join(directory, 'independent');
      const manager = new ShellProcessManager();
      let childPid: number | undefined;
      const control = spawn(process.execPath, [
        '-e',
        `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(independent)}, 'ok'), 600)`,
      ]);
      try {
        await writeFile(
          child,
          `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(unexpected)}, 'not cancelled'), 1500);`,
        );
        await writeFile(
          parent,
          `require('node:fs').writeFileSync(${JSON.stringify(parentReady)}, String(process.pid)); require('node:child_process').spawn(process.execPath, [${JSON.stringify(child)}], {stdio: 'inherit'}); setInterval(() => {}, 1000);`,
        );
        const result = await runCommand(
          {
            command: `node "${parent}" ${process.platform === 'win32' ? '&' : ';'} echo shell-ended`,
            run_in_background: true,
          },
          { processManager: manager },
        );
        await expect
          .poll(
            async () => {
              childPid = Number(await readFile(ready, 'utf8').catch(() => '0')) || undefined;
              return childPid;
            },
            { timeout: 5000 },
          )
          .toBeTruthy();
        if (action === 'kill') expect(manager.kill(result.shell_id!).success).toBe(true);
        else manager.cleanupAll();
        await new Promise((resolve) => setTimeout(resolve, 1800));
        expect(await readFile(unexpected, 'utf8').catch(() => undefined)).toBeUndefined();
        expect(await readFile(independent, 'utf8')).toBe('ok');
      } finally {
        manager.cleanupAll();
        control.kill();
        if (childPid) {
          try {
            process.kill(childPid);
          } catch {
            /* already stopped */
          }
        }
        const parentPid = Number(await readFile(parentReady, 'utf8').catch(() => '0'));
        if (parentPid) {
          try {
            process.kill(parentPid);
          } catch {
            /* already stopped */
          }
        }
        await rm(directory, { force: true, recursive: true });
      }
    }, 10_000);
  }
});
