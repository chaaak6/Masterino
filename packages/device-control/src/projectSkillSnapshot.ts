import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ProjectSkillSnapshotParams {
  operationId: string;
  path: string;
  resourcePath?: string;
  skillId: string;
  workspaceRoot: string;
}
export interface ProjectSkillSnapshot {
  content: string;
  directory: string;
  files: string[];
  hash: string;
  resourceContent?: string;
}
const pending = new Map<string, Promise<ProjectSkillSnapshot>>();
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
async function scan(directory: string) {
  const files: { name: string; bytes: Buffer; executable: boolean }[] = [];
  let size = 0;
  async function walk(dir: string, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const target = path.join(dir, entry.name),
        name = prefix + entry.name;
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error('SKILL_SNAPSHOT_SYMLINK');
      if (info.isDirectory()) {
        await walk(target, name + '/');
        continue;
      }
      if (!info.isFile()) throw new Error('SKILL_SNAPSHOT_SPECIAL_FILE');
      size += info.size;
      if (files.length >= 2000 || info.size > 8 * 1024 * 1024 || size > 32 * 1024 * 1024)
        throw new Error('SKILL_SNAPSHOT_LIMIT');
      const bytes = await readFile(target);
      if (bytes.length !== info.size) throw new Error('SKILL_CHANGED_DURING_PREPARATION');
      files.push({ name, bytes, executable: !!(info.mode & 0o111) });
    }
  }
  await walk(directory);
  const hash = createHash('sha256');
  for (const file of files)
    hash
      .update(file.name + '\0')
      .update(file.executable ? 'x' : '-')
      .update(file.bytes)
      .update('\0');
  return { files, hash: hash.digest('hex') };
}
/** Device-owned persistent operation binding. A recreated runtime cannot switch to live resources. */
export async function prepareProjectSkillSnapshot(
  input: ProjectSkillSnapshotParams,
  cacheRoot = path.join(os.homedir(), '.masterino', 'skills'),
): Promise<ProjectSkillSnapshot> {
  if (
    !input.operationId ||
    !input.skillId ||
    !path.isAbsolute(input.path) ||
    !path.isAbsolute(input.workspaceRoot)
  )
    throw new Error('SKILL_OPERATION_BINDING_REQUIRED');
  const workspace = await realpath(input.workspaceRoot);
  const lexicalWorkspace = path.resolve(input.workspaceRoot);
  const lexicalSource = path.resolve(path.dirname(input.path));
  // Derive the original location without accessing it: an existing operation
  // must remain usable after its source directory is renamed or deleted.
  const relativeSource = path.relative(lexicalWorkspace, lexicalSource);
  const source = path.resolve(workspace, relativeSource);
  if (!within(lexicalWorkspace, lexicalSource) || path.basename(input.path) !== 'SKILL.md')
    throw new Error('SCOPE_DENIED');
  const bindingKey = digest(JSON.stringify([workspace, input.operationId, input.skillId]));
  const key = path.resolve(cacheRoot, bindingKey) + '\0' + (input.resourcePath ?? '');
  const task = async () => {
    const bindings = path.join(cacheRoot, 'operations');
    const extracted = path.join(cacheRoot, 'extracted');
    await mkdir(bindings, { recursive: true });
    await mkdir(extracted, { recursive: true });
    const bindingFile = path.join(bindings, bindingKey + '.json');
    let binding: { source: string; hash: string } | undefined;
    try {
      binding = JSON.parse(await readFile(bindingFile, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (binding && (binding.source !== source || !/^[a-f0-9]{64}$/.test(binding.hash)))
      throw new Error('SKILL_BINDING_MISMATCH');
    if (!binding) {
      // The selected workspace is the canonical trust boundary. Every path
      // component below it, including the skill directory itself, must be a
      // real directory rather than a symlink (even a symlink back inside).
      let component = workspace;
      for (const segment of relativeSource.split(path.sep).filter(Boolean)) {
        component = path.join(component, segment);
        const entry = await lstat(component);
        if (entry.isSymbolicLink()) throw new Error('SKILL_SNAPSHOT_SYMLINK');
        if (!entry.isDirectory()) throw new Error('SKILL_DIRECTORY_REQUIRED');
      }
      if ((await realpath(source)) !== source) throw new Error('SKILL_SNAPSHOT_SYMLINK');
      const before = await scan(source);
      if (!before.files.some((file) => file.name === 'SKILL.md'))
        throw new Error('SKILL_MARKDOWN_REQUIRED');
      const temporary = await mkdtemp(path.join(extracted, '.snapshot-'));
      try {
        for (const file of before.files) {
          const target = path.join(temporary, file.name);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, file.bytes, { mode: file.executable ? 0o555 : 0o444 });
        }
        if (
          (await scan(source)).hash !== before.hash ||
          (await scan(temporary)).hash !== before.hash
        )
          throw new Error('SKILL_CHANGED_DURING_PREPARATION');
        await writeFile(path.join(temporary, '.prepared'), before.hash, { mode: 0o444 });
        const destination = path.join(extracted, before.hash);
        try {
          await rename(temporary, destination);
        } catch (e) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
        }
        binding = { source, hash: before.hash };
        const staging = bindingFile + '.' + digest(String(Math.random()));
        await writeFile(staging, JSON.stringify(binding), { flag: 'wx' });
        try {
          await link(staging, bindingFile);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          // Another host process won this operation binding. Use its complete snapshot.
          binding = JSON.parse(await readFile(bindingFile, 'utf8'));
          if (!binding || binding.source !== source || !/^[a-f0-9]{64}$/.test(binding.hash))
            throw new Error('SKILL_BINDING_MISMATCH', { cause: error });
        } finally {
          await rm(staging, { force: true });
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    const directoryPath = path.join(extracted, binding.hash);
    if ((await lstat(directoryPath)).isSymbolicLink()) throw new Error('SKILL_SNAPSHOT_CHANGED');
    const directory = await realpath(directoryPath);
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('SKILL_SNAPSHOT_CHANGED');
    const snapshot = await scan(directory);
    if (snapshot.hash !== binding.hash) throw new Error('SKILL_SNAPSHOT_CHANGED');
    const markdown = snapshot.files.find((file) => file.name === 'SKILL.md');
    if (!markdown) throw new Error('SKILL_MARKDOWN_REQUIRED');
    if (markdown.bytes.length > 256 * 1024) throw new Error('SKILL_MARKDOWN_TOO_LARGE');
    const resource =
      input.resourcePath === undefined
        ? undefined
        : snapshot.files.find((file) => file.name === input.resourcePath);
    if (input.resourcePath !== undefined && !resource)
      throw new Error('SKILL_RESOURCE_NOT_ALLOWED');
    if (resource && resource.bytes.length > 256 * 1024)
      throw new Error('SKILL_REFERENCE_TOO_LARGE');
    return {
      ...(resource && { resourceContent: resource.bytes.toString('utf8') }),
      directory,
      hash: binding.hash,
      content: markdown.bytes.toString('utf8'),
      files: snapshot.files.map((file) => file.name),
    };
  };
  let preparation = pending.get(key);
  if (!preparation) {
    preparation = task();
    pending.set(key, preparation);
  }
  let snapshot: ProjectSkillSnapshot;
  try {
    snapshot = await preparation;
  } finally {
    if (pending.get(key) === preparation) pending.delete(key);
  }
  return snapshot;
}
