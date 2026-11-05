import { type AttachmentRef, type ChatContextContent } from '@lobechat/types';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageFile } from '@lobechat/utils/compressImage';
import { Buffer } from 'buffer.js';
import { t } from 'i18next';

import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { FileStorageErrorCode } from '@/const/fileUpload';
import { isDesktop } from '@/const/version';
import {
  bindLocalAttachmentMessage,
  getLocalAttachmentErrorKey,
  localAttachmentStatus,
  previewLocalAttachment,
  receiveLocalChatAttachment,
  releaseLocalAttachmentDraft,
  retainLocalAttachmentDraft,
} from '@/services/electron/localAttachmentService';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { type UploadFileListDispatch } from '@/store/file/reducers/uploadFileList';
import { uploadFileListReducer } from '@/store/file/reducers/uploadFileList';
import { type StoreSetter } from '@/store/types';
import { type FileListItem } from '@/types/files';
import { type UploadFileItem } from '@/types/files/upload';
import {
  CHAT_IMAGE_LIMIT,
  type ChatAttachmentIssue,
  chatImageCount,
  classifyChatAttachmentError,
  isChatImage,
  logChatAttachment,
  WEB_CHAT_FILE_MAX_BYTES,
} from '@/utils/chatAttachments';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore } from '../../store';
import { filterSupportedChatUploadFiles } from './uploadGuard';

const n = setNamespace('chat');

type Setter = StoreSetter<FileStore>;
export const createFileSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileActionImpl(set, get, _api);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return String(error);
};

export class FileActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;
  #localIntakeGeneration = 0;
  #scope?: string;

  setChatAttachmentScope = (scope: string): void => {
    if (this.#scope !== undefined && this.#scope !== scope) this.clearChatUploadFileList();
    this.#scope = scope;
  };

  dismissChatAttachmentIssues = (): void => {
    this.#set({ chatAttachmentIssues: [] }, false, n('dismissAttachmentIssues'));
  };

  markChatAttachmentNoticeShown = (): void => {
    this.#set({ chatAttachmentNoticeShown: true }, false, n('attachmentNoticeShown'));
  };

  #reject = (file: { name: string; size: number }, reason: ChatAttachmentIssue['reason']): void => {
    const issue: ChatAttachmentIssue = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      reason,
      web: !isDesktop,
    };
    this.#set(
      { chatAttachmentIssues: [...this.#get().chatAttachmentIssues, issue] },
      false,
      n('rejectAttachment'),
    );
    logChatAttachment('rejected', {
      id: issue.id,
      reason,
      size: file.size,
      target: isDesktop ? 'desktop' : 'web',
    });
  };

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addChatContextSelection = (context: ChatContextContent): void => {
    const current = this.#get().chatContextSelections;
    const next = [context, ...current.filter((item) => item.id !== context.id)];

    this.#set({ chatContextSelections: next }, false, n('addChatContextSelection'));
  };

  clearChatContextSelections = (): void => {
    this.#set({ chatContextSelections: [] }, false, n('clearChatContextSelections'));
  };

  clearChatUploadFileList = (options?: { preserveAttachments?: boolean }): void => {
    this.#localIntakeGeneration += 1;
    if (!options?.preserveAttachments)
      for (const file of this.#get().chatUploadFileList) {
        file.abortController?.abort();
        if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl);
        if (file.attachment)
          void releaseLocalAttachmentDraft(file.attachment, file.attachmentDraftId).catch(
            () => undefined,
          );
      }
    this.#set(
      { chatUploadFileList: [], chatAttachmentIssues: [], chatAttachmentNoticeShown: false },
      false,
      n('clearChatUploadFileList'),
    );
  };

  dispatchChatUploadFileList = (payload: UploadFileListDispatch): void => {
    const nextValue = uploadFileListReducer(this.#get().chatUploadFileList, payload);
    if (nextValue === this.#get().chatUploadFileList) return;

    this.#set({ chatUploadFileList: nextValue }, false, `dispatchChatFileList/${payload.type}`);
  };

  removeChatContextSelection = (id: string): void => {
    const next = this.#get().chatContextSelections.filter((item) => item.id !== id);
    this.#set({ chatContextSelections: next }, false, n('removeChatContextSelection'));
  };

  removeChatUploadFile = async (id: string): Promise<void> => {
    const { dispatchChatUploadFileList } = this.#get();

    const current = this.#get().chatUploadFileList.find((file) => file.id === id);
    const attachment = current?.attachment;
    current?.abortController?.abort();
    dispatchChatUploadFileList({ id, type: 'removeFile' });
    if (current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl);
    logChatAttachment('removed', { id, stage: current?.processStage });
    if (attachment) await releaseLocalAttachmentDraft(attachment, current?.attachmentDraftId);
    else if (current?.fileUrl) await fileService.removeFile(id);
  };

  retryChatUploadFile = async (
    id: string,
    agentId: string,
    topicId?: string | null,
  ): Promise<void> => {
    const item = this.#get().chatUploadFileList.find((file) => file.id === id);
    if (!item || item.status !== 'error') return;
    const generation = this.#localIntakeGeneration;
    await this.removeChatUploadFile(id).catch(() => logChatAttachment('cleanup-failed', { id }));
    if (generation === this.#localIntakeGeneration)
      await this.uploadChatFiles([item.file], agentId, topicId);
  };

  addLocalAttachmentToInput = async (
    ref: Extract<AttachmentRef, { source: 'local' }>,
    messageId: string,
    topicId: string,
    previewUrl?: string,
  ): Promise<boolean> => {
    if (
      this.#get().chatUploadFileList.some(
        (file) => file.attachment?.attachmentId === ref.attachmentId,
      )
    )
      return true;
    const file = new File([], ref.name, { type: ref.mime });
    if (isChatImage(file) && chatImageCount(this.#get().chatUploadFileList) >= CHAT_IMAGE_LIMIT) {
      this.#reject(ref, 'image-count');
      return false;
    }
    const generation = this.#localIntakeGeneration;
    const id = crypto.randomUUID();
    const draftId = crypto.randomUUID();
    this.#get().dispatchChatUploadFileList({
      type: 'addFiles',
      files: [{ id, uploadId: id, file, status: 'pending' }],
    });
    const alive = () =>
      generation === this.#localIntakeGeneration &&
      this.#get().chatUploadFileList.some((item) => item.uploadId === id);
    let retained = false;
    try {
      if (!(await localAttachmentStatus(ref))) throw new Error('Attachment unavailable');
      await bindLocalAttachmentMessage([{ attachment: ref }], messageId, topicId);
      if (!previewUrl && ref.mime.startsWith('image/'))
        previewUrl = (await previewLocalAttachment(ref, topicId)).dataUrl;
      retained = (await retainLocalAttachmentDraft(ref, draftId)).available;
      if (!retained) throw new Error('Attachment unavailable');
      if (!alive()) return false;
      this.#get().dispatchChatUploadFileList({
        id,
        type: 'updateFile',
        value: {
          attachment: ref,
          attachmentDraftId: draftId,
          id: ref.attachmentId,
          previewUrl,
          status: 'success',
          processStage: 'ready_for_chat',
        },
      });
      return true;
    } catch (error) {
      this.#get().dispatchChatUploadFileList({
        id,
        type: 'updateFile',
        value: {
          status: 'error',
          attachmentError: 'local-failed',
          errorReason: getErrorMessage(error),
        },
      });
      return false;
    } finally {
      if (retained && !alive()) await releaseLocalAttachmentDraft(ref, draftId);
    }
  };

  startAsyncTask = async (
    id: string,
    runner: (id: string) => Promise<string>,
    onFileItemUpdate: (fileItem: FileListItem) => void,
  ): Promise<void> => {
    await runner(id);

    let isFinished = false;

    while (!isFinished) {
      // Poll task status every 2 seconds
      await sleep(2000);

      let fileItem: FileListItem | undefined;

      try {
        const result = await fileService.getKnowledgeItem(id);
        fileItem = result ?? undefined;
      } catch (e) {
        console.error('getFileItem Error:', e);
        continue;
      }

      if (!fileItem) return;

      onFileItemUpdate(fileItem);

      if (fileItem.finishEmbedding) {
        isFinished = true;
      }

      // if error, also break
      else if (fileItem.chunkingStatus === 'error' || fileItem.embeddingStatus === 'error') {
        isFinished = true;
      }
    }
  };

  uploadChatFiles = async (
    rawFiles: File[],
    agentId: string,
    topicId?: string | null,
  ): Promise<void> => {
    const generation = this.#localIntakeGeneration;
    const agentState = getAgentStoreState();
    const enforceWhitelist =
      !agentByIdSelectors.getAgentEnableModeById(agentId)(agentState) &&
      !agentByIdSelectors.isAgentHeterogeneousById(agentId)(agentState);
    const candidates = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
    const { supportedFiles, unsupportedFiles } = enforceWhitelist
      ? filterSupportedChatUploadFiles(candidates)
      : { supportedFiles: candidates, unsupportedFiles: [] as File[] };
    for (const file of unsupportedFiles) this.#reject(file, 'unsupported-format');

    // Reserve synchronously, before execution intent, decoding or IPC can yield.
    let images = chatImageCount(this.#get().chatUploadFileList);
    const reserved: UploadFileItem[] = [];
    for (const file of supportedFiles) {
      if (!isDesktop && file.size > WEB_CHAT_FILE_MAX_BYTES) {
        this.#reject(file, 'web-size');
        continue;
      }
      if (isChatImage(file) && images >= CHAT_IMAGE_LIMIT) {
        this.#reject(file, 'image-count');
        continue;
      }
      if (isChatImage(file)) images += 1;
      const id = crypto.randomUUID();
      reserved.push({
        id,
        uploadId: id,
        file,
        status: 'pending',
        abortController: new AbortController(),
      });
    }
    if (!reserved.length) return;
    this.#get().dispatchChatUploadFileList({ files: reserved, type: 'addFiles' });
    logChatAttachment('intake', { count: reserved.length, target: isDesktop ? 'desktop' : 'web' });

    let local = false;
    try {
      if (isDesktop) {
        const { resolvePendingTopicExecutionIntent } =
          await import('@/store/projectWorkspace/topicExecutionIntent');
        const execution = await resolvePendingTopicExecutionIntent({
          agentId,
          topicId,
          isNewTopic: !topicId,
        });
        local = execution?.intent.target === 'local';
      }
    } catch {
      for (const item of reserved)
        this.#get().dispatchChatUploadFileList({
          id: item.id,
          type: 'updateFile',
          value: { status: 'error', attachmentError: 'local-failed' },
        });
      return;
    }

    await Promise.all(
      reserved.map(async (reservedItem) => {
        const uploadId = reservedItem.id;
        const current = () =>
          generation === this.#localIntakeGeneration
            ? this.#get().chatUploadFileList.find((item) => item.uploadId === uploadId)
            : undefined;
        const update = (value: Partial<UploadFileItem>) => {
          const item = current();
          if (item) {
            if (value.processStage && value.processStage !== item.processStage)
              logChatAttachment('stage', { id: uploadId, stage: value.processStage });
            this.#get().dispatchChatUploadFileList({ id: item.id, type: 'updateFile', value });
          }
        };
        if (!current()) return;
        let file = reservedItem.file;
        let parsing = false;
        try {
          if (local) {
            const draftId = crypto.randomUUID();
            const attachment = await receiveLocalChatAttachment(file, draftId);
            if (!current()) {
              await releaseLocalAttachmentDraft(attachment, draftId);
              return;
            }
            update({
              attachment,
              attachmentDraftId: draftId,
              id: attachment.attachmentId,
              previewUrl: isChatImage(file) ? URL.createObjectURL(file) : undefined,
              status: 'success',
              processStage: 'ready_for_chat',
            });
          } else {
            // Keep the existing Web image preprocessing contract; UI thumbnails never replace input.
            if (COMPRESSIBLE_IMAGE_TYPES.has(file.type)) file = await compressImageFile(file);
            if (!current()) return;
            let previewUrl: string | undefined;
            let base64Url: string | undefined;
            if (isChatImage(file) || file.type.startsWith('video/')) {
              const data = await file.arrayBuffer();
              if (!current()) return;
              previewUrl = URL.createObjectURL(file);
              base64Url = `data:${file.type};base64,${Buffer.from(data).toString('base64')}`;
            }
            update({ file, previewUrl, base64Url });
            const result = await this.#get().uploadWithProgress({
              file,
              uploadId,
              abortController: reservedItem.abortController,
              onStatusUpdate: (action) => {
                if (action.type === 'updateFile') update(action.value);
                else if (current())
                  this.#get().dispatchChatUploadFileList({ id: current()!.id, type: 'removeFile' });
              },
            });
            if (!result) {
              update({ status: 'error', attachmentError: 'upload-failed' });
              return;
            }
            if (!current()) {
              await fileService.removeFile(result.id);
              return;
            }
            update({ id: result.id, fileUrl: result.url });
            if (!isChunkingUnsupported(file.type)) {
              parsing = true;
              update({ status: 'processing', processStage: 'content_parsing' });
              await ragService.parseFileContent(result.id);
            }
            update({ status: 'success', processStage: 'ready_for_chat', errorReason: undefined });
          }
          logChatAttachment('ready', {
            id: uploadId,
            size: file.size,
            target: local ? 'local' : 'cloud',
          });
        } catch (error) {
          if (!current()) return;
          const errorMessage = getErrorMessage(error);
          const storageFailure =
            errorMessage === FileStorageErrorCode.ObjectMissing ||
            errorMessage === FileStorageErrorCode.ObjectUnavailable;
          const reason = local
            ? 'local-failed'
            : classifyChatAttachmentError(error, {
                size: reservedItem.file.size,
                web: !isDesktop,
                parsing: parsing && !storageFailure,
              });
          const stage =
            parsing && !storageFailure
              ? 'content_parse_failed'
              : storageFailure
                ? 'storage_upload_failed'
                : current()?.diagnostic?.stage || 'storage_upload_failed';
          const localErrorKey = local ? getLocalAttachmentErrorKey(error) : undefined;
          update({
            status: 'error',
            attachmentError: reason,
            errorReason: localErrorKey ? t(localErrorKey, { ns: 'chat' }) : undefined,
            processStage: stage,
            diagnostic: {
              fileId: current()?.fileUrl ? current()?.id : undefined,
              message: storageFailure ? errorMessage : undefined,
              stage,
              status:
                typeof error === 'object' &&
                error !== null &&
                'status' in error &&
                typeof error.status === 'number'
                  ? error.status
                  : undefined,
            },
          });
          logChatAttachment('failed', {
            id: uploadId,
            reason,
            size: reservedItem.file.size,
            stage,
          });
        }
      }),
    );
  };
}

export type FileAction = Pick<FileActionImpl, keyof FileActionImpl>;
