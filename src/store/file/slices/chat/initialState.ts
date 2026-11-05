import { type ChatContextContent } from '@lobechat/types';

import { type UploadFileItem } from '@/types/files/upload';
import { type ChatAttachmentIssue } from '@/utils/chatAttachments';

export interface ImageFileState {
  chatAttachmentIssues: ChatAttachmentIssue[];
  chatAttachmentNoticeShown: boolean;
  chatContextSelections: ChatContextContent[];
  chatUploadFileList: UploadFileItem[];
  uploadingIds: string[];
}

export const initialImageFileState: ImageFileState = {
  chatAttachmentIssues: [],
  chatAttachmentNoticeShown: false,
  chatContextSelections: [],
  chatUploadFileList: [],
  uploadingIds: [],
};
