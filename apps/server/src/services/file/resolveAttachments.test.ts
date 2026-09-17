// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAttachmentMetadata, resolveAttachmentsByFileIds } from './resolveAttachments';

const { findByIds, getFileAccessUrl, getFullFileUrl } = vi.hoisted(() => ({
  findByIds: vi.fn(),
  getFileAccessUrl: vi.fn(),
  getFullFileUrl: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: class {
    findByIds = findByIds;
  },
}));

vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = getFileAccessUrl;
    getFullFileUrl = getFullFileUrl;
  },
}));

describe('resolveAttachmentMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByIds.mockResolvedValue([
      {
        fileType: 'application/pdf',
        id: 'file-1',
        name: 'report.pdf',
        size: 128,
        url: 'files/report.pdf',
      },
    ]);
    getFileAccessUrl.mockResolvedValue('https://app.example.com/f/file-1');
    getFullFileUrl.mockResolvedValue('https://internal.example.com/files/report.pdf');
  });

  it('returns the stable file proxy URL for attachment metadata sent to clients', async () => {
    await expect(
      resolveAttachmentMetadata({
        db: {} as any,
        fileIds: ['file-1'],
        userId: 'user-1',
      }),
    ).resolves.toEqual([
      {
        fileType: 'application/pdf',
        id: 'file-1',
        name: 'report.pdf',
        size: 128,
        url: 'https://app.example.com/f/file-1',
      },
    ]);
    expect(getFileAccessUrl).toHaveBeenCalledWith({ id: 'file-1', url: 'files/report.pdf' });
    expect(getFullFileUrl).not.toHaveBeenCalled();
  });

  it('returns public signed media URLs to the model prompt layer', async () => {
    findByIds.mockResolvedValue([
      {
        fileType: 'image/png',
        id: 'image-1',
        name: 'diagram.png',
        size: 256,
        url: 'files/diagram.png',
      },
    ]);
    getFileAccessUrl.mockResolvedValue('https://public.example.com/files/diagram.png');

    const result = await resolveAttachmentsByFileIds({
      db: {} as any,
      fileIds: ['image-1'],
      userId: 'user-1',
    });

    expect(result.imageList).toEqual([
      {
        alt: 'diagram.png',
        id: 'image-1',
        url: 'https://public.example.com/files/diagram.png',
      },
    ]);
    expect(getFileAccessUrl).toHaveBeenCalledWith({ id: 'image-1', url: 'files/diagram.png' });
    expect(getFullFileUrl).not.toHaveBeenCalled();
  });
});
