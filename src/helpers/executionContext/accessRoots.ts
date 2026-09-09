import type { ExecutionAccessRoot } from '@lobechat/types/src/executionContext';

import { normalizeRootPath } from './workspaceIdentity';

const normalizeAccessRoot = (root: ExecutionAccessRoot): ExecutionAccessRoot => ({
  ...root,
  modes: [...new Set(root.modes)],
  rootPath: normalizeRootPath(root.rootPath),
});

/**
 * Adds the primary workspace root without allowing operation/topic grants to alter cwd.
 * This only composes already-authorized roots; it does not grant access or perform realpath.
 */
export const buildExecutionAccessRoots = (
  cwd: string | undefined,
  additionalRoots: readonly ExecutionAccessRoot[] = [],
): ExecutionAccessRoot[] | undefined => {
  const normalizedCwd = cwd ? normalizeRootPath(cwd) : undefined;
  const roots = additionalRoots
    .map(normalizeAccessRoot)
    .filter((root) => root.rootPath !== normalizedCwd);

  if (normalizedCwd) {
    roots.unshift({
      modes: ['read', 'write', 'exec'],
      rootPath: normalizedCwd,
      scope: 'primary',
      source: 'workspace',
    });
  }

  if (roots.length === 0) return undefined;

  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = `${root.scope}:${root.target ?? 'directory'}:${root.grantId ?? ''}:${root.rootPath}:${[...root.modes].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
