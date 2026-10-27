import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Snapshot descendants before their parent exits, then wait for actual termination. */
export async function stopProcessTree(pid: number, graceful: () => Promise<unknown>) {
  let children: number[] = [];
  if (process.platform === 'win32') {
    const { stdout } = await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
      ],
      { windowsHide: true },
    );
    const rows = JSON.parse(stdout) as { ProcessId: number; ParentProcessId: number }[];
    const owned = new Set([pid]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const row of rows)
        if (owned.has(row.ParentProcessId) && !owned.has(row.ProcessId)) {
          owned.add(row.ProcessId);
          changed = true;
        }
    }
    children = [...owned].filter((child) => child !== pid);
  } else {
    const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=']);
    const rows = stdout
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number));
    const owned = new Set([pid]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [child, parent] of rows)
        if (owned.has(parent) && !owned.has(child)) {
          owned.add(child);
          changed = true;
        }
    }
    children = [...owned].filter((child) => child !== pid);
  }
  // Do not let an unresponsive protocol close hide the process cleanup deadline.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      graceful().catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 1500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (process.platform === 'win32') {
    // taskkill operates on this exact owned PID tree, not an executable name.
    for (const owned of [...children, pid]) {
      try {
        await execute(
          path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(owned), '/T', '/F'],
          { windowsHide: true },
        );
      } catch {
        /* graceful close may already have exited */
      }
    }
  } else {
    for (const owned of [...children, pid]) {
      try {
        process.kill(owned, 'SIGTERM');
      } catch {
        /* already exited */
      }
    }
    await delay(300);
    for (const owned of [...children, pid]) {
      try {
        process.kill(owned, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
  }
  const owned = [...children, pid];
  for (let attempt = 0; attempt < 50; attempt++) {
    if (process.platform === 'win32') {
      if (
        !owned.some((id) => {
          try {
            process.kill(id, 0);
            return true;
          } catch {
            return false;
          }
        })
      )
        return;
    } else {
      const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,stat=']);
      const live = stdout
        .trim()
        .split('\n')
        .some((line) => {
          const [id, state] = line.trim().split(/\s+/);
          return owned.includes(Number(id)) && !state.startsWith('Z');
        });
      if (!live) return;
    }
    await delay(100);
  }
  throw new Error('A managed process did not stop; installation was not started');
}
