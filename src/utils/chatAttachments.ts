import { inferImageMimeTypeFromBytes } from '@lobechat/utils';

import { type UploadFileItem } from '@/types/files/upload';

// This is the ordinary raw-file PUT profile, not a global storage/model limit.
// Keep in sync with the deployed Next Proxy profile when changing upload capacity.
export const WEB_CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_LIMIT = 10;
export const LOCAL_CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type AttachmentIssueReason =
  | 'image-count'
  | 'web-size'
  | 'unsupported-format'
  | 'incomplete-upload'
  | 'upload-failed'
  | 'parse-failed'
  | 'local-failed'
  | 'permission-denied'
  | 'unauthorized';

export interface ChatAttachmentIssue {
  id: string;
  name: string;
  reason: AttachmentIssueReason;
  size: number;
  web: boolean;
}

export const isChatImage = (file: { name: string; type: string }) => {
  const type = file?.type?.toLowerCase();
  return (
    !!type?.startsWith('image/') ||
    ((!type || type === 'application/octet-stream') &&
      /\.(?:png|jpe?g|webp|gif)$/i.test(file?.name || ''))
  );
};

export const isLocalChatAttachmentImage = ({
  mime,
  name,
  size,
}: {
  mime: string;
  name: string;
  size: number;
}) =>
  mime.startsWith('image/') ||
  (size <= LOCAL_CHAT_IMAGE_MAX_BYTES && isChatImage({ name, type: mime }));

export const normalizeChatImageFile = async (file: File) => {
  if (file.type.startsWith('image/') || !isChatImage(file)) return file;

  const mime = await inferImageMimeTypeFromBytes(await file.slice(0, 4100).arrayBuffer()).catch(
    () => undefined,
  );
  if (!mime || !/^image\/(?:gif|jpeg|png|webp)$/.test(mime)) return file;
  return new File([file], file.name, { lastModified: file.lastModified, type: mime });
};

export const isChatUploadItemImage = (item: UploadFileItem) =>
  item.attachment?.source === 'local' || item.processStage === 'ready_for_chat'
    ? item.file.type.startsWith('image/')
    : isChatImage(item.file);

export const chatImageCount = (files: UploadFileItem[]) =>
  files.filter(isChatUploadItemImage).length;

export function classifyChatAttachmentError(
  error: unknown,
  { size, web, parsing = false }: { parsing?: boolean; size: number; web: boolean },
): Exclude<AttachmentIssueReason, 'image-count'> {
  const value = error as {
    details?: unknown;
    message?: unknown;
    status?: unknown;
    data?: { code?: string };
  } | null;
  const message = `${value?.details ?? ''} ${value?.message ?? (typeof error === 'string' ? error : '')}`;
  if (value?.status === 403 || value?.data?.code === 'FORBIDDEN') return 'permission-denied';
  if (value?.status === 401 || value?.data?.code === 'UNAUTHORIZED') return 'unauthorized';
  if (web && !parsing && value?.status === 413) return 'web-size';
  if (!parsing && value?.status === 400 && /Upload is incomplete or its checksum/i.test(message))
    return web && size > WEB_CHAT_FILE_MAX_BYTES ? 'web-size' : 'incomplete-upload';
  if (web && /Unsupported file type|UNSUPPORTED_FILE_TYPE/i.test(message))
    return 'unsupported-format';
  return parsing ? 'parse-failed' : 'upload-failed';
}

export const getChatAttachmentBlock = (
  files: UploadFileItem[],
  issues: ChatAttachmentIssue[] = [],
) => {
  if (issues.length || files.some((item) => item.status === 'error')) return 'failed';
  if (chatImageCount(files) > CHAT_IMAGE_LIMIT) return 'image-count';
  if (
    files.some(
      (item) =>
        ['pending', 'processing', 'uploading'].includes(item.status) ||
        (item.tasks && !item.tasks.finishEmbedding),
    )
  )
    return 'pending';
};

// Never log filenames, paths, payloads, signed URLs or raw error envelopes.
export const logChatAttachment = (
  event: string,
  fields: {
    count?: number;
    id?: string;
    reason?: string;
    size?: number;
    stage?: string;
    status?: number;
    target?: string;
  },
) => console.info('[chat-attachment]', JSON.stringify({ event, ...fields }));
