import { createHmac, timingSafeEqual } from 'node:crypto';

import { fileEnv } from '@/envs/file';

const UPLOAD_PROXY_PATH = '/api/upload/s3-proxy';
const UPLOAD_PROXY_TTL_SECONDS = 60 * 60;

const getUploadProxySecret = () => {
  const secret = fileEnv.S3_SECRET_ACCESS_KEY || fileEnv.S3_ACCESS_KEY_ID;
  if (!secret) throw new Error('S3 credentials are required for upload proxy signing');

  return secret;
};

const signPayload = (key: string, expires: number) =>
  createHmac('sha256', getUploadProxySecret()).update(`${key}.${expires}`).digest('hex');

export const createS3UploadProxyUrl = (key: string, now = Date.now()) => {
  const expires = Math.floor(now / 1000) + UPLOAD_PROXY_TTL_SECONDS;
  const signature = signPayload(key, expires);
  const params = new URLSearchParams({
    expires: String(expires),
    key,
    signature,
  });

  return `${UPLOAD_PROXY_PATH}?${params.toString()}`;
};

export const verifyS3UploadProxySignature = (
  key: string,
  expires: number,
  signature: string,
  now = Date.now(),
) => {
  if (!key || !signature || !Number.isFinite(expires)) return false;
  if (expires < Math.floor(now / 1000)) return false;

  const expected = signPayload(key, expires);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
};

