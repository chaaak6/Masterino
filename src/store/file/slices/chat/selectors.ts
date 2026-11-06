import { getChatAttachmentBlock } from '@/utils/chatAttachments';

import { type FilesStoreState } from '../../initialState';
import { getChatAttachmentDraft } from './drafts';

const chatUploadFileList = (s: FilesStoreState, scope?: string) =>
  getChatAttachmentDraft(s, scope).chatUploadFileList;
const chatContextSelections = (s: FilesStoreState) => s.chatContextSelections;
const isImageUploading = (s: FilesStoreState) => s.uploadingIds.length > 0;

const chatRawFileList = (s: FilesStoreState, scope?: string) =>
  chatUploadFileList(s, scope).map((item) => item.file);
const chatUploadFileListHasItem = (s: FilesStoreState, scope?: string) => {
  const draft = getChatAttachmentDraft(s, scope);
  return draft.chatUploadFileList.length > 0 || (draft.chatAttachmentIssues?.length ?? 0) > 0;
};
const chatContextSelectionHasItem = (s: FilesStoreState) => s.chatContextSelections.length > 0;

const attachmentBlock = (s: FilesStoreState, scope?: string) => {
  const draft = getChatAttachmentDraft(s, scope);
  return getChatAttachmentBlock(draft.chatUploadFileList, draft.chatAttachmentIssues);
};
const isUploadingFiles = (s: FilesStoreState, scope?: string) => !!attachmentBlock(s, scope);

export const filesSelectors = {
  chatUploadFileList,
  isImageUploading,
};

export const fileChatSelectors = {
  attachmentBlock,
  chatContextSelectionHasItem,
  chatContextSelections,
  chatRawFileList,
  chatUploadFileList,
  chatUploadFileListHasItem,
  isUploadingFiles,
};
