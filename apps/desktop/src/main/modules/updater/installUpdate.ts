import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, cp, mkdir, readFile, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, type WebContents } from 'electron';

import type { DesktopUpdateArtifact } from './signedManifest';

const appBundle = () => path.resolve(app.getPath('exe'), '../../..');
const helperBundle = 'Masterino Update.app';
const helperExecutable = path.join('Contents', 'MacOS', 'MasterinoUpdate');

export async function preflightUpdateInstaller(installer: string) {
  await access(installer, constants.R_OK);
  if (!app.isPackaged) throw new Error('Install updates from the packaged test or production App');
  if (process.platform === 'darwin') {
    const target = appBundle();
    if (!target.endsWith('.app'))
      throw new Error('The running application bundle could not be located');
    await access(path.dirname(target), constants.W_OK);
    const [disk, bundle, archive] = await Promise.all([
      statfs(path.dirname(target)),
      stat(target),
      stat(installer),
    ]);
    if (!bundle.isDirectory()) throw new Error('The application bundle is not a directory');
    // DMG compression varies: reserve a conservative working area before stopping tasks.
    if (disk.bavail * disk.bsize < archive.size * 4 + 256 * 1024 * 1024)
      throw new Error('Insufficient disk space to safely stage the update');
    await access(
      path.join(process.resourcesPath, 'updater', helperBundle, helperExecutable),
      constants.X_OK,
    );
  }
}

/** The helper is the sole intentionally surviving child during update shutdown. */
export async function launchUpdateInstaller(
  installer: string,
  artifact: DesktopUpdateArtifact,
  version: string,
) {
  if (process.platform === 'win32') {
    // NSIS owns its visible installation progress. Never use /S or install-on-quit.
    const child = spawn(installer, ['--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return;
  }
  if (process.platform !== 'darwin') throw new Error('This installer supports Windows and macOS');
  const directory = path.join(app.getPath('userData'), 'update-installs', randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, helperBundle);
  await cp(path.join(process.resourcesPath, 'updater', helperBundle), destination, {
    recursive: true,
  });
  const helper = path.join(destination, helperExecutable);
  await chmod(helper, 0o700);
  const job = path.join(directory, 'request.json');
  await writeFile(
    job,
    JSON.stringify({
      installer,
      target: appBundle(),
      parent: process.pid,
      sha512: artifact.sha512,
      version,
    }),
    { mode: 0o600 },
  );
  const child = spawn(helper, [job], { detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path.join(directory, 'ready'), 'utf8')) === 'ready') return;
    } catch {
      /* helper starting */
    }
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Update helper could not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error('Update helper did not become ready; the application was not closed');
}

/** Called only after the replacement App has completed bootstrap. */
export async function acknowledgeInstalledUpdate(contents?: WebContents | null) {
  const argument = process.argv.indexOf('--masterino-update-receipt');
  if (argument < 0 || !process.argv[argument + 1]) return;
  const directory = path.resolve(process.argv[argument + 1]);
  const root = path.join(app.getPath('userData'), 'update-installs');
  if (path.dirname(directory) !== root) return;
  const job = JSON.parse(await readFile(path.join(directory, 'request.json'), 'utf8'));
  if (job.target !== appBundle() || job.version !== app.getVersion()) return;
  if (!contents || contents.isDestroyed()) throw new Error('Updated App has no main window');
  if (contents.isLoadingMainFrame()) {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        contents.removeListener('did-finish-load', loaded);
        contents.removeListener('render-process-gone', crashed);
        contents.removeListener('did-fail-load', failed);
        if (error) reject(error);
        else resolve();
      };
      const loaded = () => finish();
      const crashed = () => finish(new Error('Updated App renderer exited during startup'));
      const failed = (
        _event: unknown,
        code: number,
        description: string,
        _url: string,
        main: boolean,
      ) => {
        if (main && code !== -3) finish(new Error(`Updated App failed to load: ${description}`));
      };
      const timer = setTimeout(() => finish(new Error('Updated App window did not load')), 60000);
      contents.once('did-finish-load', loaded);
      contents.once('render-process-gone', crashed);
      contents.on('did-fail-load', failed);
    });
  }
  await writeFile(path.join(directory, 'started'), 'started', { mode: 0o600 });
}
