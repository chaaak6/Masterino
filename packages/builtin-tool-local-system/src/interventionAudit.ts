import { type DynamicInterventionResolver } from '@lobechat/types';

import { normalizePathForScope, resolvePathWithScope } from './utils/path';

const SAFE_PATH_PREFIXES = ['/tmp', '/var/tmp'] as const;
const CREDENTIAL_PATH_PATTERN =
  /(?:^|\/)(?:\.env(?:\.[^/]+)?|\.npmrc|\.pypirc|\.aws\/credentials)$/i;

interface SafePathAuditParams {
  metadata?: Record<string, any>;
  paths: string[];
  resolveAgainstScope: string;
}

interface PathScopeAuditOptions {
  /** Trusted authority resolver; evaluated for every non-credential path. */
  areAllPathsAuthorized?: (params: SafePathAuditParams) => boolean | Promise<boolean>;
  /** Optional convenience resolver for the built-in /tmp and /var/tmp candidates. */
  areAllPathsSafe?: (params: SafePathAuditParams) => boolean | Promise<boolean>;
}

const isWithinPathPrefixes = (targetPath: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => targetPath === prefix || targetPath.startsWith(prefix + '/'));

const isPathWithinWorkingDirectory = (
  targetPath: string,
  workingDirectory: string,
  resolveAgainstScope: string,
): boolean => {
  const resolvedTarget = resolvePathWithScope(targetPath, resolveAgainstScope) ?? targetPath;
  const normalizedTarget = normalizePathForScope(resolvedTarget);
  const normalizedWorkingDir = normalizePathForScope(workingDirectory);

  return (
    normalizedTarget === normalizedWorkingDir ||
    normalizedTarget.startsWith(normalizedWorkingDir + '/')
  );
};

const extractPaths = (toolArgs: Record<string, any>): string[] => {
  const paths: string[] = [];
  const pathParamNames = ['path', 'file_path', 'directory', 'oldPath', 'newPath'];

  for (const paramName of pathParamNames) {
    const pathValue = toolArgs[paramName];
    if (pathValue && typeof pathValue === 'string') {
      paths.push(pathValue);
    }
  }

  if (typeof toolArgs.pattern === 'string' && toolArgs.pattern.startsWith('/')) {
    paths.push(toolArgs.pattern);
  }

  if (Array.isArray(toolArgs.items)) {
    for (const item of toolArgs.items) {
      if (typeof item === 'object') {
        if (item.oldPath) paths.push(item.oldPath);
        if (item.newPath) paths.push(item.newPath);
      }
    }
  }

  if (Array.isArray(toolArgs.paths)) {
    for (const currentPath of toolArgs.paths) {
      if (typeof currentPath === 'string') paths.push(currentPath);
    }
  }

  return paths;
};

const areAllPathsSafeCandidates = (paths: string[], resolveAgainstScope: string): boolean => {
  if (paths.length === 0) return false;

  return paths.every((currentPath) => {
    const resolvedPath = resolvePathWithScope(currentPath, resolveAgainstScope) ?? currentPath;
    const normalizedPath = normalizePathForScope(resolvedPath);

    return isWithinPathPrefixes(normalizedPath, SAFE_PATH_PREFIXES);
  });
};

export const createPathScopeAudit = (
  options: PathScopeAuditOptions = {},
): DynamicInterventionResolver => {
  const { areAllPathsAuthorized, areAllPathsSafe } = options;

  return async (
    toolArgs: Record<string, any>,
    metadata?: Record<string, any>,
  ): Promise<boolean> => {
    const workingDirectory = metadata?.workingDirectory as string | undefined;
    const toolScope = toolArgs.scope as string | undefined;

    if (!workingDirectory) {
      return false;
    }

    if (toolScope && !isPathWithinWorkingDirectory(toolScope, workingDirectory, workingDirectory)) {
      return true;
    }

    const effectiveScope =
      resolvePathWithScope(toolScope, workingDirectory) ?? toolScope ?? workingDirectory;

    const paths = extractPaths(toolArgs);

    const containsCredentialRead = paths.some((currentPath) => {
      const resolvedPath = resolvePathWithScope(currentPath, effectiveScope) ?? currentPath;
      return CREDENTIAL_PATH_PATTERN.test(normalizePathForScope(resolvedPath));
    });
    if (containsCredentialRead) return true;

    if (
      areAllPathsAuthorized &&
      (await areAllPathsAuthorized({ metadata, paths, resolveAgainstScope: effectiveScope }))
    ) {
      return false;
    }

    const isLegacyMetadata =
      metadata?.pathAccessMode === undefined && metadata?.pathSource === undefined;
    const isStructuredDirectReadConsent =
      metadata?.pathAccessMode === 'read' && metadata?.pathSource === 'direct-user-message';
    if (
      areAllPathsSafe &&
      // Preserve context-free clients on the explicit legacy path. V2 callers
      // provide both metadata fields and only direct, structured reads qualify.
      (isLegacyMetadata || isStructuredDirectReadConsent) &&
      areAllPathsSafeCandidates(paths, effectiveScope)
    ) {
      const allSafe = await areAllPathsSafe({
        metadata,
        paths,
        resolveAgainstScope: effectiveScope,
      });
      if (allSafe) return false;
    }

    return paths.some(
      (currentPath) => !isPathWithinWorkingDirectory(currentPath, workingDirectory, effectiveScope),
    );
  };
};

export const pathScopeAudit = createPathScopeAudit();
