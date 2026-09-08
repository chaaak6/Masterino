import { createHash } from 'node:crypto';
import {
  SANDBOX_UPLOADED_FILES_DIR,
  sandboxUploadedFilePath,
} from '@lobechat/builtin-tool-cloud-sandbox';

/** Marker file written once the uploaded files have been synced for a session. */
export const SANDBOX_FILES_INIT_MARKER = `${SANDBOX_UPLOADED_FILES_DIR}/.lobe-files-initialized`;

/** Timeout (ms) for the bootstrap download command. */
export const SANDBOX_INIT_TIMEOUT_MS = 120_000;

export interface SandboxInitDownload {
  id?: string;
  version?: string;
  size?: number;
  name: string;
  /** A download URL (e.g. presigned) the sandbox can fetch with curl. */
  url: string;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/** Per-file/version registration: only a validated, atomically renamed download is ready. */
export const buildSandboxFilesInitCommand = (downloads: SandboxInitDownload[]): string => {
  const dir = shellQuote(SANDBOX_UPLOADED_FILES_DIR);
  const seen = new Set<string>();
  const commands: string[] = [];
  for (const { id, name, url, version, size } of downloads) {
    if (!url) continue;
    const target = sandboxUploadedFilePath(name, id);
    if (seen.has(target)) continue;
    seen.add(target);
    const digest = createHash('sha256')
      .update(`${id ?? name}:${version ?? size ?? 'legacy'}`)
      .digest('hex');
    const marker = `${target}.${digest}.ready`;
    const parent = target.slice(0, target.lastIndexOf('/'));
    const temp = `${target}.download`;
    const validate =
      typeof size === 'number'
        ? `test "$(wc -c < ${shellQuote(temp)} | tr -d ' ')" -eq ${Math.max(0, Math.floor(size))} && `
        : '';
    commands.push(
      `if [ ! -f ${shellQuote(marker)} ] || [ ! -f ${shellQuote(target)} ]; then mkdir -p ${shellQuote(parent)} && curl -fsSL ${shellQuote(url)} -o ${shellQuote(temp)} && ${validate}mv ${shellQuote(temp)} ${shellQuote(target)} && touch ${shellQuote(marker)} || exit 1; fi`,
    );
  }
  return commands.length ? `mkdir -p ${dir}; ${commands.join('; ')}` : `mkdir -p ${dir}`;
};
