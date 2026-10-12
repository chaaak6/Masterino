import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { MarketConfig } from './config.js';

export class MarketObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: MarketConfig) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.MARKET_OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: config.MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
      endpoint: config.MARKET_OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: config.MARKET_OBJECT_STORAGE_FORCE_PATH_STYLE === '1',
      region: config.MARKET_OBJECT_STORAGE_REGION,
    });
  }

  async ping() {
    await this.client.send(
      new ListObjectsV2Command({ Bucket: this.config.MARKET_OBJECT_STORAGE_BUCKET, MaxKeys: 1 }),
    );
  }

  async put(key: string, body: Buffer, sha256: string) {
    await this.client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.config.MARKET_OBJECT_STORAGE_BUCKET,
        ContentType: 'application/zip',
        Key: key,
        Metadata: { sha256 },
      }),
    );
  }

  async signedDownloadUrl(key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.MARKET_OBJECT_STORAGE_BUCKET, Key: key }),
      { expiresIn: 300 },
    );
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.MARKET_OBJECT_STORAGE_BUCKET, Key: key }));
  }
}
