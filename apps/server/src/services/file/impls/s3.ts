import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';
import urlJoin from 'url-join';

import { FileModel } from '@/database/models/file';
import { fileEnv } from '@/envs/file';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { FileS3, type PreSignedUploadOptions } from '@/server/modules/S3';

import type { BrowserFileAccessOptions, FileServiceImpl, PreSignedUpload } from './type';

const log = debug('lobe-file:s3');

const PRESIGNED_PREVIEW_CACHE_SAFETY_SECONDS = 60;
const PRESIGNED_PREVIEW_CACHE_MAX_SECONDS = 3600;
const PRESIGNED_PREVIEW_CACHE_KEY_PREFIX = 'file:presigned-preview:';
const BROWSER_PRESIGNED_PREVIEW_CACHE_KEY_PREFIX = 'file:browser-presigned-preview:v1:';

interface PresignedPreviewCacheEntry {
  expiresAt: number;
  url: string;
}

interface PresignedPreviewCacheOptions {
  cache: Map<string, PresignedPreviewCacheEntry>;
  cacheKey: string;
  createUrl: () => Promise<string>;
  expiresInSeconds: number;
  label: string;
  validateUrl?: (url: string) => void;
}

const presignedPreviewUrlCache = new Map<string, PresignedPreviewCacheEntry>();
const browserPresignedPreviewUrlCache = new Map<string, PresignedPreviewCacheEntry>();

const createPresignedPreviewCacheKey = (key: string, expiresIn: number) =>
  `${PRESIGNED_PREVIEW_CACHE_KEY_PREFIX}${expiresIn}:${key}`;

const createBrowserPresignedPreviewCacheKey = (key: string, expiresIn: number) => {
  const publicUrlBase =
    fileEnv.S3_PUBLIC_DOMAIN || fileEnv.S3_PUBLIC_READ_ENDPOINT || fileEnv.S3_ENDPOINT;
  if (!publicUrlBase) throw new Error('No S3 endpoint is configured for browser file access');

  return `${BROWSER_PRESIGNED_PREVIEW_CACHE_KEY_PREFIX}${new URL(publicUrlBase).host}:${expiresIn}:${key}`;
};

const getPresignedPreviewCacheTtlSeconds = (expiresInSeconds: number) =>
  Math.min(
    Math.max(expiresInSeconds - PRESIGNED_PREVIEW_CACHE_SAFETY_SECONDS, 0),
    PRESIGNED_PREVIEW_CACHE_MAX_SECONDS,
  );

/**
 * S3-based file service implementation
 */
export class S3StaticFileImpl implements FileServiceImpl {
  private readonly s3: FileS3;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
    this.s3 = new FileS3();
  }

  async deleteFile(key: string) {
    return this.s3.deleteFile(key);
  }

  async deleteFiles(keys: string[]) {
    return this.s3.deleteFiles(keys);
  }

  async getFileContent(key: string): Promise<string> {
    return this.s3.getFileContent(key);
  }

  async getFileByteArray(key: string): Promise<Uint8Array> {
    return this.s3.getFileByteArray(key);
  }

  async createPreSignedUrl(key: string): Promise<string> {
    return this.s3.createPreSignedUrl(key);
  }

  async createPreSignedUpload(
    key: string,
    options?: PreSignedUploadOptions,
  ): Promise<PreSignedUpload> {
    return options
      ? this.s3.createPreSignedUpload(key, options)
      : this.s3.createPreSignedUpload(key);
  }

  async getFileMetadata(key: string): Promise<{ contentLength: number; contentType?: string }> {
    return this.s3.getFileMetadata(key);
  }

  async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return this.s3.createPreSignedUrlForPreview(key, expiresIn);
  }

  async createPreSignedUrlForDownload(
    url: string,
    contentDisposition: string,
    expiresIn?: number,
  ): Promise<string> {
    const key = await this.getStorageKeyFromUrl(url);
    return this.s3.createPreSignedUrlForDownload(key, contentDisposition, expiresIn);
  }

  async createBrowserFileAccessUrl(
    url: string,
    options?: BrowserFileAccessOptions,
  ): Promise<string> {
    const key = await this.getStorageKeyFromUrl(url);

    if (options?.contentDisposition) {
      return this.s3.createBrowserPreSignedUrlForDownload(
        key,
        options.contentDisposition,
        options.expiresIn,
      );
    }

    return this.getCachedBrowserPreSignedUrlForPreview(key, options?.expiresIn);
  }

  private async getStorageKeyFromUrl(url: string): Promise<string> {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return url;

    const extractedKey = await this.getKeyFromFullUrl(url);
    if (!extractedKey) {
      throw new Error('Key not found from url: ' + url);
    }

    return extractedKey;
  }

  private async getCachedPreSignedUrl({
    cache,
    cacheKey,
    createUrl,
    expiresInSeconds,
    label,
    validateUrl,
  }: PresignedPreviewCacheOptions): Promise<string> {
    const ttlSeconds = getPresignedPreviewCacheTtlSeconds(expiresInSeconds);
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      try {
        validateUrl?.(cached.url);
        return cached.url;
      } catch (error) {
        cache.delete(cacheKey);
        log('Discarded invalid %s from memory cache: %O', label, error);
      }
    }

    try {
      const redisConfig = getRedisConfig();
      const redis = isRedisEnabled(redisConfig) ? await initializeRedis(redisConfig) : null;
      const cachedUrl = await redis?.get(cacheKey);

      if (cachedUrl) {
        validateUrl?.(cachedUrl);
        if (ttlSeconds > 0) {
          cache.set(cacheKey, {
            expiresAt: now + ttlSeconds * 1000,
            url: cachedUrl,
          });
        }

        return cachedUrl;
      }
    } catch (error) {
      log('Failed to read valid %s from Redis cache: %O', label, error);
    }

    const url = await createUrl();
    validateUrl?.(url);

    if (ttlSeconds > 0) {
      cache.set(cacheKey, {
        expiresAt: now + ttlSeconds * 1000,
        url,
      });

      try {
        const redisConfig = getRedisConfig();
        const redis = isRedisEnabled(redisConfig) ? await initializeRedis(redisConfig) : null;
        await redis?.set(cacheKey, url, { ex: ttlSeconds });
      } catch (error) {
        log('Failed to write %s to Redis cache: %O', label, error);
      }
    }

    return url;
  }

  private async getCachedPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    const expiresInSeconds = expiresIn ?? fileEnv.S3_PREVIEW_URL_EXPIRE_IN;

    return this.getCachedPreSignedUrl({
      cache: presignedPreviewUrlCache,
      cacheKey: createPresignedPreviewCacheKey(key, expiresInSeconds),
      createUrl: () => this.createPreSignedUrlForPreview(key, expiresIn),
      expiresInSeconds,
      label: 'presigned preview URL',
    });
  }

  private async getCachedBrowserPreSignedUrlForPreview(
    key: string,
    expiresIn?: number,
  ): Promise<string> {
    const expiresInSeconds = expiresIn ?? fileEnv.S3_PREVIEW_URL_EXPIRE_IN;

    return this.getCachedPreSignedUrl({
      cache: browserPresignedPreviewUrlCache,
      cacheKey: createBrowserPresignedPreviewCacheKey(key, expiresInSeconds),
      createUrl: () => this.s3.createBrowserPreSignedUrlForPreview(key, expiresIn),
      expiresInSeconds,
      label: 'browser presigned preview URL',
      validateUrl: (url) => this.s3.assertBrowserFileUrl(url),
    });
  }

  async createCachedPreSignedUrlForPreview(
    url?: string | null,
    expiresIn?: number,
  ): Promise<string> {
    if (!url) return '';

    const key = await this.getStorageKeyFromUrl(url);

    return await this.getCachedPreSignedUrlForPreview(key, expiresIn);
  }

  async uploadContent(path: string, content: string) {
    return this.s3.uploadContent(path, content);
  }

  async getFullFileUrl(url?: string | null, expiresIn?: number): Promise<string> {
    if (!url) return '';

    const key = await this.getStorageKeyFromUrl(url);

    // If bucket is not set public read, or S3_PUBLIC_DOMAIN is not configured,
    // reuse the same presigned preview URL briefly so repeated chat turns keep
    // stable media URLs and can reuse provider-side prefix caches.
    const publicUrlBase = fileEnv.S3_SET_ACL ? fileEnv.S3_PUBLIC_DOMAIN : undefined;
    if (!publicUrlBase) {
      return await this.getCachedPreSignedUrlForPreview(key, expiresIn);
    }

    if (fileEnv.S3_ENABLE_PATH_STYLE) {
      return urlJoin(publicUrlBase, fileEnv.S3_BUCKET!, key);
    }

    return urlJoin(publicUrlBase, key);
  }

  async getKeyFromFullUrl(url: string): Promise<string | null> {
    try {
      const urlObject = new URL(url);
      const { pathname } = urlObject;

      // Case 1: File proxy URL pattern /f/{fileId} - query database for S3 key
      if (pathname.startsWith('/f/')) {
        const fileId = pathname.slice(3); // Remove '/f/' prefix
        const file = await FileModel.getFileById(this.db, fileId);
        return file?.url ?? null;
      }

      // Case 2: Legacy S3 URL - extract key from pathname
      if (fileEnv.S3_ENABLE_PATH_STYLE) {
        if (!fileEnv.S3_BUCKET) {
          return pathname.startsWith('/') ? pathname.slice(1) : pathname;
        }
        const bucketPrefix = `/${fileEnv.S3_BUCKET}/`;
        if (pathname.startsWith(bucketPrefix)) {
          return pathname.slice(bucketPrefix.length);
        }
        return pathname.startsWith('/') ? pathname.slice(1) : pathname;
      }

      // Virtual-hosted-style: path is /<key>
      return pathname.slice(1);
    } catch {
      // If url is not a valid URL, return null
      return null;
    }
  }

  async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    await this.s3.uploadMedia(key, buffer);
    return { key };
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<{ key: string }> {
    await this.s3.uploadBuffer(key, buffer, contentType);
    return { key };
  }
}
