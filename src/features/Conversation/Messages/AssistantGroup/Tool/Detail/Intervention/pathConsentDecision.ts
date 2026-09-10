import type { PathConsentSelection } from './PathConsent';

export type PathConsentResolutionErrorCode =
  | 'PATH_ACCESS_DENIED'
  | 'PATH_NOT_ABSOLUTE'
  | 'PATH_NOT_FOUND'
  | 'PATH_UNRESOLVABLE';

export class PathConsentResolutionError extends Error {
  readonly code: PathConsentResolutionErrorCode;

  constructor(code: PathConsentResolutionErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'PathConsentResolutionError';
    this.code = code;
  }
}

export const normalizePathConsentResolutionError = (error: unknown): PathConsentResolutionError => {
  if (error instanceof PathConsentResolutionError) return error;
  const candidate = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  const signal = `${code} ${message}`.toUpperCase();

  if (signal.includes('PATH_NOT_FOUND') || signal.includes('ENOENT')) {
    return new PathConsentResolutionError('PATH_NOT_FOUND', error);
  }
  if (signal.includes('PATH_ACCESS_DENIED') || signal.includes('EACCES')) {
    return new PathConsentResolutionError('PATH_ACCESS_DENIED', error);
  }
  if (signal.includes('PATH_NOT_ABSOLUTE') || signal.includes('ABSOLUTE_PATH_REQUIRED')) {
    return new PathConsentResolutionError('PATH_NOT_ABSOLUTE', error);
  }
  return new PathConsentResolutionError('PATH_UNRESOLVABLE', error);
};

interface PathConsentApprovalDependencies {
  grantTopicRoot: (canonicalPath: string) => Promise<void>;
  persistDecision: (decision: PathConsentSelection) => void;
  resolveRootPath: (decision: PathConsentSelection) => Promise<string>;
  resume: () => Promise<void>;
}

/**
 * Coordinate one approval as an ordered transaction. Realpath verification is
 * deliberately first: a missing/model-invented path must not mint authority,
 * alter resume metadata, or restart execution.
 */
export const coordinatePathConsentApproval = async (
  decision: PathConsentSelection,
  dependencies: PathConsentApprovalDependencies,
): Promise<PathConsentSelection> => {
  let canonicalPath: string;
  try {
    canonicalPath = await dependencies.resolveRootPath(decision);
  } catch (error) {
    throw normalizePathConsentResolutionError(error);
  }

  const canonicalDecision = { ...decision, rootPath: canonicalPath };
  if (decision.scope === 'topic') await dependencies.grantTopicRoot(canonicalPath);
  dependencies.persistDecision(canonicalDecision);
  await dependencies.resume();
  return canonicalDecision;
};
