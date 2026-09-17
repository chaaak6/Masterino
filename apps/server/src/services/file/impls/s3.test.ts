import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';

import { S3StaticFileImpl } from './s3';

const redisMocks = vi.hoisted(() => ({
  getRedisConfig: vi.fn(() => ({ enabled: false, prefix: 'lobechat', tls: false, url: '' })),
  initializeRedis: vi.fn(),
  isRedisEnabled: vi.fn(() => false),
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const config = {
  S3_ENABLE_PATH_STYLE: false,
  S3_ENDPOINT: 'https://oss-cn-shenzhen-internal.aliyuncs.com',
  S3_PUBLIC_DOMAIN: 'https://example.com',
  S3_PUBLIC_READ_ENDPOINT: 'https://oss-cn-shenzhen.aliyuncs.com',
  S3_BUCKET: 'my-bucket',
  S3_PREVIEW_URL_EXPIRE_IN: 7200,
  S3_SET_ACL: true,
};

// 模拟 fileEnv
vi.mock('@/envs/file', () => ({
  get fileEnv() {
    return config;
  },
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: redisMocks.getRedisConfig,
}));

vi.mock('@/libs/redis', () => ({
  initializeRedis: redisMocks.initializeRedis,
  isRedisEnabled: redisMocks.isRedisEnabled,
}));

// 模拟 S3 类
vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn().mockImplementation(() => ({
    assertBrowserFileUrl: vi.fn((url: string) => {
      if (new URL(url).origin !== new URL(config.S3_PUBLIC_DOMAIN).origin) {
        throw new Error(`Unexpected browser file URL origin: ${new URL(url).origin}`);
      }
    }),
    createBrowserPreSignedUrlForDownload: vi
      .fn()
      .mockResolvedValue('https://example.com/browser-download'),
    createBrowserPreSignedUrlForPreview: vi
      .fn()
      .mockResolvedValue('https://example.com/browser-preview.jpg'),
    createPreSignedUrlForPreview: vi
      .fn()
      .mockResolvedValue('https://presigned.example.com/test.jpg'),
    createPreSignedUrlForDownload: vi
      .fn()
      .mockResolvedValue('https://presigned.example.com/download'),
    getFileContent: vi.fn().mockResolvedValue('file content'),
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    getFileMetadata: vi.fn().mockResolvedValue({ contentLength: 1024, contentType: 'image/png' }),
    deleteFile: vi.fn().mockResolvedValue({}),
    deleteFiles: vi.fn().mockResolvedValue({}),
    createPreSignedUpload: vi.fn().mockResolvedValue({
      headers: { 'x-amz-acl': 'public-read' },
      url: 'https://upload.example.com/test.jpg',
    }),
    createPreSignedUrl: vi.fn().mockResolvedValue('https://upload.example.com/test.jpg'),
    uploadContent: vi.fn().mockResolvedValue({}),
    uploadMedia: vi.fn().mockResolvedValue({}),
  })),
}));

// Mock db
const mockDb = {} as any;

describe('S3StaticFileImpl', () => {
  let fileService: S3StaticFileImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    config.S3_ENABLE_PATH_STYLE = false;
    config.S3_PUBLIC_DOMAIN = 'https://example.com';
    config.S3_SET_ACL = true;
    redisMocks.getRedisConfig.mockReturnValue({
      enabled: false,
      prefix: 'lobechat',
      tls: false,
      url: '',
    });
    redisMocks.isRedisEnabled.mockReturnValue(false);
    redisMocks.initializeRedis.mockResolvedValue(redisMocks.redis as any);
    redisMocks.redis.get.mockResolvedValue(null);
    redisMocks.redis.set.mockResolvedValue('OK');
    fileService = new S3StaticFileImpl(mockDb);
  });

  describe('getFullFileUrl', () => {
    it('should return empty string for null or undefined input', async () => {
      expect(await fileService.getFullFileUrl(null)).toBe('');
      expect(await fileService.getFullFileUrl(undefined)).toBe('');
    });

    it('returns a public presigned URL when S3_SET_ACL is false', async () => {
      config.S3_SET_ACL = false;
      const url = 'path/to/file.jpg';
      expect(await fileService.getFullFileUrl(url)).toBe('https://example.com/browser-preview.jpg');
      expect(fileService['s3'].createPreSignedUrlForPreview).not.toHaveBeenCalled();
      config.S3_SET_ACL = true;
    });

    it('should reuse cached presigned preview URL for repeated private preview requests', async () => {
      config.S3_SET_ACL = false;
      const url = 'path/to/cached-file.jpg';
      const createBrowserPreSignedUrlForPreview =
        fileService['s3'].createBrowserPreSignedUrlForPreview;

      await expect(fileService.getFullFileUrl(url)).resolves.toBe(
        'https://example.com/browser-preview.jpg',
      );
      await expect(fileService.getFullFileUrl(url)).resolves.toBe(
        'https://example.com/browser-preview.jpg',
      );

      expect(createBrowserPreSignedUrlForPreview).toHaveBeenCalledTimes(1);
      config.S3_SET_ACL = true;
    });

    it('should reuse Redis cached presigned preview URL across function instances', async () => {
      config.S3_SET_ACL = false;
      redisMocks.getRedisConfig.mockReturnValue({
        enabled: true,
        prefix: 'lobechat',
        tls: false,
        url: 'redis://localhost:6379',
      });
      redisMocks.isRedisEnabled.mockReturnValue(true);
      redisMocks.redis.get.mockResolvedValue('https://example.com/cached.jpg');

      const result = await fileService.getFullFileUrl('path/to/redis-cached-file.jpg');

      expect(result).toBe('https://example.com/cached.jpg');
      expect(fileService['s3'].createBrowserPreSignedUrlForPreview).not.toHaveBeenCalled();
    });

    it('should write generated presigned preview URL to Redis when available', async () => {
      config.S3_SET_ACL = false;
      redisMocks.getRedisConfig.mockReturnValue({
        enabled: true,
        prefix: 'lobechat',
        tls: false,
        url: 'redis://localhost:6379',
      });
      redisMocks.isRedisEnabled.mockReturnValue(true);
      redisMocks.redis.get.mockResolvedValue(null);

      await expect(fileService.getFullFileUrl('path/to/redis-write-file.jpg')).resolves.toBe(
        'https://example.com/browser-preview.jpg',
      );

      expect(redisMocks.redis.set).toHaveBeenCalledWith(
        'file:browser-presigned-preview:v1:example.com:7200:path/to/redis-write-file.jpg',
        'https://example.com/browser-preview.jpg',
        { ex: 3600 },
      );
    });

    it('should return correct URL when S3_ENABLE_PATH_STYLE is false', async () => {
      const url = 'path/to/file.jpg';
      expect(await fileService.getFullFileUrl(url)).toBe('https://example.com/path/to/file.jpg');
    });

    it('should return correct URL when S3_ENABLE_PATH_STYLE is true', async () => {
      config.S3_ENABLE_PATH_STYLE = true;
      const url = 'path/to/file.jpg';
      expect(await fileService.getFullFileUrl(url)).toBe(
        'https://example.com/my-bucket/path/to/file.jpg',
      );
      config.S3_ENABLE_PATH_STYLE = false;
    });

    it('does not append the bucket twice when the public domain is already the path-style bucket root', async () => {
      config.S3_ENABLE_PATH_STYLE = true;
      config.S3_PUBLIC_DOMAIN = 'https://example.com/my-bucket';

      await expect(fileService.getFullFileUrl('path/to/file.jpg')).resolves.toBe(
        'https://example.com/my-bucket/path/to/file.jpg',
      );

      config.S3_ENABLE_PATH_STYLE = false;
      config.S3_PUBLIC_DOMAIN = 'https://example.com';
    });

    it('does not append the bucket path when the public domain is already bucket-scoped by hostname', async () => {
      config.S3_ENABLE_PATH_STYLE = true;
      config.S3_PUBLIC_DOMAIN = 'https://my-bucket.example.com';

      await expect(fileService.getFullFileUrl('path/to/file.jpg')).resolves.toBe(
        'https://my-bucket.example.com/path/to/file.jpg',
      );

      config.S3_ENABLE_PATH_STYLE = false;
      config.S3_PUBLIC_DOMAIN = 'https://example.com';
    });

    // Legacy bug compatibility tests - https://github.com/lobehub/lobe-chat/issues/8994
    describe('legacy bug compatibility', () => {
      it('should handle full URL input by extracting key (S3_SET_ACL=false)', async () => {
        config.S3_SET_ACL = false;
        const fullUrl = 'https://example.com/path/to/file.jpg?X-Amz-Signature=expired';

        // Mock getKeyFromFullUrl to return the extracted key
        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(fullUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(fullUrl);
        expect(result).toBe('https://example.com/browser-preview.jpg');
        config.S3_SET_ACL = true;
      });

      it('should handle full URL input by extracting key (S3_SET_ACL=true)', async () => {
        const fullUrl = 'https://example.com/path/to/file.jpg';

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(fullUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(fullUrl);
        expect(result).toBe('https://example.com/path/to/file.jpg');
      });

      it('should handle normal key input without extraction', async () => {
        const key = 'path/to/file.jpg';

        const spy = vi.spyOn(fileService, 'getKeyFromFullUrl');

        const result = await fileService.getFullFileUrl(key);

        expect(spy).not.toHaveBeenCalled();
        expect(result).toBe('https://example.com/path/to/file.jpg');
      });

      it('should handle http:// URLs for legacy compatibility', async () => {
        const httpUrl = 'http://example.com/path/to/file.jpg';

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('path/to/file.jpg');

        const result = await fileService.getFullFileUrl(httpUrl);

        expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(httpUrl);
        expect(result).toBe('https://example.com/path/to/file.jpg');
      });

      it('should throw error when key extraction returns null', async () => {
        const fullUrl = 'https://s3.example.com/f/nonexistent';

        vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue(null);

        await expect(fileService.getFullFileUrl(fullUrl)).rejects.toThrow(
          'Key not found from url: ' + fullUrl,
        );
      });
    });
  });

  describe('createCachedPreSignedUrlForPreview', () => {
    it('should return empty string for null or undefined input', async () => {
      expect(await fileService.createCachedPreSignedUrlForPreview(null)).toBe('');
      expect(await fileService.createCachedPreSignedUrlForPreview(undefined)).toBe('');
    });

    it('should always return a cached presigned preview URL even when public URLs are available', async () => {
      const fullUrl = 'https://example.com/path/to/proxy-only-file.jpg';
      const createPreSignedUrlForPreview = fileService['s3'].createPreSignedUrlForPreview;

      vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('path/to/proxy-only-file.jpg');

      await expect(fileService.createCachedPreSignedUrlForPreview(fullUrl, 300)).resolves.toBe(
        'https://presigned.example.com/test.jpg',
      );
      await expect(fileService.createCachedPreSignedUrlForPreview(fullUrl, 300)).resolves.toBe(
        'https://presigned.example.com/test.jpg',
      );

      expect(fileService.getKeyFromFullUrl).toHaveBeenCalledWith(fullUrl);
      expect(createPreSignedUrlForPreview).toHaveBeenCalledTimes(1);
    });
  });

  describe('createBrowserFileAccessUrl', () => {
    it('returns third-party URLs unchanged instead of treating their paths as bucket keys', async () => {
      const externalUrl = 'https://cdn.third-party.example/assets/image.png';

      await expect(fileService.createBrowserFileAccessUrl(externalUrl)).resolves.toBe(externalUrl);

      expect(fileService['s3'].createBrowserPreSignedUrlForPreview).not.toHaveBeenCalled();
    });

    it('uses a separate browser cache namespace instead of a cached internal URL', async () => {
      redisMocks.getRedisConfig.mockReturnValue({
        enabled: true,
        prefix: 'lobechat',
        tls: false,
        url: 'redis://localhost:6379',
      });
      redisMocks.isRedisEnabled.mockReturnValue(true);
      redisMocks.redis.get.mockImplementation(async (key: string) =>
        key.startsWith('file:presigned-preview:')
          ? 'https://bucket.oss-cn-shenzhen-internal.aliyuncs.com/files/browser-report.html'
          : null,
      );

      await expect(
        fileService.createBrowserFileAccessUrl('files/browser-report.html', { expiresIn: 300 }),
      ).resolves.toBe('https://example.com/browser-preview.jpg');

      expect(redisMocks.redis.get).toHaveBeenCalledWith(
        'file:browser-presigned-preview:v1:example.com:300:files/browser-report.html',
      );
      expect(fileService['s3'].createBrowserPreSignedUrlForPreview).toHaveBeenCalledWith(
        'files/browser-report.html',
        300,
      );
      expect(redisMocks.redis.set).toHaveBeenCalledWith(
        'file:browser-presigned-preview:v1:example.com:300:files/browser-report.html',
        'https://example.com/browser-preview.jpg',
        { ex: 240 },
      );
    });

    it('discards an internal URL found in the browser Redis cache and signs a new one', async () => {
      redisMocks.getRedisConfig.mockReturnValue({
        enabled: true,
        prefix: 'lobechat',
        tls: false,
        url: 'redis://localhost:6379',
      });
      redisMocks.isRedisEnabled.mockReturnValue(true);
      redisMocks.redis.get.mockResolvedValue(
        'https://bucket.oss-cn-shenzhen-internal.aliyuncs.com/files/stale-browser-report.html',
      );

      await expect(
        fileService.createBrowserFileAccessUrl('files/stale-browser-report.html', {
          expiresIn: 300,
        }),
      ).resolves.toBe('https://example.com/browser-preview.jpg');

      expect(fileService['s3'].assertBrowserFileUrl).toHaveBeenCalledWith(
        'https://bucket.oss-cn-shenzhen-internal.aliyuncs.com/files/stale-browser-report.html',
      );
      expect(fileService['s3'].createBrowserPreSignedUrlForPreview).toHaveBeenCalledWith(
        'files/stale-browser-report.html',
        300,
      );
      expect(redisMocks.redis.set).toHaveBeenCalledWith(
        'file:browser-presigned-preview:v1:example.com:300:files/stale-browser-report.html',
        'https://example.com/browser-preview.jpg',
        { ex: 240 },
      );
    });

    it('signs explicit downloads without using the preview cache', async () => {
      await expect(
        fileService.createBrowserFileAccessUrl('files/browser-download.html', {
          contentDisposition: 'attachment; filename="browser-download.html"',
          expiresIn: 300,
        }),
      ).resolves.toBe('https://example.com/browser-download');

      expect(fileService['s3'].createBrowserPreSignedUrlForDownload).toHaveBeenCalledWith(
        'files/browser-download.html',
        'attachment; filename="browser-download.html"',
        300,
      );
      expect(redisMocks.redis.get).not.toHaveBeenCalled();
      expect(redisMocks.redis.set).not.toHaveBeenCalled();
    });

    it('resolves legacy full URLs before creating browser access URLs', async () => {
      vi.spyOn(fileService, 'getKeyFromFullUrl').mockResolvedValue('files/legacy-report.html');

      await fileService.createBrowserFileAccessUrl(
        'https://example.com/files/legacy-report.html?expired=1',
      );

      expect(fileService['s3'].createBrowserPreSignedUrlForPreview).toHaveBeenCalledWith(
        'files/legacy-report.html',
        undefined,
      );
    });
  });

  describe('getFileContent', () => {
    it('应该返回文件内容', async () => {
      expect(await fileService.getFileContent('test.txt')).toBe('file content');
    });
  });

  describe('getFileByteArray', () => {
    it('应该返回文件字节数组', async () => {
      const result = await fileService.getFileByteArray('test.jpg');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(3);
    });
  });

  describe('deleteFile', () => {
    it('应该调用S3的deleteFile方法', async () => {
      await fileService.deleteFile('test.jpg');
      expect(fileService['s3'].deleteFile).toHaveBeenCalledWith('test.jpg');
    });
  });

  describe('deleteFiles', () => {
    it('应该调用S3的deleteFiles方法', async () => {
      await fileService.deleteFiles(['test1.jpg', 'test2.jpg']);
      expect(fileService['s3'].deleteFiles).toHaveBeenCalledWith(['test1.jpg', 'test2.jpg']);
    });
  });

  describe('createPreSignedUrl', () => {
    it('应该调用S3的createPreSignedUrl方法', async () => {
      const result = await fileService.createPreSignedUrl('test.jpg');
      expect(result).toBe('https://upload.example.com/test.jpg');
    });
  });

  describe('createPreSignedUpload', () => {
    it('should call S3 createPreSignedUpload and return upload headers', async () => {
      const result = await fileService.createPreSignedUpload('test.jpg');

      expect(fileService['s3'].createPreSignedUpload).toHaveBeenCalledWith('test.jpg');
      expect(result).toEqual({
        headers: { 'x-amz-acl': 'public-read' },
        url: 'https://upload.example.com/test.jpg',
      });
    });
  });

  describe('getFileMetadata', () => {
    it('should call S3 getFileMetadata and return metadata', async () => {
      const result = await fileService.getFileMetadata('test.png');

      expect(fileService['s3'].getFileMetadata).toHaveBeenCalledWith('test.png');
      expect(result).toEqual({ contentLength: 1024, contentType: 'image/png' });
    });

    it('should handle S3 errors', async () => {
      const error = new Error('File not found');
      fileService['s3'].getFileMetadata = vi.fn().mockRejectedValue(error);

      await expect(fileService.getFileMetadata('non-existent.txt')).rejects.toThrow(
        'File not found',
      );
    });
  });

  describe('uploadContent', () => {
    it('应该调用S3的uploadContent方法', async () => {
      await fileService.uploadContent('test.jpg', 'content');
      expect(fileService['s3'].uploadContent).toHaveBeenCalledWith('test.jpg', 'content');
    });
  });

  describe('getKeyFromFullUrl', () => {
    it('should extract fileId from proxy URL and return S3 key from database', async () => {
      const proxyUrl = 'http://localhost:3010/f/abc123';
      const expectedKey = 'ppp/491067/image.jpg';

      vi.spyOn(FileModel, 'getFileById').mockResolvedValue({ url: expectedKey } as any);

      const result = await fileService.getKeyFromFullUrl(proxyUrl);

      expect(FileModel.getFileById).toHaveBeenCalledWith(mockDb, 'abc123');
      expect(result).toBe(expectedKey);
    });

    it('should return null when file is not found in database', async () => {
      const proxyUrl = 'http://localhost:3010/f/nonexistent';

      vi.spyOn(FileModel, 'getFileById').mockResolvedValue(undefined);

      const result = await fileService.getKeyFromFullUrl(proxyUrl);

      expect(FileModel.getFileById).toHaveBeenCalledWith(mockDb, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should handle URL with different domain', async () => {
      const proxyUrl = 'https://example.com/f/file456';
      const expectedKey = 'uploads/file.png';

      vi.spyOn(FileModel, 'getFileById').mockResolvedValue({ url: expectedKey } as any);

      const result = await fileService.getKeyFromFullUrl(proxyUrl);

      expect(FileModel.getFileById).toHaveBeenCalledWith(mockDb, 'file456');
      expect(result).toBe(expectedKey);
    });

    it('should extract key from legacy S3 URL (non /f/ path)', async () => {
      const s3Url = 'https://example.com/path/to/file.jpg';

      const result = await fileService.getKeyFromFullUrl(s3Url);

      // Legacy S3 URL: extract key from pathname
      expect(result).toBe('path/to/file.jpg');
    });

    it('should extract key with path-style S3 URL', async () => {
      config.S3_ENABLE_PATH_STYLE = true;
      const s3Url = 'https://example.com/my-bucket/path/to/file.jpg';

      const result = await fileService.getKeyFromFullUrl(s3Url);

      expect(result).toBe('path/to/file.jpg');
      config.S3_ENABLE_PATH_STYLE = false;
    });

    it('should return null for invalid URL', async () => {
      const invalidUrl = 'not-a-valid-url';

      const result = await fileService.getKeyFromFullUrl(invalidUrl);

      expect(result).toBeNull();
    });
  });

  describe('uploadMedia', () => {
    beforeEach(() => {
      // 重置 S3 mock
      vi.clearAllMocks();
    });

    it('应该调用S3的uploadMedia方法并返回key', async () => {
      // 准备
      const testKey = 'images/test.jpg';
      const testBuffer = Buffer.from('fake image data');

      fileService['s3'].uploadMedia = vi.fn().mockResolvedValue(undefined);

      // 执行
      const result = await fileService.uploadMedia(testKey, testBuffer);

      // 验证
      expect(fileService['s3'].uploadMedia).toHaveBeenCalledWith(testKey, testBuffer);
      expect(result).toEqual({ key: testKey });
    });

    it('应该正确处理不同类型的媒体文件', async () => {
      // 准备
      const testKey = 'videos/test.mp4';
      const testBuffer = Buffer.from('fake video data');

      fileService['s3'].uploadMedia = vi.fn().mockResolvedValue(undefined);

      // 执行
      const result = await fileService.uploadMedia(testKey, testBuffer);

      // 验证
      expect(fileService['s3'].uploadMedia).toHaveBeenCalledWith(testKey, testBuffer);
      expect(result).toEqual({ key: testKey });
    });

    it('当S3上传失败时应该抛出错误', async () => {
      // 准备
      const testKey = 'images/test.jpg';
      const testBuffer = Buffer.from('fake image data');
      const uploadError = new Error('S3 upload failed');

      fileService['s3'].uploadMedia = vi.fn().mockRejectedValue(uploadError);

      // 执行和验证
      await expect(fileService.uploadMedia(testKey, testBuffer)).rejects.toThrow(
        'S3 upload failed',
      );
      expect(fileService['s3'].uploadMedia).toHaveBeenCalledWith(testKey, testBuffer);
    });
  });
});
