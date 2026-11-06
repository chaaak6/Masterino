import { type ChatContextContent } from '@lobechat/types';

import { type UploadFileItem } from '@/types/files/upload';
import { type ChatAttachmentIssue } from '@/utils/chatAttachments';

import { type ChatAttachmentDraft } from './drafts';

export interface ImageFileState {
  chatAttachmentDrafts: Record<string, ChatAttachmentDraft>;
  chatAttachmentIssues: ChatAttachmentIssue[];
  chatAttachmentNoticeShown: boolean;
  chatAttachmentScope?: string;
  chatContextSelections: ChatContextContent[];
  chatUploadFileList: UploadFileItem[];
  uploadingIds: string[];
}

export const initialImageFileState: ImageFileState = {
  chatAttachmentDrafts: {},
  chatAttachmentIssues: [],
  chatAttachmentNoticeShown: false,
  chatContextSelections: [],
  chatUploadFileList: [],
  uploadingIds: [],
};
