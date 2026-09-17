// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { FileUploadService } from '../../packages/openapi/src/services/file.service';

describe('FileUploadService browser file access', () => {
  it('returns a public signed URL from the file URL endpoint', async () => {
    const createBrowserFileAccessUrl = vi
      .fn()
      .mockResolvedValue('https://public.example.com/files/report.pdf');
    const createPreSignedUrlForPreview = vi
      .fn()
      .mockResolvedValue('https://internal.example.com/files/report.pdf');
    const service: any = Object.create(FileUploadService.prototype);

    service.resolveOperationPermission = vi.fn().mockResolvedValue({ isPermitted: true });
    service.findFileByIdWithPermission = vi.fn().mockResolvedValue({
      id: 'file-1',
      name: 'report.pdf',
      url: 'files/report.pdf',
    });
    service.coreFileService = { createBrowserFileAccessUrl };
    service.s3Service = { createPreSignedUrlForPreview };
    service.log = vi.fn();

    await expect(service.getFileUrl('file-1', { expiresIn: 900 })).resolves.toMatchObject({
      expiresIn: 900,
      fileId: 'file-1',
      name: 'report.pdf',
      url: 'https://public.example.com/files/report.pdf',
    });
    expect(createBrowserFileAccessUrl).toHaveBeenCalledWith('files/report.pdf', {
      expiresIn: 900,
    });
    expect(createPreSignedUrlForPreview).not.toHaveBeenCalled();
  });
});
