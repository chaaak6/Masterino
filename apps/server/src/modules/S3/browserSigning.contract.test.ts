// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { S3 } from './index';

describe('Alibaba OSS browser signing contract', () => {
  it('combines the public regional endpoint and bucket into the public bucket host', async () => {
    const signer = new S3(
      'test-access-key',
      'test-secret-key',
      'https://oss-cn-shenzhen.aliyuncs.com',
      {
        bucket: 'masterlion-test',
        forcePathStyle: false,
        region: 'cn-shenzhen',
      },
    );

    const signedUrl = await signer.createPreSignedUrlForPreview(
      'code-interpreter-exports/test/report.html',
      300,
    );
    const url = new URL(signedUrl);

    expect(url.hostname).toBe('masterlion-test.oss-cn-shenzhen.aliyuncs.com');
    expect(url.pathname).toBe('/code-interpreter-exports/test/report.html');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('signs the attachment content disposition into public download URLs', async () => {
    const signer = new S3(
      'test-access-key',
      'test-secret-key',
      'https://oss-cn-shenzhen.aliyuncs.com',
      {
        bucket: 'masterlion-test',
        forcePathStyle: false,
        region: 'cn-shenzhen',
      },
    );

    const signedUrl = await signer.createPreSignedUrlForDownload(
      'files/report.html',
      'attachment; filename="report.html"',
      300,
    );
    const url = new URL(signedUrl);

    expect(url.hostname).toBe('masterlion-test.oss-cn-shenzhen.aliyuncs.com');
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="report.html"',
    );
  });

  it('keeps the public regional host when path-style addressing is enabled', async () => {
    const signer = new S3(
      'test-access-key',
      'test-secret-key',
      'https://oss-cn-shenzhen.aliyuncs.com',
      {
        bucket: 'masterlion-test',
        forcePathStyle: true,
        region: 'cn-shenzhen',
      },
    );

    const signedUrl = await signer.createPreSignedUrlForPreview('files/report.html', 300);
    const url = new URL(signedUrl);

    expect(url.hostname).toBe('oss-cn-shenzhen.aliyuncs.com');
    expect(url.pathname).toBe('/masterlion-test/files/report.html');
  });
});
