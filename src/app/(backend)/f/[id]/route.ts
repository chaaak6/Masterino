import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { getServerDB } from '@/database/server';
import { FileService } from '@/server/services/file';

const log = debug('lobe-file:proxy');

type Params = Promise<{ id: string }>;

const encodeRFC5987Value = (value: string) =>
  encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (char) => `%${char.codePointAt(0)!.toString(16).toUpperCase()}`,
  );

export const createAttachmentContentDisposition = (filename: string) => {
  const asciiFilename = Array.from(filename, (char) => {
    const codePoint = char.codePointAt(0) || 0;
    return codePoint < 32 || codePoint > 126 || char === '"' || char === '\\' ? '_' : char;
  })
    .join('')
    .slice(0, 160);

  return `attachment; filename="${asciiFilename || 'download'}"; filename*=UTF-8''${encodeRFC5987Value(filename)}`;
};

/**
 * File proxy service
 * GET /f/:id
 *
 * Features:
 * - Query database to get file record (without userId filter for public access)
 * - Generate a temporary S3 presigned preview URL
 * - Return 302 redirect
 */
export const GET = async (req: Request, segmentData: { params: Params }) => {
  try {
    const params = await segmentData.params;
    const { id } = params;

    log('File proxy request: %s', id);

    // Get database connection
    const db = await getServerDB();

    // Query file record without userId filter (public access)
    const file = await FileModel.getFileById(db, id);

    if (!file) {
      log('File not found: %s', id);
      return new Response('File not found', {
        status: 404,
      });
    }

    // Create file service with file owner's userId
    const fileService = new FileService(db, file.userId);

    const download = new URL(req.url).searchParams.get('download') === '1';
    const redirectUrl = download
      ? await fileService.createPreSignedUrlForDownload(
          file.url,
          createAttachmentContentDisposition(file.name),
        )
      : await fileService.createCachedPreSignedUrlForPreview(file.url);
    log('Web S3 presigned URL generated');

    // Return 302 redirect
    return Response.redirect(redirectUrl, 302);
  } catch (error) {
    console.error('File proxy error:', error);
    return new Response('Internal server error', {
      status: 500,
    });
  }
};
