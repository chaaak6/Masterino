import { normalizeMessageAttachments } from '@lobechat/types';

import type { UIChatMessage } from '@/types/index';

// Presentation and resend validation share the same legacy image classification.
export const getMessageAttachmentItems = normalizeMessageAttachments;

function hasRichContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (node.root) return hasRichContent(node.root);
  if (typeof node.text === 'string' && node.text.trim()) return true;
  if (typeof node.type !== 'string') return Object.keys(node).length > 0;
  // Keep decorators, lists, tables and other meaningful non-text nodes visible.
  if (!['root', 'paragraph', 'text', 'linebreak'].includes(node.type)) return true;
  return Array.isArray(node.children) && node.children.some(hasRichContent);
}

export const hasUserMessageBody = (
  message: Partial<
    Pick<UIChatMessage, 'content' | 'editorData' | 'videoList' | 'metadata' | 'extra'>
  >,
) =>
  Boolean(
    message.content?.trim() ||
    message.videoList?.length ||
    message.metadata?.pageSelections?.length ||
    message.extra?.translate ||
    message.extra?.tts ||
    hasRichContent(message.editorData),
  );
