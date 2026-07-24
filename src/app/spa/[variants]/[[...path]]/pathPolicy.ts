type RoutePattern = readonly string[];

const sharedMainAreaPatterns: RoutePattern[] = [
  ['agent'],
  ['agent', ':aid'],
  ['agent', ':aid', ':topicId'],
  ['agent', ':aid', 'docs', ':docId'],
  ['agent', ':aid', 'profile'],
  ['agent', ':aid', 'channel'],
  ['agent', ':aid', 'topics'],
  ['agent', ':aid', 'task', ':taskId'],
  ['fleet'],
  ['group'],
  ['group', ':gid'],
  ['group', ':gid', 'profile'],
  ['community'],
  ['community', 'workspace', 'settings'],
  ['community', 'agent'],
  ['community', 'model'],
  ['community', 'provider'],
  ['community', 'skill'],
  ['community', 'mcp'],
  ['community', 'workspace'],
  ['community', 'agent', ':slug'],
  ['community', 'group_agent', ':slug'],
  ['community', 'model', ':slug'],
  ['community', 'provider', ':slug'],
  ['community', 'skill', ':slug'],
  ['community', 'mcp', ':slug'],
  ['community', 'user', ':slug'],
  ['community', 'org', ':slug'],
  ['resource'],
  ['resource', 'library', ':id'],
  ['resource', 'library', ':id', ':slug'],
  ['memory'],
  ['memory', 'identities'],
  ['memory', 'contexts'],
  ['memory', 'preferences'],
  ['memory', 'experiences'],
  ['memory', 'activities'],
  ['video'],
  ['image'],
  ['eval'],
  ['eval', 'bench', ':benchmarkId'],
  ['eval', 'bench', ':benchmarkId', 'runs', ':runId'],
  ['eval', 'bench', ':benchmarkId', 'runs', ':runId', 'cases', ':caseId'],
  ['eval', 'bench', ':benchmarkId', 'datasets', ':datasetId'],
  ['tasks'],
  ['task'],
  ['task', ':taskId'],
  ['page'],
  ['page', ':id'],
];

const personalAndPublicPatterns: RoutePattern[] = [
  ['settings'],
  ['settings', 'provider'],
  ['settings', 'provider', ':providerId'],
  ['settings', ':tab'],
  ['settings', ':tab', ':sub'],
  ['messages'],
  ['me'],
  ['me', 'profile'],
  ['me', 'settings'],
  ['share', 't', ':id'],
  ['share', 'page', ':id'],
  ['verify-im'],
  ['onboarding'],
  ['onboarding', 'agent'],
  ['onboarding', 'classic'],
  ['desktop-onboarding'],
];

const workspaceOnlyPatterns: RoutePattern[] = [
  ['settings'],
  ['settings', 'provider'],
  ['settings', 'skill'],
  ['settings', 'general'],
  ['settings', 'members'],
  ['settings', 'stats'],
  ['settings', 'plans'],
  ['settings', 'billing'],
  ['settings', 'credits'],
  ['settings', 'usage'],
  ['settings', 'service-model'],
  ['settings', 'creds'],
  ['settings', 'apikey'],
  ['settings', 'storage'],
  ['billing', 'plans'],
  ['billing', 'usage'],
  ['billing', 'credits'],
  ['billing', 'billing'],
];

const knownRootPatterns = [...sharedMainAreaPatterns, ...personalAndPublicPatterns];
const workspacePatterns = [...sharedMainAreaPatterns, ...workspaceOnlyPatterns];
const reservedRoots = new Set(knownRootPatterns.map(([root]) => root));

const matchesPattern = (path: readonly string[], pattern: RoutePattern) =>
  path.length === pattern.length &&
  pattern.every((segment, index) => segment.startsWith(':') || segment === path[index]);

const matchesAnyPattern = (path: readonly string[], patterns: RoutePattern[]) =>
  patterns.some((pattern) => matchesPattern(path, pattern));

export type SpaPathClassification = 'known' | 'unknown' | 'workspace';

/**
 * The Next route is a catch-all used only to boot real React Router paths.
 * Dynamic workspace roots are verified against the database by the caller.
 */
export const classifySpaPath = (path: string[] = []): SpaPathClassification => {
  if (path.length === 0) return 'known';
  if (matchesAnyPattern(path, knownRootPatterns)) return 'known';

  const [root, ...workspacePath] = path;
  if (reservedRoots.has(root)) return 'unknown';

  if (workspacePath.length === 0 || matchesAnyPattern(workspacePath, workspacePatterns)) {
    return 'workspace';
  }

  return 'unknown';
};
