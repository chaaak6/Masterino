import { createHash } from 'node:crypto';

import { readBoundedSkillBody, SKILL_SOURCE_MAX_BYTES } from '@lobechat/skill-package';

import { UPLOAD_CONFIRMATION_HEADER, UPLOAD_CONFIRMATION_VALUE } from '@/const/fileUpload';
import { FileS3 } from '@/server/modules/S3';
import { verifyS3UploadProxySignature } from '@/server/services/file/uploadProxyToken';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'content-type,x-amz-*',
  'Access-Control-Allow-Methods': 'PUT,OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': UPLOAD_CONFIRMATION_HEADER,
};

export const OPTIONS = async () =>
  new Response('', {
    headers: corsHeaders,
    status: 200,
  });

export const PUT = async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature') || '';

  const source = url.searchParams.get('source');
  const size = Number(url.searchParams.get('size'));
  const hash = url.searchParams.get('hash') || '';
  const claim = source === 'skill' ? { source: 'skill' as const, size, hash } : undefined;
  if (
    source &&
    (!claim ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > SKILL_SOURCE_MAX_BYTES ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      !key.startsWith('skills/'))
  )
    return new Response('Invalid skill upload claim', { status: 403, headers: corsHeaders });
  const valid = claim
    ? verifyS3UploadProxySignature(key, expires, signature, Date.now(), claim)
    : verifyS3UploadProxySignature(key, expires, signature);
  if (!valid) {
    return new Response('Invalid or expired upload URL', {
      headers: corsHeaders,
      status: 403,
    });
  }

  let body: Buffer;
  try {
    body = claim
      ? Buffer.from(await readBoundedSkillBody(req.body, claim.size))
      : Buffer.from(await req.arrayBuffer());
  } catch {
    return new Response('Skill upload exceeds the signed size limit', {
      status: 413,
      headers: corsHeaders,
    });
  }
  const contentLength = req.headers.get('content-length');
  if (
    (contentLength && Number(contentLength) !== body.length) ||
    (claim &&
      (body.length !== claim.size ||
        createHash('sha256').update(body).digest('hex') !== claim.hash))
  ) {
    return new Response('Upload is incomplete or its checksum does not match. Please retry.', {
      status: 400,
      headers: corsHeaders,
    });
  }
  const contentType = req.headers.get('content-type') || undefined;
  const s3 = new FileS3();

  await s3.uploadBuffer(key, body, contentType);

  return new Response('', {
    headers: {
      ...corsHeaders,
      [UPLOAD_CONFIRMATION_HEADER]: UPLOAD_CONFIRMATION_VALUE,
    },
    status: 200,
  });
};
