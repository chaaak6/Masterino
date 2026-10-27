import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ReadableStream } from 'node:stream/web';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { netFetch } from '@/utils/net-fetch';

import { downloadArtifact, verifyArtifact } from './artifactDownloader';

vi.mock('@/utils/net-fetch', () => ({ netFetch: vi.fn() }));

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((item) => fs.rm(item, { force: true, recursive: true })));
});

describe('verifyArtifact', () => {
  it('accepts matching size and SHA512', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-update-'));
    created.push(dir);
    const file = path.join(dir, 'update.dmg');
    const content = Buffer.from('verified update');
    await fs.writeFile(file, content);
    await expect(
      verifyArtifact(file, {
        arch: 'arm64',
        path: 'canary/1.1.4/update.dmg',
        platform: 'darwin',
        sha512: createHash('sha512').update(content).digest('base64'),
        size: content.length,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a checksum mismatch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-update-'));
    created.push(dir);
    const file = path.join(dir, 'update.dmg');
    await fs.writeFile(file, 'tampered');
    await expect(
      verifyArtifact(file, {
        arch: 'arm64',
        path: 'canary/1.1.4/update.dmg',
        platform: 'darwin',
        sha512: 'invalid',
        size: 8,
      }),
    ).rejects.toMatchObject({ code: 'integrity' });
  });

  it('reaches integrity verification when Electron returns an empty response URL', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-update-'));
    created.push(dir);
    const body = Buffer.from('tampered');
    vi.mocked(netFetch).mockResolvedValue({
      body: new ReadableStream({
        start: (controller) => {
          controller.enqueue(body);
          controller.close();
        },
      }),
      ok: true,
      status: 200,
      // Electron documents Response.url as unreliable; in Electron 41 it is empty.
      url: '',
    } as any);

    await expect(
      downloadArtifact({
        artifact: {
          arch: 'arm64',
          path: 'canary/1.1.4/update.dmg',
          platform: 'darwin',
          sha512: 'invalid',
          size: body.length,
        },
        baseUrl: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases',
        destinationDir: dir,
      }),
    ).rejects.toMatchObject({ code: 'integrity' });
    await expect(fs.access(path.join(dir, 'update.dmg.part'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'update.dmg'))).rejects.toThrow();
  });

  it('reuses a verified installer across downloader instances without a second GET', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-update-'));
    created.push(dir);
    const body = Buffer.from('small synthetic installation package');
    const artifact = {
      arch: 'arm64' as const,
      platform: 'darwin' as const,
      path: 'canary/1.1.4/update.dmg',
      size: body.length,
      sha512: createHash('sha512').update(body).digest('base64'),
    };
    vi.mocked(netFetch).mockClear();
    vi.mocked(netFetch).mockResolvedValue(new Response(body));
    const options = {
      artifact,
      baseUrl: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases',
      destinationDir: dir,
    };
    await downloadArtifact(options);
    await downloadArtifact(options);
    expect(netFetch).toHaveBeenCalledTimes(1);
    await fs.writeFile(path.join(dir, 'update.dmg'), 'damaged');
    vi.mocked(netFetch).mockResolvedValue(new Response(body));
    await downloadArtifact(options);
    expect(netFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects cross-origin redirects without writing a file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-update-'));
    created.push(dir);
    vi.mocked(netFetch).mockResolvedValue({
      body: null,
      ok: false,
      status: 302,
      url: 'https://example.com/update.dmg',
    } as any);

    await expect(
      downloadArtifact({
        artifact: {
          arch: 'x64',
          path: 'canary/1.1.4/update.dmg',
          platform: 'darwin',
          sha512: 'invalid',
          size: 1,
        },
        baseUrl: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases',
        destinationDir: dir,
      }),
    ).rejects.toMatchObject({ code: 'network' });
    await expect(fs.access(path.join(dir, 'update.dmg.part'))).rejects.toThrow();
  });
});
