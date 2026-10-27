import { createHash } from 'node:crypto';

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OPTIONS, PUT } from './route';

const mocks = vi.hoisted(() => ({
  uploadBuffer: vi.fn(),
  verifyS3UploadProxySignature: vi.fn(),
}));

vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(() => ({ uploadBuffer: mocks.uploadBuffer })),
}));

vi.mock('@/server/services/file/uploadProxyToken', () => ({
  verifyS3UploadProxySignature: mocks.verifyS3UploadProxySignature,
}));

describe('S3 upload proxy route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles preflight requests for browser upload fallback', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(response.headers.get('access-control-allow-headers')).toContain('content-type');
    expect(response.headers.get('access-control-expose-headers')).toContain(
      'X-Masterino-Upload-Confirmed',
    );
  });

  it('rejects invalid upload signatures', async () => {
    mocks.verifyS3UploadProxySignature.mockReturnValue(false);

    const response = await PUT(
      new Request('http://localhost/api/upload/s3-proxy?key=files/a.txt&expires=1&signature=bad', {
        body: 'hello',
        method: 'PUT',
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.uploadBuffer).not.toHaveBeenCalled();
  });

  it('uploads the request body to S3 when the signature is valid', async () => {
    mocks.verifyS3UploadProxySignature.mockReturnValue(true);

    const response = await PUT(
      new Request(
        'http://localhost/api/upload/s3-proxy?key=files/a.txt&expires=3600&signature=good',
        {
          body: 'hello',
          headers: { 'content-type': 'text/plain' },
          method: 'PUT',
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-masterino-upload-confirmed')).toBe('1');
    expect(response.headers.get('access-control-expose-headers')).toContain(
      'X-Masterino-Upload-Confirmed',
    );
    expect(mocks.verifyS3UploadProxySignature).toHaveBeenCalledWith('files/a.txt', 3600, 'good');
    expect(mocks.uploadBuffer).toHaveBeenCalledWith(
      'files/a.txt',
      expect.any(Buffer),
      'text/plain',
    );
    expect(mocks.uploadBuffer.mock.calls[0][1].toString()).toBe('hello');
  });
  it('rejects truncated skill bytes before storing or confirming them', async () => {
    mocks.verifyS3UploadProxySignature.mockReturnValue(true);
    const hash = createHash('sha256').update('complete body').digest('hex');
    const response = await PUT(
      new Request(
        `http://localhost/api/upload/s3-proxy?key=skills/a.zip&expires=3600&signature=good&source=skill&size=13&hash=${hash}`,
        { method: 'PUT', body: 'short' },
      ),
    );
    expect(response.status).toBe(400);
    expect(mocks.uploadBuffer).not.toHaveBeenCalled();
    expect(response.headers.has('x-masterino-upload-confirmed')).toBe(false);
  });
  it('distinguishes an unreadable body from an oversized skill upload', async () => {
    mocks.verifyS3UploadProxySignature.mockReturnValue(true);
    const hash = createHash('sha256').update('a').digest('hex');
    const url = `http://localhost/api/upload/s3-proxy?key=skills/a.zip&expires=3600&signature=good&source=skill&size=1&hash=${hash}`;
    const unreadable = new Request(url, { method: 'PUT' });
    expect((await PUT(unreadable)).status).toBe(400);
    const oversized = new Request(url, { method: 'PUT', body: 'ab' });
    expect((await PUT(oversized)).status).toBe(413);
    expect(mocks.uploadBuffer).not.toHaveBeenCalled();
  });
  it.each(['source=', 'source=&source=skill'])(
    'rejects an empty source claim even with a legacy signature: %s',
    async (query) => {
      mocks.verifyS3UploadProxySignature.mockReturnValue(true);
      const response = await PUT(
        new Request(
          `http://localhost/api/upload/s3-proxy?key=files/a.txt&expires=3600&signature=good&${query}`,
          { method: 'PUT', body: 'hello' },
        ),
      );
      expect(response.status).toBe(403);
      expect(mocks.verifyS3UploadProxySignature).not.toHaveBeenCalled();
      expect(mocks.uploadBuffer).not.toHaveBeenCalled();
    },
  );
});
