import { getChatAttachmentBlock } from '@/utils/chatAttachments';

import { type FilesStoreState } from '../../initialState';

const chatUploadFileList = (s: FilesStoreState) => s.chatUploadFileList;
const chatContextSelections = (s: FilesStoreState) => s.chatContextSelections;
const isImageUploading = (s: FilesStoreState) => s.uploadingIds.length > 0;

const chatRawFileList = (s: FilesStoreState) => s.chatUploadFileList.map((item) => item.file);
const chatUploadFileListHasItem = (s: FilesStoreState) =>
  s.chatUploadFileList.length > 0 || (s.chatAttachmentIssues?.length ?? 0) > 0;
const chatContextSelectionHasItem = (s: FilesStoreState) => s.chatContextSelections.length > 0;

const attachmentBlock = (s: FilesStoreState) =>
  getChatAttachmentBlock(s.chatUploadFileList, s.chatAttachmentIssues);
const isUploadingFiles = (s: FilesStoreState) => !!attachmentBlock(s);

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
