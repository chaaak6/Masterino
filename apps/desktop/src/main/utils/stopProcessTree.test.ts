import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, it } from 'vitest';

import { stopProcessTree } from './stopProcessTree';

it('waits for owned descendants that ignore termination without killing another process', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const p = require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], {stdio:'ignore'});
    console.log(p.pid); setInterval(()=>{},1000);
  `,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const independent = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  let descendant: number | undefined;
  try {
    descendant = Number(String((await once(child.stdout!, 'data'))[0]).trim());
    expect(descendant).toBeGreaterThan(1);
    await stopProcessTree(child.pid!, async () => {
      child.kill();
    });
    expect(() => process.kill(child.pid!, 0)).toThrow();
    expect(() => process.kill(descendant!, 0)).toThrow();
    expect(() => process.kill(independent.pid!, 0)).not.toThrow();
  } finally {
    child.kill('SIGKILL');
    independent.kill('SIGKILL');
    if (descendant)
      try {
        process.kill(descendant, 'SIGKILL');
      } catch {
        /* exited */
      }
  }
}, 15000);
