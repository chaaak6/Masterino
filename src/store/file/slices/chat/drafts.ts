import { type ChatContextContent } from '@lobechat/types';

import { type UploadFileItem } from '@/types/files/upload';
import { type ChatAttachmentIssue } from '@/utils/chatAttachments';

import { type ImageFileState } from './initialState';

export interface ChatAttachmentDraft {
  chatAttachmentIssues: ChatAttachmentIssue[];
  chatAttachmentNoticeShown: boolean;
  chatUploadFileList: UploadFileItem[];
}
export const emptyChatAttachmentDraft: ChatAttachmentDraft = {
  chatAttachmentIssues: [],
  chatAttachmentNoticeShown: false,
  chatUploadFileList: [],
};
type ContextSelectionState = Pick<
  ImageFileState,
  'chatContextSelectionDrafts' | 'chatContextSelections'
>;
const emptyContextSelections: ChatContextContent[] = [];

export const getChatContextSelections = (state: ContextSelectionState, scope?: string) =>
  scope
    ? (state.chatContextSelectionDrafts[scope] ?? emptyContextSelections)
    : state.chatContextSelections;

export const toPageSelections = (selections: ChatContextContent[]) =>
  selections.map(({ content, id, pageId, preview }) => ({
    content: preview || '',
    id,
    pageId: pageId || '',
    xml: content,
  }));

interface DraftState extends ChatAttachmentDraft {
  chatAttachmentDrafts?: Record<string, ChatAttachmentDraft>;
  chatAttachmentScope?: string;
}
export const getChatAttachmentDraft = (state: DraftState, scope?: string): ChatAttachmentDraft =>
  !scope || scope === state.chatAttachmentScope
    ? state
    : state.chatAttachmentDrafts?.[scope] || emptyChatAttachmentDraft;

// Recheck after asynchronous workspace/device confirmation before consuming a draft.
export const sameChatAttachmentDraft = (
  before: DraftState & ContextSelectionState,
  after: DraftState & ContextSelectionState,
  scope: string,
) => {
  const previous = getChatAttachmentDraft(before, scope);
  const current = getChatAttachmentDraft(after, scope);
  return (
    previous.chatUploadFileList === current.chatUploadFileList &&
    previous.chatAttachmentIssues === current.chatAttachmentIssues &&
    getChatContextSelections(before, scope) === getChatContextSelections(after, scope)
  );
};
