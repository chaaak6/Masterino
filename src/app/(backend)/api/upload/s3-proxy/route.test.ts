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
    expect(response.headers.get('access-control-allow-methods')).toContain('PUT');
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
    expect(mocks.verifyS3UploadProxySignature).toHaveBeenCalledWith('files/a.txt', 3600, 'good');
    expect(mocks.uploadBuffer).toHaveBeenCalledWith(
      'files/a.txt',
      expect.any(Buffer),
      'text/plain',
    );
    expect(mocks.uploadBuffer.mock.calls[0][1].toString()).toBe('hello');
  });
});
