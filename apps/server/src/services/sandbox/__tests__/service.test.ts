import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileService } from '@/server/services/file';
import type { MarketService } from '@/server/services/market';

import type { SandboxProvider } from '../types';

describe('SandboxMiddlewareService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('uploads provider exports through the shared file record flow', async () => {
    const { SandboxMiddlewareService: TestSandboxMiddlewareService } = await import('../service');
    const exportFileToUploadUrl = vi.fn(async () => ({
      result: { mime_type: 'text/plain' },
      success: true,
    }));
    const provider = {
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool: vi.fn(),
      exportFileToUploadUrl,
      kind: 'onlyboxes',
    } satisfies SandboxProvider;

    const fileService = {
      createPreSignedUpload: vi.fn(async () => ({
        headers: { 'x-amz-acl': 'public-read' },
        url: 'https://uploads.example.com/put',
      })),
      createFileRecord: vi.fn(async () => ({ fileId: 'file-1', url: '/f/file-1' })),
      getFileMetadata: vi.fn(async () => ({
        contentLength: 42,
        contentType: 'text/csv',
      })),
    } as unknown as FileService;

    const service = new TestSandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.exportAndUploadFile('/workspace/result.csv', 'result.csv');

    expect(result).toMatchObject({
      fileId: 'file-1',
      filename: 'result.csv',
      mimeType: 'text/csv',
      size: 42,
      success: true,
      url: '/f/file-1',
    });
    expect(exportFileToUploadUrl).toHaveBeenCalledWith({
      filename: 'result.csv',
      path: '/workspace/result.csv',
      uploadHeaders: { 'x-amz-acl': 'public-read' },
      uploadUrl: 'https://uploads.example.com/put',
    });
    expect(fileService.createPreSignedUpload).toHaveBeenCalledWith(
      expect.stringMatching(
        /^code-interpreter-exports\/\d{4}-\d{2}-\d{2}\/topic-1\/[^/]+\/result\.csv$/,
      ),
      { contentType: 'text/csv' },
    );
    expect(fileService.createFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fileType: 'text/csv',
        name: 'result.csv',
        size: 42,
        url: expect.stringMatching(
          /^code-interpreter-exports\/\d{4}-\d{2}-\d{2}\/topic-1\/[^/]+\/result\.csv$/,
        ),
      }),
    );
  });

  it('normalizes provider failures and redacts signed URLs before returning them', async () => {
    const provider = {
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool: vi.fn(),
      exportFileToUploadUrl: vi.fn(async () => ({
        error: {
          message:
            'PUT https://bucket.oss.example.com/report.txt?X-Amz-Credential=secret timed out',
          name: 'network_error',
        },
        success: false,
      })),
      kind: 'onlyboxes',
    } satisfies SandboxProvider;

    const { SandboxMiddlewareService } = await import('../service');
    const fileService = {
      createFileRecord: vi.fn(),
      createPreSignedUpload: vi.fn(async () => ({ url: 'https://uploads.example.com/put' })),
      getFileMetadata: vi.fn(),
    } as unknown as FileService;

    const service = new SandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.exportAndUploadFile('/workspace/missing.txt', 'missing.txt');

    expect(result).toMatchObject({
      error: {
        code: 'WORKER_UPLOAD_FAILED',
        message: 'PUT [redacted-url] timed out',
        name: 'network_error',
        retryable: true,
        stage: 'upload',
      },
      filename: 'missing.txt',
      success: false,
    });
    expect(provider.exportFileToUploadUrl).toHaveBeenCalledTimes(2);
    expect(fileService.getFileMetadata).not.toHaveBeenCalled();
    expect(fileService.createFileRecord).not.toHaveBeenCalled();
  });

  it('falls back to a bounded server upload after worker upload retries fail', async () => {
    const provider = {
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool: vi.fn(),
      exportFileToUploadUrl: vi.fn(async () => ({
        error: { message: 'connect timeout' },
        success: false,
      })),
      inspectFileForExport: vi.fn(async () => ({
        mimeType: 'text/html',
        size: 12,
        success: true,
      })),
      kind: 'onlyboxes',
      readFileForExport: vi.fn(async () => ({
        contentBase64: Buffer.from('<h1>ok</h1>').toString('base64'),
        mimeType: 'text/html',
        size: 11,
        success: true,
      })),
    } satisfies SandboxProvider;

    const { SandboxMiddlewareService } = await import('../service');
    const fileService = {
      createFileRecord: vi.fn(async () => ({ fileId: 'file-2', url: '/f/file-2' })),
      createPreSignedUpload: vi.fn(async () => ({ url: 'https://uploads.example.com/put' })),
      getFileMetadata: vi.fn(async () => ({ contentLength: 11, contentType: 'text/html' })),
      uploadBuffer: vi.fn(async (key: string) => ({ key })),
    } as unknown as FileService;

    const service = new SandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.exportAndUploadFile('/workspace/report.html', 'report.html');

    expect(result).toMatchObject({ fileId: 'file-2', success: true, url: '/f/file-2' });
    expect(provider.exportFileToUploadUrl).toHaveBeenCalledTimes(2);
    expect(provider.readFileForExport).toHaveBeenCalledWith(
      '/workspace/report.html',
      10 * 1024 * 1024,
    );
    expect(fileService.uploadBuffer).toHaveBeenCalledWith(
      expect.stringMatching(/\/report\.html$/),
      Buffer.from('<h1>ok</h1>'),
      'text/html',
    );
  });

  it('does not transfer oversized files through the server fallback', async () => {
    const provider = {
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      callTool: vi.fn(),
      exportFileToUploadUrl: vi.fn(async () => ({
        error: { message: 'network blocked' },
        success: false,
      })),
      inspectFileForExport: vi.fn(async () => ({
        mimeType: 'application/zip',
        size: 10 * 1024 * 1024 + 1,
        success: true,
      })),
      kind: 'onlyboxes',
      readFileForExport: vi.fn(),
    } satisfies SandboxProvider;

    const { SandboxMiddlewareService } = await import('../service');
    const fileService = {
      createPreSignedUpload: vi.fn(async () => ({ url: 'https://uploads.example.com/put' })),
    } as unknown as FileService;
    const service = new SandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await service.exportAndUploadFile('/workspace/archive.zip', 'archive.zip');

    expect(result).toMatchObject({
      error: { code: 'FALLBACK_FILE_TOO_LARGE', stage: 'fallback' },
      size: 10 * 1024 * 1024 + 1,
      success: false,
    });
    expect(provider.readFileForExport).not.toHaveBeenCalled();
  });
});
