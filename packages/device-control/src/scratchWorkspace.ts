import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  CleanupScratchWorkspaceParams,
  CleanupScratchWorkspaceResult,
  EnsureScratchWorkspaceParams,
  EnsureScratchWorkspaceResult,
} from './types';

const toSafeTopicSegment = (topicId: unknown): string => {
  if (typeof topicId !== 'string') throw new Error('topicId is required');
  const trimmed = topicId.trim();
  if (/^[A-Z0-9][\w.-]{0,127}$/i.test(trimmed) && trimmed !== '.' && trimmed !== '..') {
    return trimmed;
  }
  if (!trimmed) throw new Error('topicId is required');
  return `topic-${createHash('sha256').update(trimmed).digest('hex').slice(0, 32)}`;
};

const assertSafeScratchRoot = (root: string): void => {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) {
    throw new Error('SCOPE_DENIED');
  }
};

/** Read only: resolve this topic's existing directory without accepting topic aliases. */
export const getExistingScratchWorkspace = async (topicId: string, scratchRoot: string) => {
  if (!path.isAbsolute(scratchRoot)) throw new Error('SCRATCH_ROOT_REQUIRED');
  assertSafeScratchRoot(scratchRoot);
  const realRoot = await realpath(scratchRoot);
  assertSafeScratchRoot(realRoot);
  const requested = path.join(realRoot, toSafeTopicSegment(topicId));
  const info = await lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('SCOPE_DENIED');
  const root = await realpath(requested);
  if (root !== requested) throw new Error('SCOPE_DENIED');
  const relative = path.relative(realRoot, root);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('SCOPE_DENIED');
  }
  return { root };
};

export const ensureScratchWorkspace = async (
  params: EnsureScratchWorkspaceParams | string,
  scratchRoot: string | undefined,
): Promise<EnsureScratchWorkspaceResult> => {
  if (!scratchRoot || !path.isAbsolute(scratchRoot)) {
    throw new Error('SCRATCH_ROOT_REQUIRED');
  }

  const normalizedRoot = path.resolve(scratchRoot);
  assertSafeScratchRoot(normalizedRoot);

  const topicId = typeof params === 'string' ? params : params?.topicId;
  const topicSegment = toSafeTopicSegment(topicId);

  await mkdir(normalizedRoot, { recursive: true });
  const realRoot = await realpath(normalizedRoot);
  assertSafeScratchRoot(realRoot);
  const requested = path.join(realRoot, topicSegment);
  await mkdir(requested, { recursive: true });
  const existing = await getExistingScratchWorkspace(topicId, normalizedRoot);
  return { root: existing.root, topicSegment };
};

/**
 * Delete only the deterministic topic directory below a host-configured root.
 * A persisted pre-migration root is accepted only when it exactly matches a
 * deterministic topic path below an explicitly allowed legacy root.
 */
export const cleanupScratchWorkspace = async (
  params: CleanupScratchWorkspaceParams,
  scratchRoot: string | undefined,
  legacyScratchRoots: string[] = [],
): Promise<CleanupScratchWorkspaceResult> => {
  if (!scratchRoot || !path.isAbsolute(scratchRoot)) throw new Error('SCRATCH_ROOT_REQUIRED');

  const topicSegment = toSafeTopicSegment(params?.topicId);
  let selectedRoot = scratchRoot;
  if (params.expectedRoot) {
    if (!path.isAbsolute(params.expectedRoot)) throw new Error('SCOPE_DENIED');
    const expectedRoot = path.resolve(params.expectedRoot);
    selectedRoot = '';

    for (const candidate of [scratchRoot, ...legacyScratchRoots]) {
      if (!path.isAbsolute(candidate)) throw new Error('SCRATCH_ROOT_REQUIRED');
      const normalizedCandidate = path.resolve(candidate);
      assertSafeScratchRoot(normalizedCandidate);

      let canonicalCandidate = normalizedCandidate;
      try {
        canonicalCandidate = await realpath(normalizedCandidate);
        assertSafeScratchRoot(canonicalCandidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      if (path.join(canonicalCandidate, topicSegment) === expectedRoot) {
        selectedRoot = normalizedCandidate;
        break;
      }
    }

    if (!selectedRoot) throw new Error('SCOPE_DENIED');
  }

  const normalizedRoot = path.resolve(selectedRoot);
  assertSafeScratchRoot(normalizedRoot);

  let realRoot: string;
  try {
    realRoot = await realpath(normalizedRoot);
    assertSafeScratchRoot(realRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { removed: false, root: path.join(normalizedRoot, topicSegment), topicSegment };
  }

  const requested = path.join(realRoot, topicSegment);
  const relative = path.relative(realRoot, requested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('SCOPE_DENIED');
  }

  try {
    await lstat(requested);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { removed: false, root: requested, topicSegment };
  }

  await rm(requested, { force: true, recursive: true });
  return { removed: true, root: requested, topicSegment };
};
