import { FileS3 } from '@/server/modules/S3';
import { verifyS3UploadProxySignature } from '@/server/services/file/uploadProxyToken';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'content-type,x-amz-*',
  'Access-Control-Allow-Methods': 'PUT,OPTIONS',
  'Access-Control-Allow-Origin': '*',
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

  if (!verifyS3UploadProxySignature(key, expires, signature)) {
    return new Response('Invalid or expired upload URL', {
      headers: corsHeaders,
      status: 403,
    });
  }

  const body = Buffer.from(await req.arrayBuffer());
  const contentType = req.headers.get('content-type') || undefined;
  const s3 = new FileS3();

  await s3.uploadBuffer(key, body, contentType);

  return new Response('', {
    headers: corsHeaders,
    status: 200,
  });
};
