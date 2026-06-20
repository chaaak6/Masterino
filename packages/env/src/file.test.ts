import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = process.env;

const loadFileConfig = async () => {
  vi.resetModules();
  return import('./file');
};

describe('file env', () => {
  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('treats empty public S3 URL env values as unset', async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_S3_DOMAIN: '',
      S3_PUBLIC_DOMAIN: '',
    };
    delete process.env.S3_PUBLIC_ENDPOINT;
    delete process.env.S3_PUBLIC_UPLOAD_ENDPOINT;

    const { getFileConfig } = await loadFileConfig();
    const config = getFileConfig();

    expect(config.NEXT_PUBLIC_S3_DOMAIN).toBeUndefined();
    expect(config.S3_PUBLIC_DOMAIN).toBeUndefined();
    expect(config.S3_PUBLIC_UPLOAD_ENDPOINT).toBeUndefined();
  });
});
