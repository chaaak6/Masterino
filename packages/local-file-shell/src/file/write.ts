import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { WriteFileParams, WriteFileResult } from '../types';
import { expandTilde } from './expandTilde';

export async function writeLocalFile({
  path: rawPath,
  content,
  temporary,
}: WriteFileParams): Promise<WriteFileResult> {
  if (!rawPath) return { error: 'Path cannot be empty', success: false };
  if (content === undefined) return { error: 'Content cannot be empty', success: false };

  const filePath = expandTilde(rawPath) ?? rawPath;
  const segments = path.resolve(filePath).split(path.sep);
  const temporaryIndex = segments.lastIndexOf('.masterino-tmp');
  if (
    temporary &&
    (!path.isAbsolute(filePath) || temporaryIndex < 0 || segments.length < temporaryIndex + 3)
  ) {
    return { error: 'Temporary writes require an app-managed topic path', success: false };
  }

  try {
    const dirname = path.dirname(filePath);
    await mkdir(dirname, { recursive: true });
    if (temporary && process.platform === 'win32') {
      const root = segments.slice(0, temporaryIndex + 1).join(path.sep);
      await promisify(execFile)('attrib.exe', ['+H', root], { windowsHide: true });
    }
    await writeFile(filePath, content, 'utf8');
    return { success: true, ...(temporary && { path: filePath }) };
  } catch (error) {
    return { error: `Failed to write file: ${(error as Error).message}`, success: false };
  }
}
