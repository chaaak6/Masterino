import type {
  ExecutionAccessRoot,
  ExecutionContext,
  PathAccessMode,
} from '@lobechat/types/src/executionContext';
import path from 'pathe';

import { isAbsoluteFilesystemPath, normalizeRootPath } from './workspaceIdentity';

const READ_APIS = new Set([
  'globFiles',
  'globLocalFiles',
  'grepContent',
  'listFiles',
  'listLocalFiles',
  'readFile',
  'readFiles',
  'readLocalFile',
  'searchFiles',
  'searchLocalFiles',
]);
const WRITE_APIS = new Set([
  'editFile',
  'editLocalFile',
  'moveFiles',
  'moveLocalFiles',
  'renameLocalFile',
  'writeFile',
  'writeLocalFile',
]);

const getMode = (apiName: unknown): PathAccessMode | undefined => {
  if (typeof apiName !== 'string') return;
  if (READ_APIS.has(apiName)) return 'read';
  if (WRITE_APIS.has(apiName)) return 'write';
};

const getFlavor = (value: string) => (/^[A-Z]:[\\/]/i.test(value) ? path.win32 : path.posix);

const resolveTarget = (value: string, scope: string): string | undefined => {
  const flavor = getFlavor(value || scope);
  const target = flavor.isAbsolute(value) ? value : flavor.resolve(scope, value);
  return isAbsoluteFilesystemPath(target) ? normalizeRootPath(target) : undefined;
};

const isWithin = (target: string, root: string): boolean => {
  const flavor = getFlavor(root);
  if (!flavor.isAbsolute(root) || !flavor.isAbsolute(target)) return false;
  const relative = flavor.relative(flavor.resolve(root), flavor.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !flavor.isAbsolute(relative));
};

const rootCovers = (
  root: ExecutionAccessRoot,
  target: string,
  mode: PathAccessMode,
  deviceId: string,
  now: number,
): boolean => {
  if (root.deviceId && root.deviceId !== deviceId) return false;
  if (!root.modes.includes(mode)) return false;
  if (root.expiresAt) {
    const expiresAt = Date.parse(root.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  }
  if (root.scope === 'operation' && root.source === 'direct-user-message' && mode !== 'read') {
    return false;
  }

  const normalizedRoot = normalizeRootPath(root.rootPath);
  return root.target === 'file' ? target === normalizedRoot : isWithin(target, normalizedRoot);
};

/**
 * Suppresses only the renderer's redundant pre-dispatch prompt. The Electron
 * execution boundary still canonicalizes and validates the same roots before
 * touching the filesystem.
 */
export const arePathsCoveredByExecutionContext = (input: {
  apiName: unknown;
  context?: ExecutionContext;
  now?: number;
  paths: string[];
  resolveAgainstScope: string;
}): boolean => {
  const { context } = input;
  const mode = getMode(input.apiName);
  if (
    !mode ||
    !context ||
    context.plan.kind !== 'device' ||
    input.paths.length === 0 ||
    !isAbsoluteFilesystemPath(input.resolveAgainstScope)
  ) {
    return false;
  }

  const targets = input.paths.map((value) => resolveTarget(value, input.resolveAgainstScope));
  if (targets.some((target) => !target)) return false;

  const roots = context.accessRoots ?? [];
  const deviceId = context.plan.deviceId;
  const now = input.now ?? Date.now();
  return targets.every((target) =>
    roots.some((root) => rootCovers(root, target!, mode, deviceId, now)),
  );
};
