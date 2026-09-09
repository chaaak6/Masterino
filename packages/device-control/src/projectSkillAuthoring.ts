import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { type Zippable, zipSync } from 'fflate';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 256;
const MAX_PACKED_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface DeviceProjectSkillValidation {
  errors: string[];
  files: string[];
  manifest?: { description: string; name: string };
  totalBytes: number;
  valid: boolean;
}

export interface DeviceProjectSkillTarget {
  name: string;
  scope: string;
}

export interface DeviceProjectSkillCreate extends DeviceProjectSkillTarget {
  content: string;
}

export interface DeviceProjectSkillUpdate extends DeviceProjectSkillCreate {
  path: string;
}

export interface DeviceProjectSkillRename extends DeviceProjectSkillTarget {
  newName: string;
}

export interface DeviceProjectSkillPackResult {
  archiveBase64: string;
  size: number;
  validation: DeviceProjectSkillValidation;
}

const assertSafeName = (name: string): void => {
  if (!SAFE_NAME.test(name)) throw new Error('INVALID_SKILL_NAME');
};

const normalizeRelativePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('INVALID_SKILL_PATH');
  }
  return normalized;
};

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const parseManifest = (
  content: string,
  expectedName: string,
): { description: string; name: string } => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!frontmatter) throw new Error('SKILL_FRONTMATTER_REQUIRED');

  const fields: Record<string, string> = {};
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  assertSafeName(fields.name ?? '');
  if (fields.name !== expectedName) throw new Error('SKILL_NAME_MISMATCH');
  if (!fields.description || fields.description.length > 1024) {
    throw new Error('SKILL_DESCRIPTION_INVALID');
  }
  if (!frontmatter[2].trim()) throw new Error('SKILL_BODY_REQUIRED');
  return { description: fields.description, name: fields.name };
};

const getRoots = async (scope: string, name: string) => {
  assertSafeName(name);
  if (!path.isAbsolute(scope)) throw new Error('WORKSPACE_REQUIRED');
  const workspaceRoot = await realpath(scope);
  const skillsRoot = path.join(workspaceRoot, '.agents', 'skills');
  const skillRoot = path.join(skillsRoot, name);
  if (!isWithin(workspaceRoot, skillRoot)) throw new Error('SCOPE_DENIED');
  return { skillRoot, skillsRoot, workspaceRoot };
};

const assertNoSymlinks = async (workspaceRoot: string, target: string): Promise<void> => {
  if (!isWithin(workspaceRoot, target)) throw new Error('SCOPE_DENIED');
  const relative = path.relative(workspaceRoot, target);
  let current = workspaceRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = await lstat(current).catch(() => undefined);
    if (entry?.isSymbolicLink()) throw new Error('SCOPE_DENIED');
  }
};

const listFiles = async (skillRoot: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      // Globs with onlyFiles silently omit symlinks. Reject every entry before
      // copying a tree so even unused nested/dangling links cannot be published.
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error('SCOPE_DENIED');
      if (info.isDirectory()) await visit(target);
      else if (info.isFile()) files.push(normalizeRelativePath(path.relative(skillRoot, target)));
      else throw new Error('INVALID_SKILL_FILE');
    }
  };
  await visit(skillRoot);
  return files.sort();
};

const acquireAuthoringLock = async (skillsRoot: string): Promise<string> => {
  const lock = path.join(skillsRoot, '.authoring-lock');
  await mkdir(lock).catch(() => {
    throw new Error('SKILL_EDIT_IN_PROGRESS');
  });
  try {
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
    return lock;
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
};

/** Recover only our own journal after its owning process has exited. */
export const recoverProjectSkillEdit = async (scope: string): Promise<void> => {
  const { skillsRoot, workspaceRoot } = await getRoots(scope, 'recovery');
  const lock = path.join(skillsRoot, '.authoring-lock');
  if (!(await lstat(lock).catch(() => undefined))) return;
  await assertNoSymlinks(workspaceRoot, lock);
  const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => '{}'));
  if (!Number.isInteger(owner.pid)) throw new Error('SKILL_EDIT_RECOVERY_REQUIRED');
  try {
    process.kill(owner.pid, 0);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return;
  }
  const raw = await readFile(path.join(lock, 'transaction.json'), 'utf8').catch(() => undefined);
  if (raw) {
    const journal = JSON.parse(raw);
    assertSafeName(journal.original);
    assertSafeName(journal.destination);
    if (typeof journal.stage !== 'string' || !/^\.stage-[a-zA-Z0-9]+$/.test(journal.stage))
      throw new Error('INVALID_SKILL_JOURNAL');
    const original = path.join(skillsRoot, journal.original);
    const destination = path.join(skillsRoot, journal.destination);
    const backup = path.join(lock, 'previous');
    if (await lstat(backup).catch(() => undefined) && !(await lstat(destination).catch(() => undefined))) await rename(backup, original);
      // An installed destination means publication completed; retain it.
    await rm(path.join(skillsRoot, journal.stage), { recursive: true, force: true });
  }
  await rm(lock, { recursive: true, force: true });
};

const validateDirectory = async (
  skillRoot: string,
  workspaceRoot: string,
  expectedName: string,
): Promise<DeviceProjectSkillValidation> => {
  const errors: string[] = [];
  let files: string[] = [];
  let manifest: DeviceProjectSkillValidation['manifest'];
  let totalBytes = 0;

  try {
    await assertNoSymlinks(workspaceRoot, skillRoot);
    if (!(await stat(skillRoot)).isDirectory()) throw new Error('PROJECT_SKILL_NOT_FOUND');
    files = await listFiles(skillRoot);
    if (!files.includes('SKILL.md')) errors.push('SKILL.md is missing.');
    if (files.length > MAX_FILES) errors.push(`Project skill exceeds ${MAX_FILES} files.`);

    for (const relativePath of files) {
      const target = path.join(skillRoot, relativePath);
      await assertNoSymlinks(workspaceRoot, target);
      const targetStat = await lstat(target);
      if (!targetStat.isFile()) {
        errors.push(`Not a regular file: ${relativePath}`);
        continue;
      }
      totalBytes += targetStat.size;
      if (targetStat.size > MAX_FILE_BYTES) errors.push(`${relativePath} is too large.`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) errors.push('Project skill exceeds the total size limit.');

    if (files.includes('SKILL.md')) {
      try {
        manifest = parseManifest(
          await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8'),
          expectedName,
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return { errors, files, manifest, totalBytes, valid: errors.length === 0 };
};

export const validateProjectSkillOnDevice = async (
  input: DeviceProjectSkillTarget,
): Promise<DeviceProjectSkillValidation> => {
  try {
    const roots = await getRoots(input.scope, input.name);
    return await validateDirectory(roots.skillRoot, roots.workspaceRoot, input.name);
  } catch (error) {
    return { errors: [String(error)], files: [], totalBytes: 0, valid: false };
  }
};

/** Construct and validate the entire replacement before changing published files. */
const stageSkill = async (
  input: DeviceProjectSkillTarget,
  create: boolean,
  edit: (stage: string) => Promise<void>,
  newName = input.name,
): Promise<DeviceProjectSkillValidation> => {
  const roots = await getRoots(input.scope, input.name);
  assertSafeName(newName);
  await assertNoSymlinks(roots.workspaceRoot, roots.skillsRoot);
  await mkdir(roots.skillsRoot, { recursive: true });
  await recoverProjectSkillEdit(input.scope);
  await assertNoSymlinks(roots.workspaceRoot, roots.skillRoot);
  const lock = await acquireAuthoringLock(roots.skillsRoot);
  const destination = (await getRoots(input.scope, newName)).skillRoot;
  const backup = path.join(lock, 'previous');
  let stage: string | undefined;
  let committed = false;
  try {
    const exists = await lstat(roots.skillRoot).catch(() => undefined);
    if (create && exists) throw new Error('ALREADY_EXISTS');
    if (!create && !exists?.isDirectory()) throw new Error('PROJECT_SKILL_NOT_FOUND');
    if (destination !== roots.skillRoot && (await lstat(destination).catch(() => undefined)))
      throw new Error('ALREADY_EXISTS');
    const digest = async (dir: string) => {
      const hash = createHash('sha256');
      for (const file of await listFiles(dir)) {
        await assertNoSymlinks(roots.workspaceRoot, path.join(dir, file));
        hash.update(file).update(await readFile(path.join(dir, file)));
      }
      return hash.digest('hex');
    };
    if (!create) {
      const original = await validateDirectory(roots.skillRoot, roots.workspaceRoot, input.name);
      if (!original.valid) throw new Error(original.errors.join(' '));
    }
    const before = create ? undefined : await digest(roots.skillRoot);
    stage = await mkdtemp(path.join(roots.skillsRoot, '.stage-'));
    if (!create) await cp(roots.skillRoot, stage, { recursive: true, dereference: false });
    await edit(stage);
    const validation = await validateDirectory(stage, roots.workspaceRoot, newName);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    if (!create && before !== (await digest(roots.skillRoot)))
      throw new Error('SKILL_VERSION_CONFLICT');
    await writeFile(
      path.join(lock, 'transaction.json'),
      JSON.stringify({ original: input.name, destination: newName, stage: path.basename(stage) }),
    );
    if (!create) await rename(roots.skillRoot, backup);
    await rename(stage, destination);
    committed = true;
    return validation;
  } finally {
    if (!committed && (await lstat(backup).catch(() => undefined)))
      await rename(backup, roots.skillRoot);
    // Publication already succeeded: leave the journal for recovery if cleanup
    // fails, rather than reporting a failed edit after changing the document.
    if (committed) {
      await rm(lock, { recursive: true, force: true }).catch(() => undefined);
    } else {
      if (stage) await rm(stage, { recursive: true, force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
};

export const createProjectSkillOnDevice = async (
  input: DeviceProjectSkillCreate,
): Promise<DeviceProjectSkillValidation> => {
  assertSafeName(input.name);
  parseManifest(input.content, input.name);
  if (Buffer.byteLength(input.content) > MAX_FILE_BYTES) throw new Error('SKILL_FILE_TOO_LARGE');
  return stageSkill(input, true, (stage) => writeFile(path.join(stage, 'SKILL.md'), input.content));
};

export const updateProjectSkillOnDevice = async (
  input: DeviceProjectSkillUpdate,
): Promise<DeviceProjectSkillValidation> => {
  const relativePath = normalizeRelativePath(input.path);
  if (Buffer.byteLength(input.content) > MAX_FILE_BYTES) throw new Error('SKILL_FILE_TOO_LARGE');
  if (relativePath === 'SKILL.md') parseManifest(input.content, input.name);
  return stageSkill(input, false, async (stage) => {
    const target = path.join(stage, relativePath);
    await assertNoSymlinks(stage, target);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.content);
  });
};

export const renameProjectSkillOnDevice = async (
  input: DeviceProjectSkillRename,
): Promise<DeviceProjectSkillValidation> => {
  assertSafeName(input.newName);
  return stageSkill(
    input,
    false,
    async (stage) => {
      const skillMd = await readFile(path.join(stage, 'SKILL.md'), 'utf8');
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
      if (!frontmatter || !/^\s*name\s*:/m.test(frontmatter[1])) {
        throw new Error('SKILL_FRONTMATTER_REQUIRED');
      }
      const nextFrontmatter = frontmatter[1].replace(/^\s*name\s*:.*$/m, `name: ${input.newName}`);
      const renamedSkillMd = skillMd.replace(frontmatter[1], nextFrontmatter);
      parseManifest(renamedSkillMd, input.newName);

      await writeFile(path.join(stage, 'SKILL.md'), renamedSkillMd);
    },
    input.newName,
  );
};

export const deleteProjectSkillOnDevice = async (
  input: DeviceProjectSkillTarget,
): Promise<void> => {
  const { skillRoot, skillsRoot, workspaceRoot } = await getRoots(input.scope, input.name);
  await recoverProjectSkillEdit(input.scope);
  await assertNoSymlinks(workspaceRoot, skillRoot);
  const lock = await acquireAuthoringLock(skillsRoot);
  try {
    if (!(await stat(skillRoot)).isDirectory()) throw new Error('PROJECT_SKILL_NOT_FOUND');
    // The same authoring lock excludes staged edits through removal. No second
    // transaction: one rename removes the skill from discovery atomically.
    const tombstone = await mkdtemp(path.join(skillsRoot, '.deleted-'));
    try {
      await rename(skillRoot, path.join(tombstone, 'skill'));
    } catch (error) {
      await rm(tombstone, { recursive: true, force: true });
      throw error;
    }
    await rm(tombstone, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
};

export const packProjectSkillOnDevice = async (
  input: DeviceProjectSkillTarget,
): Promise<DeviceProjectSkillPackResult> => {
  const validation = await validateProjectSkillOnDevice(input);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const { skillRoot, workspaceRoot } = await getRoots(input.scope, input.name);
  const archive: Zippable = {};
  for (const relativePath of validation.files) {
    const target = path.join(skillRoot, ...relativePath.split('/'));
    await assertNoSymlinks(workspaceRoot, target);
    archive[relativePath] = [await readFile(target), { mtime: new Date('1980-01-01T00:00:00Z') }];
  }
  const packed = zipSync(archive, { level: 6 });
  if (packed.byteLength > MAX_PACKED_BYTES) throw new Error('PROJECT_SKILL_ARCHIVE_TOO_LARGE');
  return {
    archiveBase64: Buffer.from(packed).toString('base64'),
    size: packed.byteLength,
    validation,
  };
};
