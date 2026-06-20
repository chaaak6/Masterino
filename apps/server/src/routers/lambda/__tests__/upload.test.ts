// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRouter } from '../upload';

const { mockCreatePreSignedUrl, mockCreateS3UploadProxyUrl, mockFileS3 } = vi.hoisted(() => {
  const mockCreatePreSignedUrl = vi.fn();
  const mockCreateS3UploadProxyUrl = vi.fn();
  const mockFileS3 = vi.fn(() => ({
    createPreSignedUrl: mockCreatePreSignedUrl,
  }));

  return { mockCreatePreSignedUrl, mockCreateS3UploadProxyUrl, mockFileS3 };
});

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/server/modules/S3', () => ({
  FileS3: mockFileS3,
}));

vi.mock('@/server/services/file/uploadProxyToken', () => ({
  createS3UploadProxyUrl: mockCreateS3UploadProxyUrl,
}));

describe('uploadRouter', () => {
  const caller = () => uploadRouter.createCaller({ userId: 'user-1' });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateS3UploadProxyUrl.mockImplementation(
      (key: string) => `/api/upload/s3-proxy?key=${encodeURIComponent(key)}&expires=1&signature=sig`,
    );
    mockCreatePreSignedUrl.mockResolvedValue('https://s3.example.com/bucket/files/test.png?sig=1');
  });

  it('returns the same-origin upload proxy URL for browser uploads', async () => {
    const result = await caller().createS3PreSignedUpload({ pathname: 'files/test image.png' });

    expect(result).toEqual({
      url: '/api/upload/s3-proxy?key=files%2Ftest%20image.png&expires=1&signature=sig',
    });
    expect(mockCreateS3UploadProxyUrl).toHaveBeenCalledWith('files/test image.png');
    expect(mockFileS3).not.toHaveBeenCalled();
  });

  it('keeps the legacy presigned URL endpoint for CLI uploads', async () => {
    const result = await caller().createS3PreSignedUrl({ pathname: 'files/test.png' });

    expect(result).toBe('https://s3.example.com/bucket/files/test.png?sig=1');
    expect(mockFileS3).toHaveBeenCalledTimes(1);
    expect(mockCreatePreSignedUrl).toHaveBeenCalledWith('files/test.png');
  });
});
