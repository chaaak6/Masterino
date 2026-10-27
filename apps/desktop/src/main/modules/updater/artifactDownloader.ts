import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { ProgressInfo } from '@lobechat/electron-client-ipc';

import { netFetch } from '@/utils/net-fetch';

import type { DesktopUpdateArtifact } from './signedManifest';
import { resolveArtifactUrl } from './signedManifest';

export class ArtifactDownloadError extends Error {
  constructor(
    message: string,
    public readonly code: 'disk' | 'integrity' | 'install' | 'network',
  ) {
    super(message);
    this.name = 'ArtifactDownloadError';
  }
}

export const verifyArtifact = async (filePath: string, artifact: DesktopUpdateArtifact) => {
  const stat = await fs.stat(filePath);
  if (stat.size !== artifact.size)
    throw new ArtifactDownloadError('Downloaded update size mismatch', 'integrity');

  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  if (hash.digest('base64') !== artifact.sha512) {
    throw new ArtifactDownloadError('Downloaded update checksum mismatch', 'integrity');
  }
};

export const findCachedArtifact = async (
  artifact: DesktopUpdateArtifact,
  destinationDir: string,
) => {
  const file = path.join(destinationDir, path.basename(artifact.path));
  try {
    await verifyArtifact(file, artifact);
    return file;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof ArtifactDownloadError
    )
      return;
    throw error;
  }
};

export const downloadArtifact = async ({
  artifact,
  baseUrl,
  destinationDir,
  onProgress,
  onVerifying,
  signal,
}: {
  artifact: DesktopUpdateArtifact;
  baseUrl: string;
  destinationDir: string;
  onProgress?: (progress: ProgressInfo) => void;
  onVerifying?: () => void;
  signal?: AbortSignal;
}): Promise<string> => {
  signal?.throwIfAborted();
  const cached = await findCachedArtifact(artifact, destinationDir);
  signal?.throwIfAborted();
  if (cached) return cached;
  const url = resolveArtifactUrl(baseUrl, artifact.path);
  await fs.mkdir(destinationDir, { recursive: true });
  const finalPath = path.join(destinationDir, path.basename(artifact.path));
  const partialPath = `${finalPath}.part`;
  await fs.rm(partialPath, { force: true });

  const stalled = new AbortController();
  const downloadSignal = signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const noteActivity = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stalled.abort(new Error('Update download stalled')), 60_000);
  };
  noteActivity();
  try {
    const response = await netFetch(url.toString(), { redirect: 'manual', signal: downloadSignal });
    // Do not read Electron's unreliable Response.url; manual redirects are not followed.
    if (response.status >= 300 && response.status < 400) {
      throw new ArtifactDownloadError('Update downloads may not redirect', 'network');
    }
    if (!response.ok || !response.body) {
      throw new ArtifactDownloadError(
        `Update download failed with HTTP ${response.status}`,
        'network',
      );
    }
    let transferred = 0;
    const startedAt = Date.now();
    const tracked = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        noteActivity();
        transferred += chunk.byteLength;
        if (transferred > artifact.size)
          throw new ArtifactDownloadError('Downloaded update exceeds its signed size', 'integrity');
        const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
        onProgress?.({
          bytesPerSecond: transferred / seconds,
          percent: Math.min((transferred / artifact.size) * 100, 100),
          total: artifact.size,
          transferred,
        });
        controller.enqueue(chunk);
      },
    });
    const readable = Readable.fromWeb(response.body.pipeThrough(tracked) as any);
    await pipeline(readable, createWriteStream(partialPath, { flags: 'wx' }));
    clearTimeout(idleTimer);
    signal?.throwIfAborted();
    onVerifying?.();
    await verifyArtifact(partialPath, artifact);
    signal?.throwIfAborted();
    await fs.rm(finalPath, { force: true });
    await fs.rename(partialPath, finalPath);
    return finalPath;
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => undefined);
    if (signal?.aborted) throw new DOMException('Update download cancelled', 'AbortError');
    if (error instanceof ArtifactDownloadError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOSPC' || code === 'EACCES' || code === 'EROFS') {
      throw new ArtifactDownloadError('Unable to write the update to disk', 'disk');
    }
    throw new ArtifactDownloadError('Unable to download the update from OSS', 'network');
  } finally {
    clearTimeout(idleTimer);
  }
};
