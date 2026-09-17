// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = process.cwd();
const internalOssEndpoint = 'https://oss-cn-shenzhen-internal.aliyuncs.com';
const internalS3CompatibleEndpoint = 'https://s3.oss-cn-shenzhen-internal.aliyuncs.com';
const publicOssEndpoint = 'https://oss-cn-shenzhen.aliyuncs.com';
const ossInternalCidrs = [
  '100.118.78.0/24',
  '100.118.203.0/24',
  '100.118.204.0/24',
  '100.118.217.0/24',
];

const read = (relativePath: string) => readFile(path.join(root, relativePath), 'utf8');

describe('ACK internal service endpoints', () => {
  it('configures the test app with separate internal and browser-read OSS endpoints', async () => {
    const config = parse(await read('k8s/overlays/test/configmap.yaml'));

    expect(config.data.S3_ENDPOINT).toBe(internalOssEndpoint);
    expect(config.data.S3_PUBLIC_READ_ENDPOINT).toBe(publicOssEndpoint);
    expect(config.data.S3_PUBLIC_DOMAIN).not.toContain('-internal');
  });

  it.each([
    'k8s/overlays/test/configmap.yaml',
    'k8s/overlays/production/configmap.yaml',
    'k8s/overlays/production-bluegreen/configmap.yaml',
  ])(
    'keeps server-side OSS traffic internal while the configured browser domain stays public in %s',
    async (file) => {
      const config = parse(await read(file));

      expect(config.data.S3_ENDPOINT).toBe(internalOssEndpoint);
      expect(config.data.S3_PUBLIC_READ_ENDPOINT).toBe(publicOssEndpoint);
      expect(config.data.S3_PUBLIC_DOMAIN).not.toContain('-internal');
    },
  );

  it.each([
    'k8s/overlays/test-market/kustomization.yaml',
    'k8s/overlays/production-market/kustomization.yaml',
  ])(
    'uses the internal S3-compatible endpoint and explicitly allows OSS VIPs in %s',
    async (file) => {
      const source = await read(file);

      expect(source).toContain(`MARKET_OBJECT_STORAGE_ENDPOINT: ${internalS3CompatibleEndpoint}`);
      for (const cidr of ossInternalCidrs) expect(source).toContain(`cidr: ${cidr}`);
    },
  );

  it('keeps all Langfuse blob-storage endpoints internal', async () => {
    const patch = parse(await read('k8s/observability/langfuse-oss-internal-config-patch.yaml'));

    expect(patch.data.LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT).toBe(internalOssEndpoint);
    expect(patch.data.LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT).toBe(internalOssEndpoint);
    expect(patch.data.LANGFUSE_S3_BATCH_EXPORT_ENDPOINT).toBe(internalOssEndpoint);
  });

  it('guards and replaces the ClickHouse backup endpoint at the verified pod-template path', async () => {
    const patch = JSON.parse(
      await read('k8s/observability/clickhouse-backup-oss-internal-patch.json'),
    );

    expect(patch).toEqual([
      expect.objectContaining({ op: 'test', value: 'clickhouse-backup' }),
      expect.objectContaining({ op: 'test', value: 'S3_ENDPOINT' }),
      expect.objectContaining({ op: 'replace', value: internalOssEndpoint }),
    ]);
  });
});
