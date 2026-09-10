import path from 'node:path';

import { LocalSystemIdentifier, pathScopeAudit } from '@lobechat/builtin-tool-local-system';
import type { LobeToolManifest } from '@lobechat/context-engine';
import type { ChatToolPayload, DynamicInterventionResolver } from '@lobechat/types';
import type {
  ExecutionAccessRoot,
  ExecutionContext,
  PathAccessMode,
  WorkspacePathConsentRequest,
} from '@lobechat/types/src/executionContext';

import { isAbsoluteFilesystemPath, normalizeRootPath } from '@/helpers/executionContext';
import { parseWorkspacePathConsentRequest } from '@/server/services/aiAgent/pathConsent';

interface ToolPathRequest {
  mode: PathAccessMode;
  value: string;
}

const WORKSPACE_PATH_AUDIT_PREFIX = 'workspacePathScopeAudit:';
const WORKSPACE_PATH_APIS = [
  'editFile',
  'editLocalFile',
  'globFiles',
  'globLocalFiles',
  'grepContent',
  'listFiles',
  'listLocalFiles',
  'moveFiles',
  'moveLocalFiles',
  'readFile',
  'readFiles',
  'readLocalFile',
  'renameLocalFile',
  'searchFiles',
  'searchLocalFiles',
  'writeFile',
  'writeLocalFile',
] as const;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const dirnameForPath = (value: string): string =>
  (/^[A-Z]:[\\/]/i.test(value) ? path.win32 : path.posix).dirname(value);

const collectToolPathRequests = (
  apiName: string,
  args: Record<string, unknown>,
  cwd?: string,
): ToolPathRequest[] => {
  const one = (value: unknown, mode: PathAccessMode): ToolPathRequest[] => {
    const candidate = asString(value);
    return candidate ? [{ mode, value: candidate }] : [];
  };

  switch (apiName) {
    case 'listFiles':
    case 'listLocalFiles':
    case 'readFile':
    case 'readLocalFile': {
      return one(args.path ?? cwd, 'read');
    }
    case 'readFiles': {
      return Array.isArray(args.paths) ? args.paths.flatMap((value) => one(value, 'read')) : [];
    }
    case 'searchFiles':
    case 'searchLocalFiles': {
      return one(args.directory ?? args.onlyIn ?? args.scope ?? cwd, 'read');
    }
    case 'grepContent': {
      return one(args.path ?? args.scope ?? args.cwd ?? cwd, 'read');
    }
    case 'globFiles':
    case 'globLocalFiles': {
      return one(args.scope ?? args.cwd ?? cwd, 'read');
    }
    case 'writeFile':
    case 'writeLocalFile': {
      return one(args.path, 'write').map((request) => ({
        ...request,
        value: dirnameForPath(request.value),
      }));
    }
    case 'editFile':
    case 'editLocalFile': {
      return one(args.file_path, 'write').map((request) => ({
        ...request,
        value: dirnameForPath(request.value),
      }));
    }
    case 'moveFiles':
    case 'moveLocalFiles': {
      if (!Array.isArray(args.items)) return [];
      return args.items.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        return [...one(record.oldPath, 'write'), ...one(record.newPath, 'write')].map(
          (request) => ({
            ...request,
            value: dirnameForPath(request.value),
          }),
        );
      });
    }
    case 'renameLocalFile': {
      const source = asString(args.path);
      if (!source) return [];
      const flavor = /^[A-Z]:[\\/]/i.test(source) ? path.win32 : path.posix;
      return [{ mode: 'write', value: flavor.dirname(source) }];
    }
    default: {
      return [];
    }
  }
};

const resolveAgainstCwd = (value: string, cwd?: string): string | undefined => {
  if (value.startsWith('~/') || value.startsWith('~\\')) return;
  const flavor =
    /^[A-Z]:[\\/]/i.test(value) || /^[A-Z]:[\\/]/i.test(cwd ?? '') ? path.win32 : path.posix;
  if (flavor.isAbsolute(value)) return normalizeRootPath(flavor.normalize(value));
  if (!cwd || !flavor.isAbsolute(cwd)) return;
  return normalizeRootPath(flavor.resolve(cwd, value));
};

const isWithin = (target: string, root: string): boolean => {
  const flavor = /^[A-Z]:[\\/]/i.test(root) ? path.win32 : path.posix;
  if (!flavor.isAbsolute(root) || !flavor.isAbsolute(target)) return false;
  const relative = flavor.relative(flavor.resolve(root), flavor.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !flavor.isAbsolute(relative));
};

const isCredentialRead = (target: string): boolean => {
  const normalized = target.replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1)?.toLowerCase() ?? '';
  return (
    ['.npmrc', '.pypirc', 'credentials', 'netrc'].includes(basename) ||
    /^\.env(?:\..+)?$/i.test(basename) ||
    /(?:^|\/)\.aws\/credentials$/i.test(normalized)
  );
};

const rootCovers = (
  root: ExecutionAccessRoot,
  target: string,
  mode: PathAccessMode,
  credentialRead: boolean,
): boolean => {
  const matches =
    root.target === 'file'
      ? resolveAgainstCwd(target, undefined) === resolveAgainstCwd(root.rootPath, undefined)
      : isWithin(target, root.rootPath);
  if (!matches || (root.target === 'file' && mode === 'exec')) return false;
  if (root.scope === 'operation' && root.source === 'direct-user-message' && mode !== 'read') {
    return false;
  }
  if (credentialRead) {
    return root.scope === 'operation' && root.source === 'user-approval';
  }
  return true;
};

const resolveToolPathRequests = (params: {
  executionContext: ExecutionContext;
  tool: ChatToolPayload;
}): Array<{ credentialRead: boolean; mode: PathAccessMode; target: string }> => {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(params.tool.arguments || '{}');
  } catch {
    return [];
  }
  return collectToolPathRequests(params.tool.apiName, args, params.executionContext.cwd).flatMap(
    ({ mode, value }) => {
      const target = resolveAgainstCwd(value, params.executionContext.cwd);
      if (!target || !isAbsoluteFilesystemPath(target)) return [];
      return [{ credentialRead: mode === 'read' && isCredentialRead(target), mode, target }];
    },
  );
};

const areToolPathRequestsCovered = (params: {
  executionContext: ExecutionContext;
  tool: ChatToolPayload;
}): boolean => {
  const requests = resolveToolPathRequests(params);
  return (
    requests.length > 0 &&
    requests.every(({ credentialRead, mode, target }) =>
      (params.executionContext.accessRoots ?? []).some((root) =>
        rootCovers(root, target, mode, credentialRead),
      ),
    )
  );
};

/**
 * Decide whether an unbound local-system call genuinely needs a default cwd.
 * Explicit absolute (or home-relative) targets use their operation/topic grant
 * directly and must not create scratch as a side effect.
 */
export const requiresPrimaryCwdForTool = (params: {
  executionContext?: ExecutionContext;
  tool: ChatToolPayload;
}): boolean => {
  const { executionContext, tool } = params;
  if (
    tool.identifier !== LocalSystemIdentifier ||
    !executionContext ||
    executionContext.plan.kind !== 'device' ||
    executionContext.cwd
  ) {
    return false;
  }
  if (tool.apiName === 'runCommand' || tool.apiName === 'runHeteroTask') return true;
  if (!(WORKSPACE_PATH_APIS as readonly string[]).includes(tool.apiName)) return false;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tool.arguments || '{}');
  } catch {
    return false;
  }
  const requests = collectToolPathRequests(tool.apiName, args);
  if (requests.length === 0) {
    return [
      'globFiles',
      'globLocalFiles',
      'listFiles',
      'listLocalFiles',
      'searchFiles',
      'searchLocalFiles',
    ].includes(tool.apiName);
  }
  return requests.some(
    ({ value }) =>
      !isAbsoluteFilesystemPath(value) && !value.startsWith('~/') && !value.startsWith('~\\'),
  );
};

/** Build display/consent evidence for a pre-dispatch local-system approval. */
export const buildPendingWorkspacePathConsent = (params: {
  activeDeviceId?: string;
  executionContext?: ExecutionContext;
  operationId: string;
  tool: ChatToolPayload;
  topicId?: string;
}): WorkspacePathConsentRequest | undefined => {
  const { activeDeviceId, executionContext, operationId, tool, topicId } = params;
  if (
    tool.identifier !== LocalSystemIdentifier ||
    !executionContext ||
    executionContext.version !== 1 ||
    executionContext.plan.kind !== 'device' ||
    !activeDeviceId ||
    executionContext.plan.deviceId !== activeDeviceId ||
    !topicId
  ) {
    return;
  }

  const roots = executionContext.accessRoots ?? [];
  const request = resolveToolPathRequests({ executionContext, tool }).find(
    ({ credentialRead, mode, target }) =>
      !roots.some((root) => rootCovers(root, target, mode, credentialRead)),
  );
  if (!request) return;

  return {
    actualCwd: executionContext.cwd ?? '',
    deviceId: activeDeviceId,
    modes: [request.mode],
    operationId,
    primaryCwd: executionContext.workspace?.rootPath ?? executionContext.cwd ?? '',
    requestedPath: request.target,
    topicId,
    version: 1,
  };
};

/**
 * Tag local path audits so the runtime can account for frozen extra roots.
 * The original audit still runs first; this only suppresses a redundant prompt
 * when every typed request is already covered by the operation snapshot.
 */
export const tagWorkspacePathInterventionAudits = <
  T extends { manifestMap: Record<string, LobeToolManifest> },
>(
  toolSet: T,
): T => {
  const manifest = toolSet.manifestMap[LocalSystemIdentifier];
  if (!manifest?.api) return toolSet;
  return {
    ...toolSet,
    manifestMap: {
      ...toolSet.manifestMap,
      [LocalSystemIdentifier]: {
        ...manifest,
        api: manifest.api.map((api) => {
          const intervention = api.humanIntervention;
          if (
            !intervention ||
            typeof intervention !== 'object' ||
            !('dynamic' in intervention) ||
            intervention.dynamic?.type !== 'pathScopeAudit'
          ) {
            return api;
          }
          return {
            ...api,
            humanIntervention: {
              ...intervention,
              dynamic: {
                ...intervention.dynamic,
                type: `${WORKSPACE_PATH_AUDIT_PREFIX}${api.name}`,
              },
            },
          };
        }),
      },
    },
  } as T;
};

export const workspacePathInterventionAudits: Record<string, DynamicInterventionResolver> =
  Object.fromEntries(
    WORKSPACE_PATH_APIS.map((apiName) => [
      `${WORKSPACE_PATH_AUDIT_PREFIX}${apiName}`,
      async (args: Record<string, unknown>, metadata?: Record<string, any>) => {
        const shouldIntervene = await pathScopeAudit(args, metadata);
        if (!shouldIntervene) return false;
        const executionContext = metadata?.executionContext as ExecutionContext | undefined;
        if (!executionContext) return true;
        return !areToolPathRequestsCovered({
          executionContext,
          tool: {
            apiName,
            arguments: JSON.stringify(args),
            id: '__intervention_audit__',
            identifier: LocalSystemIdentifier,
            type: 'builtin',
          },
        });
      },
    ]),
  );

/** Accept only a fully formed device-authored post-dispatch intervention. */
export const getPostDispatchWorkspacePathConsent = (params: {
  activeDeviceId?: string;
  operationId: string;
  result: { content?: unknown; state?: unknown; success?: boolean };
  topicId?: string;
}): WorkspacePathConsentRequest | undefined => {
  const { activeDeviceId, operationId, result, topicId } = params;
  if (result.success !== false || result.content !== 'INTERVENTION_REQUIRED') return;
  if (!result.state || typeof result.state !== 'object') return;
  const state = result.state as Record<string, unknown>;
  if (state.code !== 'INTERVENTION_REQUIRED') return;
  const request = parseWorkspacePathConsentRequest(state.workspacePathConsent);
  if (
    !request ||
    request.operationId !== operationId ||
    request.topicId !== topicId ||
    request.deviceId !== activeDeviceId
  ) {
    return;
  }
  return request;
};
