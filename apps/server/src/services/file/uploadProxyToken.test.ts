// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/file', () => ({
  fileEnv: {
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
  },
}));

import { createS3UploadProxyUrl, verifyS3UploadProxySignature } from './uploadProxyToken';

describe('S3 upload proxy token', () => {
  it('creates a same-origin upload proxy URL signed for one hour', () => {
    const url = createS3UploadProxyUrl('files/2026/06/example.txt', 1_800_000);
    const parsed = new URL(url, 'http://localhost:3220');

    expect(parsed.pathname).toBe('/api/upload/s3-proxy');
    expect(parsed.searchParams.get('key')).toBe('files/2026/06/example.txt');
    expect(parsed.searchParams.get('expires')).toBe(String(1800 + 3600));
    expect(parsed.searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies matching signatures and rejects tampered or expired URLs', () => {
    const url = createS3UploadProxyUrl('files/2026/06/example.txt', 1_800_000);
    const parsed = new URL(url, 'http://localhost:3220');
    const expires = Number(parsed.searchParams.get('expires'));
    const signature = parsed.searchParams.get('signature')!;

    expect(
      verifyS3UploadProxySignature('files/2026/06/example.txt', expires, signature, 1_800_000),
    ).toBe(true);
    expect(
      verifyS3UploadProxySignature('files/2026/06/other.txt', expires, signature, 1_800_000),
    ).toBe(false);
    expect(
      verifyS3UploadProxySignature('files/2026/06/example.txt', expires, signature, 6_000_000),
    ).toBe(false);
  });
});

