import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { detectRepoType } from '@lobechat/local-file-shell';
import { recoverProjectSkillEdit } from './projectSkillAuthoring';

import type {
  CleanupScratchWorkspaceParams,
  CleanupScratchWorkspaceResult,
  EnsureScratchWorkspaceParams,
  EnsureScratchWorkspaceResult,
  InitWorkspaceParams,
  InitWorkspaceResult,
  ListProjectSkillsParams,
  ListProjectSkillsResult,
  ProjectSkillItem,
  ResolveRealPathParams,
  ResolveRealPathResult,
  StatPathResult,
  VerifySkillPathsParams,
  VerifySkillPathsResult,
  WorkspaceInstructionsItem,
  WorkspaceScanDeps,
} from './types';

const SKILL_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Cap recursion to guard against pathological directory trees.
const MAX_SKILL_FILE_COUNT = 1000;

const SKILL_SOURCES = ['.agents/skills', '.claude/skills'] as const;

const toSafeTopicSegment = (topicId: unknown): string => {
  if (typeof topicId !== 'string') throw new Error('topicId is required');
  const trimmed = topicId.trim();
  if (!trimmed) throw new Error('topicId is required');
  if (/^[A-Z0-9][\w.-]{0,127}$/i.test(trimmed) && trimmed !== '.' && trimmed !== '..') {
    return trimmed;
  }
  return `topic-${createHash('sha256').update(trimmed).digest('hex').slice(0, 32)}`;
};

const assertSafeScratchRoot = (root: string): void => {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) {
    throw new Error('SCOPE_DENIED');
  }
};

const toPosixRelativePath = (filePath: string) => filePath.split(path.sep).join('/');

const isPathContained = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const resolveScanRoot = async (root: string): Promise<string | undefined> => {
  try {
    const canonicalRoot = await realpath(root);
    return (await stat(canonicalRoot)).isDirectory() ? canonicalRoot : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Read an automatically-discovered file only when it is a regular file whose
 * canonical path remains inside both containment roots. Re-checking the path
 * and inode around the open descriptor closes the practical symlink-swap
 * window; the descriptor itself keeps the bytes stable during the read.
 */
const readRegularContainedFile = async (
  workspaceRoot: string,
  candidate: string,
  nearestRoot: string = workspaceRoot,
): Promise<string | undefined> => {
  try {
    const lexicalStat = await lstat(candidate);
    if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink()) return undefined;

    const canonicalCandidate = await realpath(candidate);
    if (
      !isPathContained(workspaceRoot, canonicalCandidate) ||
      !isPathContained(nearestRoot, canonicalCandidate)
    ) {
      return undefined;
    }

    const file = await open(canonicalCandidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const openedStat = await file.stat();
      if (!openedStat.isFile()) return undefined;

      const beforeReadPath = await realpath(candidate);
      const beforeReadStat = await lstat(candidate);
      if (
        beforeReadPath !== canonicalCandidate ||
        !beforeReadStat.isFile() ||
        beforeReadStat.isSymbolicLink() ||
        beforeReadStat.dev !== openedStat.dev ||
        beforeReadStat.ino !== openedStat.ino
      ) {
        return undefined;
      }

      const content = await file.readFile('utf8');
      const afterReadPath = await realpath(candidate);
      const afterReadStat = await lstat(candidate);
      if (
        afterReadPath !== canonicalCandidate ||
        !afterReadStat.isFile() ||
        afterReadStat.isSymbolicLink() ||
        afterReadStat.dev !== openedStat.dev ||
        afterReadStat.ino !== openedStat.ino
      ) {
        return undefined;
      }

      return content;
    } finally {
      await file.close();
    }
  } catch (error) {
    rethrowScanFailure(error);
    return undefined;
  }
};

const rethrowScanFailure = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ELOOP') throw error;
};

const listSkillFilesRecursive = async (dir: string): Promise<string[]> => {
  const results: string[] = [];
  const stack: string[] = [dir];

  while (stack.length > 0 && results.length < MAX_SKILL_FILE_COUNT) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      rethrowScanFailure(error);
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        try {
          const entryStat = await lstat(full);
          const canonicalEntry = await realpath(full);
          if (entryStat.isDirectory() && isPathContained(dir, canonicalEntry)) {
            stack.push(canonicalEntry);
          }
        } catch (error) {
          rethrowScanFailure(error);
          // Entry disappeared or was swapped while scanning; ignore it.
        }
      } else if (entry.isFile()) {
        try {
          const entryStat = await lstat(full);
          const canonicalEntry = await realpath(full);
          if (
            entryStat.isFile() &&
            !entryStat.isSymbolicLink() &&
            isPathContained(dir, canonicalEntry)
          ) {
            results.push(toPosixRelativePath(path.relative(dir, canonicalEntry)));
            if (results.length >= MAX_SKILL_FILE_COUNT) break;
          }
        } catch (error) {
          rethrowScanFailure(error);
          // Entry disappeared or was swapped while scanning; ignore it.
        }
      }
    }
  }
  return results.sort();
};

/**
 * Parse a minimal YAML frontmatter block for SKILL.md files. Only handles
 * `key: value` lines; multi-line block scalars fall back to the first line.
 */
const parseSkillFrontmatter = (raw: string): Record<string, string> => {
  const match = raw.match(SKILL_FRONTMATTER_RE);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key || key.startsWith('#')) continue;
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('|') || value.startsWith('>')) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
};

/**
 * Scan one skill source directory (e.g. `.agents/skills`) under `root` and
 * return parsed frontmatter for each `SKILL.md`. Returns `[]` when the source
 * directory is absent; I/O failures propagate. Unsorted — callers sort/merge.
 */
const scanSkillsInSource = async (
  root: string,
  source: ProjectSkillItem['source'],
): Promise<ProjectSkillItem[]> => {
  const requestedDir = path.join(root, source);
  let dir: string;
  let entries;
  try {
    dir = await realpath(requestedDir);
    if (!isPathContained(root, dir) || !(await stat(dir)).isDirectory()) return [];
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    rethrowScanFailure(error);
    return [];
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map(async (entry): Promise<ProjectSkillItem | null> => {
        const requestedSkillDir = path.join(dir, entry.name);
        try {
          const skillDir = await realpath(requestedSkillDir);
          if (
            !isPathContained(root, skillDir) ||
            !isPathContained(dir, skillDir) ||
            !(await stat(skillDir)).isDirectory()
          ) {
            return null;
          }

          const skillFile = path.join(skillDir, 'SKILL.md');
          const raw = await readRegularContainedFile(root, skillFile, skillDir);
          if (raw === undefined) return null;
          const fields = parseSkillFrontmatter(raw);
          const files = await listSkillFilesRecursive(skillDir);
          return {
            description: fields.description || undefined,
            fileCount: files.length,
            files,
            name: fields.name || entry.name,
            path: skillFile,
            skillDir,
            source,
          };
        } catch (error) {
          rethrowScanFailure(error);
          return null;
        }
      }),
  );

  return skills.filter((skill): skill is ProjectSkillItem => skill !== null);
};

/**
 * Read the project-root agent instructions files (`AGENTS.md`, then `CLAUDE.md`).
 * Collects every present candidate rather than first-match, since both can
 * coexist. Each body is capped so a pathologically large file can't bloat the
 * cached payload or the injected system role.
 */
const readWorkspaceInstructions = async (root: string): Promise<WorkspaceInstructionsItem[]> => {
  const MAX_INSTRUCTIONS_BYTES = 64 * 1024;
  const candidates = ['AGENTS.md', 'CLAUDE.md'] as const;

  const instructions: WorkspaceInstructionsItem[] = [];
  for (const source of candidates) {
    const raw = await readRegularContainedFile(root, path.join(root, source));
    if (raw !== undefined) {
      const content =
        raw.length > MAX_INSTRUCTIONS_BYTES ? raw.slice(0, MAX_INSTRUCTIONS_BYTES) : raw;
      instructions.push({ content, source });
    }
  }

  return instructions;
};

/**
 * Scan agent skill directories under the project root. Returns the first source
 * directory that yields any skills (`.agents/skills` wins). Approves the root
 * for the host preview protocol when any skills are found.
 */
export const listProjectSkills = async (
  params: ListProjectSkillsParams,
  deps: WorkspaceScanDeps = {},
): Promise<ListProjectSkillsResult> => {
  const root = params.scope;
  const scanRoot = await resolveScanRoot(root);
  if (!scanRoot) throw new Error('Workspace scan root is unavailable');
  await recoverProjectSkillEdit(scanRoot);
  const merged: ProjectSkillItem[] = [];
  const seen = new Set<string>();
  for (const source of SKILL_SOURCES) {
    const skills = (await scanSkillsInSource(scanRoot, source)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const skill of skills)
      if (!seen.has(skill.name)) {
        merged.push(skill);
        seen.add(skill.name);
      }
  }
  if (merged.length) await deps.approveProjectRoot?.(root);
  return {
    root,
    skills: merged.sort((a, b) => a.name.localeCompare(b.name)),
    source: merged[0]?.source ?? null,
  };
};

/**
 * One-call "workspace init" scan: merge project skills from BOTH
 * `.agents/skills` and `.claude/skills` (deduped by name, `.agents/skills`
 * winning) and read the project-root agent instructions. Approves the root for
 * the host preview protocol regardless of what was found, since the run is now
 * bound to this root.
 */
export const initWorkspace = async (
  params: InitWorkspaceParams,
  deps: WorkspaceScanDeps = {},
): Promise<InitWorkspaceResult> => {
  const root = params.scope;
  const scanRoot = await resolveScanRoot(root);
  if (!scanRoot) throw new Error('Workspace scan root is unavailable');
  await recoverProjectSkillEdit(scanRoot);

  const seen = new Set<string>();
  const skills: ProjectSkillItem[] = [];
  for (const source of SKILL_SOURCES) {
    for (const skill of await scanSkillsInSource(scanRoot, source)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const instructions = await readWorkspaceInstructions(scanRoot);

  await deps.approveProjectRoot?.(root);

  return { instructions, root, skills };
};

/**
 * Check whether a path exists on this device and is a directory, plus its git
 * repo type. Used to validate a manually-entered working directory from a web /
 * remote client before binding it, and to render the right dir icon.
 */
export const statPath = async (params: { path: string }): Promise<StatPathResult> => {
  try {
    const stats = await stat(params.path);
    if (!stats.isDirectory()) return { exists: true, isDirectory: false };
    const repoType = await detectRepoType(params.path);
    return { exists: true, isDirectory: true, repoType };
  } catch {
    return { exists: false, isDirectory: false };
  }
};

/** Canonicalize an existing absolute path on the target device. */
export const resolveRealPath = async (
  params: ResolveRealPathParams,
): Promise<ResolveRealPathResult> => {
  if (!path.isAbsolute(params.path)) throw new Error('ABSOLUTE_PATH_REQUIRED');
  return { path: await realpath(params.path) };
};

/**
 * Resolve the operation workspace and a selected project skill on the device,
 * then prove the skill remains inside that workspace after symlink expansion.
 * The server cannot perform this check because device paths are not mounted on
 * the server host.
 */
export const verifySkillPaths = async (
  params: VerifySkillPathsParams,
  skillCacheRoot?: string,
): Promise<VerifySkillPathsResult> => {
  if (!path.isAbsolute(params.workspaceRoot) || !path.isAbsolute(params.skillDir)) {
    throw new Error('WORKSPACE_REQUIRED');
  }

  const [workspaceRoot, skillDir] = await Promise.all([
    realpath(params.workspaceRoot),
    realpath(params.skillDir),
  ]);
  const relative = path.relative(workspaceRoot, skillDir);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    // Only device-owned, completely prepared bundles may live outside the
    // project. The cache root is injected by the host, never taken from RPC.
    let prepared = false;
    if (skillCacheRoot) {
      try {
        const cache = await realpath(path.join(skillCacheRoot, 'extracted'));
        const cacheRelative = path.relative(cache, skillDir);
        const [hash] = cacheRelative.split(path.sep);
        if (/^[a-f0-9]{64}$/i.test(hash) && !path.isAbsolute(cacheRelative)) {
          const bundleRoot = path.join(cache, hash);
          prepared =
            !(await lstat(bundleRoot)).isSymbolicLink() &&
            (await readFile(path.join(bundleRoot, '.prepared'), 'utf8')) === hash;
        }
      } catch {
        // Incomplete or escaped caches do not authorize execution.
      }
    }
    if (!prepared) throw new Error('SCOPE_DENIED');
  }

  const skillStat = await stat(skillDir);
  if (!skillStat.isDirectory()) throw new Error('SKILL_DIRECTORY_REQUIRED');

  return { skillDir, workspaceRoot };
};

/**
 * Explicit-only scratch creation. Merely importing the module or handling chat
 * never touches the filesystem; the directory is created only through this RPC.
 */
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
  const realRequested = await realpath(requested);
  const relative = path.relative(realRoot, realRequested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('SCOPE_DENIED');
  }

  return { root: realRequested, topicSegment };
};

/**
 * Delete only the deterministic topic directory below the configured scratch
 * root. The RPC deliberately accepts no path, so it cannot become an arbitrary
 * recursive-delete primitive.
 */
export const cleanupScratchWorkspace = async (
  params: CleanupScratchWorkspaceParams,
  scratchRoot: string | undefined,
): Promise<CleanupScratchWorkspaceResult> => {
  if (!scratchRoot || !path.isAbsolute(scratchRoot)) throw new Error('SCRATCH_ROOT_REQUIRED');

  const normalizedRoot = path.resolve(scratchRoot);
  assertSafeScratchRoot(normalizedRoot);

  const topicSegment = toSafeTopicSegment(params?.topicId);
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
