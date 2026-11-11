import { normalizeMessageAttachments } from '@lobechat/types';
import { t } from 'i18next';

import { message } from '@/components/AntdStaticMethods';
import { type UIChatMessage } from '@/types/index';
import {
  CHAT_IMAGE_LIMIT,
  isChatAttachmentImage,
  logChatAttachment,
} from '@/utils/chatAttachments';

// Apply the same policy before editing or branching historical user messages.
export const validateMessageImages = (item: Parameters<typeof normalizeMessageAttachments>[0]) => {
  const count = normalizeMessageAttachments(item).filter(isChatAttachmentImage).length;
  if (count <= CHAT_IMAGE_LIMIT) return true;
  message.warning(t('attachments.historyLimit', { ns: 'chat', limit: CHAT_IMAGE_LIMIT }));
  logChatAttachment('blocked-history', { count, reason: 'image-count' });
  return false;
};

// Retry buttons sometimes clean up an error row immediately after dispatching regeneration.
// Validate their source user message synchronously before either side effect can run.
export const validateRegenerationImages = (messages: UIChatMessage[], messageId: string) => {
  const current = messages.find((item) => item.id === messageId);
  if (!current) return false;
  const source =
    current.role === 'user' ? current : messages.find((item) => item.id === current.parentId);
  return !!source && validateMessageImages(source);
};
