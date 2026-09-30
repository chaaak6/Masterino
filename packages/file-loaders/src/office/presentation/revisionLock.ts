import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { PresentationProject, RevisePresentationParams } from './types';

const REVISION_LOCK_STALE_MS = 10 * 60_000;
const activeRevisionLocks = new Set<string>();

export interface RevisionTransaction {
  id: string;
  mode: 'create' | 'replace';
  newArtifactSha256: string;
  oldArtifactSha256: string;
  outputPath: string;
  projectPath: string;
}

interface RevisionLockState {
  createdAt: number;
  hostname: string;
  pid: number;
  token: string;
  transaction?: RevisionTransaction;
  version: 1;
}

export interface RevisionLock {
  path: string;
  state: RevisionLockState;
}

export const sha256File = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

export const transactionPaths = (transaction: RevisionTransaction) => ({
  backupOutput: path.join(
    path.dirname(transaction.outputPath),
    `.masterino-presentation-${transaction.id}.backup.pptx`,
  ),
  backupProject: path.join(
    path.dirname(transaction.projectPath),
    `.masterino-presentation-${transaction.id}.backup.json`,
  ),
  tempOutput: path.join(
    path.dirname(transaction.outputPath),
    `.masterino-presentation-${transaction.id}.pptx`,
  ),
  tempProject: path.join(
    path.dirname(transaction.projectPath),
    `.masterino-presentation-${transaction.id}.json`,
  ),
});

const validTransaction = (
  transaction: RevisionTransaction | undefined,
  params: RevisePresentationParams,
): transaction is RevisionTransaction =>
  !!transaction &&
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(transaction.id) &&
  ['create', 'replace'].includes(transaction.mode) &&
  /^[\da-f]{64}$/i.test(transaction.newArtifactSha256) &&
  /^[\da-f]{64}$/i.test(transaction.oldArtifactSha256) &&
  path.resolve(transaction.outputPath) === path.resolve(params.outputPath) &&
  path.resolve(transaction.projectPath) === path.resolve(params.projectPath);

export const writeRevisionLock = async (lock: RevisionLock) => {
  const temp = `${lock.path}.${lock.state.token}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(lock.state)}\n`, { flag: 'wx' });
    await rename(temp, lock.path);
  } finally {
    await rm(temp, { force: true });
  }
};

export const cleanupRevisionTransaction = async (transaction: RevisionTransaction) => {
  const paths = transactionPaths(transaction);
  await Promise.all(Object.values(paths).map((target) => rm(target, { force: true })));
};

const projectArtifactSha = async (projectPath: string) => {
  try {
    const value = JSON.parse(await readFile(projectPath, 'utf8')) as PresentationProject;
    return typeof value.artifact?.sha256 === 'string' ? value.artifact.sha256 : undefined;
  } catch {
    return;
  }
};

const recoverRevisionTransaction = async (
  transaction: RevisionTransaction,
  params: RevisePresentationParams,
) => {
  if (!validTransaction(transaction, params)) {
    throw new Error('PRESENTATION_REVISION_RECOVERY_REQUIRED');
  }
  const paths = transactionPaths(transaction);
  const [outputSha, projectSha] = await Promise.all([
    sha256File(transaction.outputPath).catch(() => undefined),
    projectArtifactSha(transaction.projectPath),
  ]);
  if (outputSha === transaction.newArtifactSha256 && projectSha === transaction.newArtifactSha256) {
    await cleanupRevisionTransaction(transaction);
    return;
  }
  if (projectSha === transaction.newArtifactSha256) {
    await rename(paths.backupProject, transaction.projectPath);
  } else if (projectSha !== transaction.oldArtifactSha256) {
    throw new Error('PRESENTATION_REVISION_RECOVERY_REQUIRED');
  }
  if (transaction.mode === 'create') {
    if (outputSha === transaction.newArtifactSha256) {
      await rm(transaction.outputPath);
    } else if (outputSha !== undefined) {
      throw new Error('PRESENTATION_REVISION_RECOVERY_REQUIRED');
    }
  } else if (outputSha === transaction.newArtifactSha256) {
    await rename(paths.backupOutput, transaction.outputPath);
  } else if (outputSha !== transaction.oldArtifactSha256) {
    throw new Error('PRESENTATION_REVISION_RECOVERY_REQUIRED');
  }
  await cleanupRevisionTransaction(transaction);
};

const readRevisionLock = async (lockPath: string): Promise<RevisionLockState | undefined> => {
  try {
    const value = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<RevisionLockState>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.pid) ||
      value.pid! <= 0 ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt! <= 0 ||
      typeof value.hostname !== 'string' ||
      !value.hostname ||
      typeof value.token !== 'string' ||
      !value.token
    )
      return;
    return value as RevisionLockState;
  } catch {
    return;
  }
};

const revisionLockIsStale = async (lockPath: string, state?: RevisionLockState) => {
  if (!state) {
    const lockStat = await stat(lockPath).catch(() => undefined);
    return !!lockStat && Date.now() - lockStat.mtimeMs > REVISION_LOCK_STALE_MS;
  }
  if (activeRevisionLocks.has(state.token)) return false;
  if (state.hostname !== os.hostname()) {
    return Date.now() - state.createdAt > REVISION_LOCK_STALE_MS;
  }
  if (state.pid === process.pid) return true;
  try {
    process.kill(state.pid, 0);
    return Date.now() - state.createdAt > REVISION_LOCK_STALE_MS;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
};

export const acquireRevisionLock = async (
  lockPath: string,
  params: RevisePresentationParams,
): Promise<RevisionLock> => {
  const state: RevisionLockState = {
    createdAt: Date.now(),
    hostname: os.hostname(),
    pid: process.pid,
    token: randomUUID(),
    version: 1,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(lockPath, `${JSON.stringify(state)}\n`, { flag: 'wx' });
      activeRevisionLocks.add(state.token);
      return { path: lockPath, state };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readRevisionLock(lockPath);
      if (!(await revisionLockIsStale(lockPath, existing))) {
        throw new Error('PRESENTATION_REVISION_BUSY', { cause: error });
      }
      const latest = await readRevisionLock(lockPath);
      if (existing?.token !== latest?.token) {
        throw new Error('PRESENTATION_REVISION_BUSY', { cause: error });
      }
      if (existing?.transaction) await recoverRevisionTransaction(existing.transaction, params);
      await unlink(lockPath).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
      });
    }
  }
  throw new Error('PRESENTATION_REVISION_BUSY');
};

export const releaseRevisionLock = async (lock: RevisionLock) => {
  activeRevisionLocks.delete(lock.state.token);
  if (lock.state.transaction) return;
  const current = await readRevisionLock(lock.path);
  if (current?.token === lock.state.token) await unlink(lock.path).catch(() => undefined);
};
