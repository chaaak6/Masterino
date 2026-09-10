import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadWorkspaceEnvFiles } from '../env/workspaceEnvFiles';
import type {
  DeviceExecutionAccessRoot,
  DeviceToolCallExecutionContext,
  ExecutionBoundaryErrorCode,
  ExecutionBoundaryTrace,
  PathAccessMode,
  PreparedToolCallExecution,
  ScopeAuditEntry,
  ScopeVerdict,
} from '../types';

const CREDENTIAL_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.npmrc',
  '.pypirc',
  'credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'known_hosts',
  'netrc',
]);

const PRIVATE_KEY_BASENAMES = new Set(['id_dsa', 'id_ecdsa', 'id_ed25519', 'id_rsa']);

const SENSITIVE_ROOT_SEGMENTS = [['.gnupg'], ['.ssh'], ['Library', 'Keychains']] as const;

const LOCAL_SYSTEM_APIS = new Set([
  'createProjectSkill',
  'updateProjectSkill',
  'renameProjectSkill',
  'deleteProjectSkill',
  'validateProjectSkill',
  'packProjectSkill',
  'batchOfficeDocument',
  'mergeOfficeTemplate',
  'validateOfficeDocument',
  'editFile',
  'editLocalFile',
  'globFiles',
  'globLocalFiles',
  'grepContent',
  'listFiles',
  'listLocalFiles',
  'moveFiles',
  'moveLocalFiles',
  'createOfficeDocument',
  'inspectOfficeDocument',
  'prepareProjectSkillSnapshot',
  'readOfficeDocument',
  'readFile',
  'readFiles',
  'readLocalFile',
  'renameLocalFile',
  'runCommand',
  'runHeteroTask',
  'searchFiles',
  'searchLocalFiles',
  'writeFile',
  'writeLocalFile',
]);

interface PathRequest {
  apply: (args: Record<string, any>, resolvedPath: string) => void;
  mode: PathAccessMode;
  value: string;
}

interface PrepareToolCallExecutionOptions {
  /**
   * Device-local mount containers approved by the native client. These are
   * deliberately not carried in the server-authored execution context: the
   * device remains the authority for whether an explicit direct-message path
   * outside HOME belongs to one of its trusted mounts.
   */
  allowedMountRoots?: readonly string[];
  apiName: string;
  args: Record<string, any>;
  context?: DeviceToolCallExecutionContext;
  homeDir?: string;
  now?: Date;
  trace?: ExecutionBoundaryTrace;
}

/** Error safe to put on the device wire: it carries no content or env values. */
export class ExecutionBoundaryError extends Error {
  readonly code: ExecutionBoundaryErrorCode;
  readonly scopeAudit: ScopeAuditEntry[];

  constructor(code: ExecutionBoundaryErrorCode, scopeAudit: ScopeAuditEntry[] = []) {
    super(code);
    this.name = 'ExecutionBoundaryError';
    this.code = code;
    this.scopeAudit = scopeAudit;
  }
}

const expandHome = (value: string, homeDir: string): string => {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
};

const toAbsolutePath = (value: string, cwd: string, homeDir: string): string => {
  const expanded = expandHome(value, homeDir);
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded));
};

/**
 * Resolve an existing target, or for a prospective write resolve its nearest
 * existing ancestor before appending the missing suffix. This catches symlink
 * escapes without preventing creation of a new file.
 */
const realpathForAccess = async (target: string): Promise<string> => {
  const missing: string[] = [];
  let current = target;

  while (true) {
    try {
      await access(current, constants.F_OK);
      const existing = await realpath(current);
      return path.resolve(existing, ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new ExecutionBoundaryError('SCOPE_DENIED');
      missing.push(path.basename(current));
      current = parent;
    }
  }
};

const isWithin = (target: string, root: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const pathSegments = (target: string): string[] =>
  path.resolve(target).split(path.sep).filter(Boolean);

const containsSegments = (segments: string[], needle: readonly string[]): boolean =>
  segments.some((_, index) => needle.every((part, offset) => segments[index + offset] === part));

const isSensitiveRoot = (root: string, homeDir: string): boolean => {
  const normalizedRoot = path.resolve(root);
  if (
    normalizedRoot === path.parse(normalizedRoot).root ||
    normalizedRoot === path.resolve(homeDir)
  ) {
    return true;
  }

  const segments = pathSegments(normalizedRoot);
  return SENSITIVE_ROOT_SEGMENTS.some((needle) => containsSegments(segments, needle));
};

const SENSITIVE_SYSTEM_ROOTS = new Set([
  '/Applications',
  '/Library',
  '/System',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/private',
  '/proc',
  '/root',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
]);

/**
 * Canonicalize the device-owned mount allowlist before it participates in an
 * authorization decision. Invalid, missing, relative, over-broad, and
 * sensitive roots fail closed by being omitted.
 */
const normalizeAllowedMountRoots = async (
  roots: readonly string[],
  homeDir: string,
): Promise<string[]> => {
  const normalized = await Promise.all(
    roots.map(async (root) => {
      if (typeof root !== 'string' || !path.isAbsolute(root)) return;
      const canonical = await realpath(root).catch(() => undefined);
      if (!canonical || isSensitiveRoot(canonical, homeDir)) return;
      if (SENSITIVE_SYSTEM_ROOTS.has(path.resolve(canonical))) return;
      return path.resolve(canonical);
    }),
  );

  return [...new Set(normalized.filter((root): root is string => Boolean(root)))];
};

const isCredentialPath = (target: string): boolean => {
  const normalized = target.replaceAll('\\', '/');
  const basename = path.basename(target).toLowerCase();
  if (CREDENTIAL_BASENAMES.has(basename)) return true;
  if (/\.env(?:\.[^/]+)?$/i.test(basename)) return true;
  return /(?:^|\/)\.aws\/credentials$/i.test(normalized);
};

const deniedAudit = (
  trace: ExecutionBoundaryTrace,
  mode: PathAccessMode,
  target: string,
): ScopeAuditEntry => ({ ...trace, mode, path: target, scopeVerdict: 'denied' });

const verdictForRoot = (
  root: DeviceExecutionAccessRoot,
  trace: ExecutionBoundaryTrace,
  now: Date,
): ScopeVerdict | undefined => {
  if (root.scope === 'primary') return root.source === 'workspace' ? 'primary' : undefined;

  if (root.scope === 'operation') {
    if (!root.operationId || !trace.operationId || root.operationId !== trace.operationId) {
      return undefined;
    }
    if (root.deviceId && (!trace.deviceId || root.deviceId !== trace.deviceId)) return undefined;
    if (root.topicId && (!trace.topicId || root.topicId !== trace.topicId)) return undefined;
    return root.source === 'direct-user-message' || root.source === 'user-approval'
      ? `consent:${trace.operationId}`
      : undefined;
  }

  if (
    root.source !== 'user-approval' ||
    !root.grantId ||
    !root.deviceId ||
    !root.topicId ||
    !trace.deviceId ||
    !trace.topicId ||
    root.deviceId !== trace.deviceId ||
    root.topicId !== trace.topicId
  ) {
    return undefined;
  }

  if (root.expiresAt) {
    const expiresAt = Date.parse(root.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return undefined;
  }

  return `grant:${root.grantId}`;
};

const authorizePath = async ({
  context,
  credentialRead,
  homeDir,
  mode,
  now,
  allowedMountRoots,
  target,
  trace,
}: {
  context: DeviceToolCallExecutionContext;
  credentialRead: boolean;
  homeDir: string;
  mode: PathAccessMode;
  now: Date;
  allowedMountRoots: readonly string[];
  target: string;
  trace: ExecutionBoundaryTrace;
}): Promise<ScopeAuditEntry> => {
  if (
    PRIVATE_KEY_BASENAMES.has(path.basename(target).toLowerCase()) ||
    SENSITIVE_ROOT_SEGMENTS.some((needle) => containsSegments(pathSegments(target), needle))
  ) {
    throw new ExecutionBoundaryError('SCOPE_DENIED', [deniedAudit(trace, mode, target)]);
  }

  const autoApprove =
    context.approvalMode === 'auto-run' || context.approvalMode === 'headless';

  const roots = [...(context.accessRoots ?? [])];
  if (!roots.some((root) => root.scope === 'primary') && context.cwd) {
    roots.unshift({
      modes: ['read', 'write', 'exec'],
      rootPath: context.cwd,
      scope: 'primary',
      source: 'workspace',
    });
  }

  const candidates: Array<{
    /** Device-canonical realpath of the root, not the declared/lexical value. */
    realRoot: string;
    root: DeviceExecutionAccessRoot;
    verdict: ScopeVerdict;
  }> = [];
  let rejectedScopedRoot = false;
  for (const root of roots) {
    const rootPath = toAbsolutePath(root.rootPath, context.cwd!, homeDir);
    let realRoot: string;
    try {
      realRoot = await realpath(rootPath);
    } catch {
      continue;
    }
    if (root.scope === 'operation' && root.source === 'direct-user-message') {
      const isHomeDescendant = realRoot !== homeDir && isWithin(realRoot, homeDir);
      const isAllowedMountDescendant = allowedMountRoots.some(
        (mountRoot) => realRoot !== mountRoot && isWithin(realRoot, mountRoot),
      );
      if (!isHomeDescendant && !isAllowedMountDescendant) continue;
    }
    const matches = root.target === 'file' ? target === realRoot : isWithin(target, realRoot);
    if (isSensitiveRoot(realRoot, homeDir) || !matches) continue;
    // A selected file never grants shell execution or becomes the workspace root.
    if (root.target === 'file' && (mode === 'exec' || root.scope === 'primary')) continue;
    // Attachments expand the readable set only. Write/exec still need a user grant,
    // auto-run, or a fresh path-consent card — do not fail-closed here.
    if (root.scope === 'operation' && root.source === 'direct-user-message' && mode !== 'read') {
      continue;
    }

    if (root.scope === 'primary') {
      const realCwd = await realpath(context.cwd!);
      if (realRoot !== realCwd) continue;
      if (context.workspaceRootPath) {
        const realWorkspaceRoot = await realpath(context.workspaceRootPath).catch(() => undefined);
        if (!realWorkspaceRoot || realWorkspaceRoot !== realCwd) continue;
      }
    }

    const verdict = verdictForRoot(root, trace, now);
    if (verdict) candidates.push({ realRoot, root, verdict });
    else if (root.scope !== 'primary') rejectedScopedRoot = true;
  }

  if (credentialRead) {
    const approved = candidates.find(
      ({ root }) => root.scope === 'operation' && root.source === 'user-approval',
    );
    if (!approved) {
      throw new ExecutionBoundaryError('INTERVENTION_REQUIRED', [deniedAudit(trace, mode, target)]);
    }
    return {
      ...trace,
      mode,
      path: target,
      rootPath: approved.realRoot,
      scopeVerdict: approved.verdict,
      source: approved.root.source,
    };
  }

  const preferred =
    candidates.find(({ root }) => root.scope === 'primary') ??
    candidates.find(({ root }) => root.scope === 'operation') ??
    candidates[0];
  if (!preferred) {
    // Shell stays pinned to the primary workspace. Auto-run is not a sandbox escape.
    if (mode === 'exec') {
      throw new ExecutionBoundaryError('SCOPE_DENIED', [deniedAudit(trace, mode, target)]);
    }
    if (autoApprove) {
      return {
        ...trace,
        mode,
        path: target,
        rootPath: target,
        scopeVerdict: 'auto-run',
        source: 'auto-run',
      };
    }
    // A root that covers the path but has stale/incomplete tuple evidence is
    // an authorization failure, not an invitation to mint a fresh consent.
    if (rejectedScopedRoot) {
      throw new ExecutionBoundaryError('SCOPE_DENIED', [deniedAudit(trace, mode, target)]);
    }
    throw new ExecutionBoundaryError('INTERVENTION_REQUIRED', [deniedAudit(trace, mode, target)]);
  }
  return {
    ...trace,
    mode,
    path: target,
    rootPath: preferred.realRoot,
    scopeVerdict: preferred.verdict,
    source: preferred.root.source,
  };
};

const setField = (field: string) => (args: Record<string, any>, value: string) => {
  args[field] = value;
};

const collectPathRequests = (
  apiName: string,
  args: Record<string, any>,
  cwd: string,
): PathRequest[] => {
  switch (apiName) {
    case 'listFiles':
    case 'listLocalFiles':
    case 'inspectOfficeDocument':
    case 'prepareProjectSkillSnapshot':
    case 'readOfficeDocument':
    case 'validateOfficeDocument':
    case 'readFile':
    case 'readLocalFile': {
      return [{ apply: setField('path'), mode: 'read', value: args.path || cwd }];
    }
    case 'readFiles': {
      return Array.isArray(args.paths)
        ? args.paths.map((value: string, index: number) => ({
            apply: (next, resolved) => {
              next.paths[index] = resolved;
            },
            mode: 'read' as const,
            value,
          }))
        : [];
    }
    case 'searchFiles':
    case 'searchLocalFiles': {
      return [
        {
          apply: (next, resolved) => {
            next.scope = resolved;
            next.directory = resolved;
            next.onlyIn = resolved;
          },
          mode: 'read',
          value: args.directory || args.onlyIn || args.scope || cwd,
        },
      ];
    }
    case 'grepContent': {
      return [
        {
          apply: (next, resolved) => {
            next.cwd = resolved;
            next.path = resolved;
            next.scope = resolved;
          },
          mode: 'read',
          value: args.path || args.scope || args.cwd || cwd,
        },
      ];
    }
    case 'globFiles':
    case 'globLocalFiles': {
      return [
        {
          apply: (next, resolved) => {
            next.cwd = resolved;
            next.scope = resolved;
          },
          mode: 'read',
          value: args.scope || args.cwd || cwd,
        },
      ];
    }
    case 'createProjectSkill':
    case 'updateProjectSkill':
    case 'renameProjectSkill':
    case 'deleteProjectSkill': {
      return [{ apply: setField('scope'), mode: 'write', value: cwd }];
    }
    case 'validateProjectSkill':
    case 'packProjectSkill': {
      return [{ apply: setField('scope'), mode: 'read', value: cwd }];
    }
    case 'batchOfficeDocument':
    case 'mergeOfficeTemplate': {
      return [
        { apply: setField('path'), mode: 'read', value: args.path },
        { apply: setField('outputPath'), mode: 'write', value: args.outputPath },
      ];
    }
    case 'createOfficeDocument':
    case 'writeFile':
    case 'writeLocalFile': {
      return [{ apply: setField('path'), mode: 'write', value: args.path }];
    }
    case 'editFile':
    case 'editLocalFile': {
      return [{ apply: setField('file_path'), mode: 'write', value: args.file_path }];
    }
    case 'moveFiles':
    case 'moveLocalFiles': {
      if (!Array.isArray(args.items)) return [];
      return args.items.flatMap((item: Record<string, any>, index: number) =>
        ['oldPath', 'newPath'].map((field) => ({
          apply: (next: Record<string, any>, resolved: string) => {
            next.items[index][field] = resolved;
          },
          mode: 'write' as const,
          value: item[field],
        })),
      );
    }
    case 'renameLocalFile': {
      // Keep relative destinations relative to the frozen workspace; using
      // path.resolve() here would silently consult the host process cwd.
      const destination = path.join(path.dirname(args.path), args.newName);
      return [
        { apply: setField('path'), mode: 'write', value: args.path },
        { apply: () => {}, mode: 'write', value: destination },
      ];
    }
    case 'runCommand':
    case 'runHeteroTask': {
      return [{ apply: setField('cwd'), mode: 'exec', value: cwd }];
    }
    default: {
      return [];
    }
  }
};

/**
 * Strict v2 device adapter. Context-free calls take the explicit legacy branch;
 * context-bearing calls never fall back to process.cwd(), home, or Desktop.
 */
/** Classify before materializing scratch, using the same path fields as the boundary. */
export const toolNeedsDefaultCwd = (
  apiName: string,
  args: Record<string, any>,
  existingScratchRoot?: string,
): boolean => {
  if (!LOCAL_SYSTEM_APIS.has(apiName)) return false;
  if (apiName === 'runCommand' || apiName === 'runHeteroTask') return true;
  const requests = collectPathRequests(apiName, args, '');
  return requests.some(
    ({ value }) =>
      !value ||
      (existingScratchRoot !== undefined &&
        path.isAbsolute(value) &&
        isWithin(value, existingScratchRoot)) ||
      !(
        path.posix.isAbsolute(value) ||
        path.win32.isAbsolute(value) ||
        value.startsWith('~/') ||
        value.startsWith('~\\')
      ),
  );
};

export const prepareToolCallExecution = async <T extends Record<string, any>>({
  allowedMountRoots = [],
  apiName,
  args,
  context,
  homeDir,
  now = new Date(),
  trace = {},
}: PrepareToolCallExecutionOptions & { args: T }): Promise<PreparedToolCallExecution<T>> => {
  if (!context) {
    if (LOCAL_SYSTEM_APIS.has(apiName)) {
      throw new ExecutionBoundaryError('WORKSPACE_REQUIRED');
    }
    return { args, legacy: true, scopeAudit: [], warnings: [] };
  }
  if (!LOCAL_SYSTEM_APIS.has(apiName)) {
    return { args, legacy: false, scopeAudit: [], warnings: [] };
  }
  const resolvedHomeDir = homeDir ?? os.homedir();
  const realHomeDir = await realpath(resolvedHomeDir).catch(() => path.resolve(resolvedHomeDir));
  const realAllowedMountRoots = await normalizeAllowedMountRoots(allowedMountRoots, realHomeDir);
  const declaredCwd = context.cwd?.trim();
  if (declaredCwd && !path.isAbsolute(expandHome(declaredCwd, resolvedHomeDir))) {
    throw new ExecutionBoundaryError('WORKSPACE_REQUIRED');
  }
  const realCwd = declaredCwd
    ? await realpath(expandHome(declaredCwd, realHomeDir)).catch(() => undefined)
    : undefined;
  if (declaredCwd && (!realCwd || isSensitiveRoot(realCwd, realHomeDir))) {
    throw new ExecutionBoundaryError('SCOPE_DENIED', [deniedAudit(trace, 'exec', declaredCwd)]);
  }

  const next = structuredClone(args) as T;
  const warnings: PreparedToolCallExecution['warnings'] = [];
  const modelCwd = typeof args.cwd === 'string' ? args.cwd : undefined;
  if ((apiName === 'runCommand' || apiName === 'runHeteroTask') && modelCwd) {
    if (!realCwd) throw new ExecutionBoundaryError('WORKSPACE_REQUIRED');
    const modelAbsolute = toAbsolutePath(modelCwd, realCwd, realHomeDir);
    if (path.resolve(modelAbsolute) !== path.resolve(realCwd)) {
      warnings.push({ code: 'MODEL_CWD_OVERRIDDEN', overridden: true });
    }
  }

  if (apiName === 'runCommand' || apiName === 'runHeteroTask') {
    const fileEnv = await loadWorkspaceEnvFiles({
      envFiles: context.envFiles,
      workspaceRootPath: context.workspaceRootPath ?? realCwd,
    });
    const resolvedEnv = { ...fileEnv, ...context.env };
    if (Object.keys(resolvedEnv).length > 0) (next as Record<string, any>).env = resolvedEnv;
    else delete (next as Record<string, any>).env;
  }

  const filePattern = apiName === 'grepContent' ? next.filePattern : undefined;
  const globPattern =
    apiName === 'globFiles' || apiName === 'globLocalFiles' ? next.pattern : undefined;
  const pathPattern = typeof filePattern === 'string' ? filePattern : globPattern;
  if (
    typeof pathPattern === 'string' &&
    (path.isAbsolute(expandHome(pathPattern, realHomeDir)) ||
      pathPattern.replaceAll('\\', '/').split('/').includes('..'))
  ) {
    throw new ExecutionBoundaryError('SCOPE_DENIED', [
      deniedAudit(trace, 'read', toAbsolutePath(pathPattern, realCwd ?? realHomeDir, realHomeDir)),
    ]);
  }

  const requests = collectPathRequests(apiName, next, realCwd ?? '');
  if (!realCwd) {
    const hasOnlyExplicitAbsoluteRequests =
      requests.length > 0 &&
      requests.every(
        (request) =>
          typeof request.value === 'string' &&
          path.isAbsolute(expandHome(request.value, realHomeDir)),
      );
    if (!hasOnlyExplicitAbsoluteRequests) throw new ExecutionBoundaryError('WORKSPACE_REQUIRED');
  }
  const scopeAudit: ScopeAuditEntry[] = [];
  for (const request of requests) {
    if (typeof request.value !== 'string' || !request.value.trim()) {
      throw new ExecutionBoundaryError('SCOPE_DENIED', scopeAudit);
    }
    const absolute = toAbsolutePath(request.value, realCwd ?? realHomeDir, realHomeDir);
    const realTarget = await realpathForAccess(absolute);
    const audit = await authorizePath({
      context: { ...context, cwd: realCwd },
      credentialRead: request.mode === 'read' && isCredentialPath(realTarget),
      homeDir: realHomeDir,
      mode: request.mode,
      now,
      allowedMountRoots: realAllowedMountRoots,
      target: realTarget,
      trace,
    });
    if (warnings.length > 0 && request.mode === 'exec') audit.cwdOverridden = true;
    request.apply(next, realTarget);
    scopeAudit.push(audit);
  }

  return { args: next, legacy: false, scopeAudit, warnings };
};
