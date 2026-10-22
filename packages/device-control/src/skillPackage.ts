import { createHash } from 'node:crypto';
import {
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
import path from 'node:path';

import { unzipSync } from 'fflate';

import { resolveMasterinoHomePaths } from './masterinoHome';

export interface PrepareDeviceSkillPackage {
  forceRefresh?: boolean;
  url: string;
  zipHash: string;
}

const preparations = new Map<
  string,
  Promise<{ extractedDir: string; success: true; zipPath: string }>
>();

// Imported ZIPs may put SKILL.md at the root or one directory below it.
// Return the same resource root that the server importer uses.
async function resolveSkillRoot(extractedDir: string): Promise<string> {
  const entries = await readdir(extractedDir, { withFileTypes: true });
  if (entries.some((entry) => entry.name === 'SKILL.md' && entry.isFile())) return extractedDir;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(extractedDir, entry.name);
    const files = await readdir(nested, { withFileTypes: true });
    if (files.some((file) => file.name === 'SKILL.md' && file.isFile())) return nested;
  }
  throw new Error('SKILL.md not found in the prepared skill package');
}

/** Content-addressed, atomic package preparation shared by desktop and CLI devices. */
export async function prepareSkillPackage(
  input: PrepareDeviceSkillPackage,
  cacheRoot = resolveMasterinoHomePaths().skillsRoot,
  download: (url: string) => Promise<Response> = fetch,
): Promise<{ extractedDir: string; success: true; zipPath: string }> {
  if (!/^[a-f0-9]{64}$/i.test(input.zipHash)) throw new Error('Invalid skill package hash');
  const url = new URL(input.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid skill package URL');
  const key = path.resolve(cacheRoot, input.zipHash);
  const pending = preparations.get(key);
  if (pending) return pending;
  const task = (async () => {
    await mkdir(path.join(cacheRoot, 'extracted'), { recursive: true });
    const root = await realpath(path.join(cacheRoot, 'extracted'));
    const extractedDir = path.join(root, input.zipHash);
    const zipPath = path.join(cacheRoot, 'archives', input.zipHash + '.zip');
    try {
      const entry = await lstat(extractedDir);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Unsafe skill cache');
      if (
        !input.forceRefresh &&
        (await readFile(path.join(extractedDir, '.prepared'), 'utf8')) === input.zipHash
      ) {
        return {
          extractedDir: await resolveSkillRoot(extractedDir),
          success: true as const,
          zipPath,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const response = await download(input.url);
    if (!response.ok) throw new Error(`Skill package download failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Skill package is too large');
    if (createHash('sha256').update(bytes).digest('hex') !== input.zipHash.toLowerCase())
      throw new Error('Skill package hash mismatch');
    let size = 0;
    let count = 0;
    const files = unzipSync(bytes, {
      filter: (entry) => {
        size += entry.originalSize;
        count++;
        if (count > 2000 || size > 128 * 1024 * 1024)
          throw new Error('Skill package expands beyond the allowed size');
        return true;
      },
    });
    const temporary = await mkdtemp(path.join(root, '.preparing-'));
    try {
      for (const [name, content] of Object.entries(files)) {
        const segments = name.replaceAll('\\', '/').split('/');
        if (
          path.posix.isAbsolute(name) ||
          path.win32.isAbsolute(name) ||
          segments.includes('..') ||
          name.includes('\0') ||
          segments[0] === '.prepared'
        )
          throw new Error('Unsafe skill archive path');
        if (name.endsWith('/')) continue;
        const target = path.join(temporary, ...segments);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      await resolveSkillRoot(temporary);
      await writeFile(path.join(temporary, '.prepared'), input.zipHash);
      await mkdir(path.dirname(zipPath), { recursive: true });
      await writeFile(zipPath, bytes);
      await rm(extractedDir, { force: true, recursive: true });
      await rename(temporary, extractedDir);
      return {
        extractedDir: await resolveSkillRoot(extractedDir),
        success: true as const,
        zipPath,
      };
    } finally {
      await rm(temporary, { force: true, recursive: true });
    }
  })();
  preparations.set(key, task);
  try {
    return await task;
  } finally {
    preparations.delete(key);
  }
}
