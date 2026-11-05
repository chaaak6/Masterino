import { type UploadFileItem } from '@/types/files/upload';
import { type ChatAttachmentIssue } from '@/utils/chatAttachments';

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
interface DraftState extends ChatAttachmentDraft {
  chatAttachmentDrafts?: Record<string, ChatAttachmentDraft>;
  chatAttachmentScope?: string;
}
export const getChatAttachmentDraft = (state: DraftState, scope?: string): ChatAttachmentDraft =>
  !scope || scope === state.chatAttachmentScope
    ? state
    : state.chatAttachmentDrafts?.[scope] || emptyChatAttachmentDraft;

// Recheck after asynchronous workspace/device confirmation before consuming a draft.
export const sameChatAttachmentDraft = (before: DraftState, after: DraftState, scope: string) => {
  const previous = getChatAttachmentDraft(before, scope);
  const current = getChatAttachmentDraft(after, scope);
  return (
    previous.chatUploadFileList === current.chatUploadFileList &&
    previous.chatAttachmentIssues === current.chatAttachmentIssues
  );
};
