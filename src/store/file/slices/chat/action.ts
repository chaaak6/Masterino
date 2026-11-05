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
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
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
import {
  type ChatAttachmentDraft,
  emptyChatAttachmentDraft,
  getChatAttachmentDraft,
} from './drafts';
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
  #localIntakeQueue: Promise<void> = Promise.resolve();

  #draft = (scope?: string) => getChatAttachmentDraft(this.#get(), scope);
  #writeDraft = (scope: string | undefined, value: Partial<ChatAttachmentDraft>): void => {
    const state = this.#get();
    const key = scope || state.chatAttachmentScope;
    const current = this.#draft(key);
    const draft = {
      chatUploadFileList: current.chatUploadFileList,
      chatAttachmentIssues: current.chatAttachmentIssues,
      chatAttachmentNoticeShown: current.chatAttachmentNoticeShown,
      ...value,
    };
    this.#set(
      {
        ...(key ? { chatAttachmentDrafts: { ...state.chatAttachmentDrafts, [key]: draft } } : {}),
        ...(!key || key === state.chatAttachmentScope ? value : {}),
      },
      false,
      n('updateAttachmentDraft'),
    );
  };

  setChatAttachmentScope = (scope: string): void => {
    const state = this.#get();
    if (state.chatAttachmentScope === scope) return;
    // Save the previous draft without releasing its leases or cancelling its work.
    const drafts = { ...state.chatAttachmentDrafts };
    if (state.chatAttachmentScope)
      drafts[state.chatAttachmentScope] = {
        chatUploadFileList: state.chatUploadFileList,
        chatAttachmentIssues: state.chatAttachmentIssues,
        chatAttachmentNoticeShown: state.chatAttachmentNoticeShown,
      };
    const draft =
      drafts[scope] ||
      (state.chatAttachmentScope
        ? emptyChatAttachmentDraft
        : {
            chatUploadFileList: state.chatUploadFileList,
            chatAttachmentIssues: state.chatAttachmentIssues,
            chatAttachmentNoticeShown: state.chatAttachmentNoticeShown,
          });
    this.#set(
      { ...draft, chatAttachmentScope: scope, chatAttachmentDrafts: drafts },
      false,
      n('activateAttachmentDraft'),
    );
  };

  dismissChatAttachmentIssues = (scope?: string): void => {
    this.#writeDraft(scope, { chatAttachmentIssues: [] });
  };

  markChatAttachmentNoticeShown = (scope?: string): void => {
    this.#writeDraft(scope, { chatAttachmentNoticeShown: true });
  };

  #reject = (
    file: { name: string; size: number },
    reason: ChatAttachmentIssue['reason'],
    scope?: string,
  ): void => {
    const issue: ChatAttachmentIssue = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      reason,
      web: !isDesktop,
    };
    this.#writeDraft(scope, {
      chatAttachmentIssues: [...this.#draft(scope).chatAttachmentIssues, issue],
    });
    logChatAttachment('rejected', {
      id: issue.id,
      reason,
      size: file.size,
      target: isDesktop ? 'desktop' : 'web',
    });
  };

  #referenced = (id: string): boolean =>
    this.#get().chatUploadFileList.some((item) => item.id === id) ||
    Object.entries(this.#get().chatAttachmentDrafts).some(
      ([key, draft]) =>
        key !== this.#get().chatAttachmentScope &&
        draft.chatUploadFileList.some((item) => item.id === id),
    );

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

  clearChatUploadFileList = (options?: { preserveAttachments?: boolean }, scope?: string): void => {
    if (!options?.preserveAttachments)
      for (const file of this.#draft(scope).chatUploadFileList) {
        file.abortController?.abort();
        if (file.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl);
        if (file.attachment)
          void releaseLocalAttachmentDraft(file.attachment, file.attachmentDraftId).catch(
            () => undefined,
          );
      }
    this.#writeDraft(scope, {
      chatUploadFileList: [],
      chatAttachmentIssues: [],
      chatAttachmentNoticeShown: false,
    });
  };

  dispatchChatUploadFileList = (payload: UploadFileListDispatch, scope?: string): void => {
    const previous = this.#draft(scope).chatUploadFileList;
    const nextValue = uploadFileListReducer(previous, payload);
    if (nextValue === previous) return;
    this.#writeDraft(scope, { chatUploadFileList: nextValue });
  };

  removeChatContextSelection = (id: string): void => {
    const next = this.#get().chatContextSelections.filter((item) => item.id !== id);
    this.#set({ chatContextSelections: next }, false, n('removeChatContextSelection'));
  };

  removeChatUploadFile = async (id: string, scope?: string): Promise<void> => {
    const current = this.#draft(scope).chatUploadFileList.find(
      (file) => (file.uploadId || file.id) === id || file.id === id,
    );
    const attachment = current?.attachment;
    current?.abortController?.abort();
    this.dispatchChatUploadFileList({ id, type: 'removeFile' }, scope);
    if (current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl);
    logChatAttachment('removed', { id, stage: current?.processStage });
    if (attachment) await releaseLocalAttachmentDraft(attachment, current?.attachmentDraftId);
    else if (current?.fileUrl && !this.#referenced(current.id))
      await fileService.removeFile(current.id);
  };

  retryChatUploadFile = async (
    id: string,
    agentId: string,
    topicId?: string | null,
    scope?: string,
  ): Promise<void> => {
    const item = this.#draft(scope).chatUploadFileList.find(
      (file) => (file.uploadId || file.id) === id || file.id === id,
    );
    if (!item || item.status !== 'error') return;
    await this.removeChatUploadFile(id, scope).catch(() =>
      logChatAttachment('cleanup-failed', { id }),
    );
    await this.uploadChatFiles([item.file], agentId, topicId, scope);
  };

  addLocalAttachmentToInput = async (
    ref: Extract<AttachmentRef, { source: 'local' }>,
    messageId: string,
    topicId: string,
    previewUrl?: string,
    scope = this.#get().chatAttachmentScope,
  ): Promise<boolean> => {
    if (
      this.#draft(scope).chatUploadFileList.some(
        (file) => file.attachment?.attachmentId === ref.attachmentId,
      )
    )
      return true;
    const file = new File([], ref.name, { type: ref.mime });
    if (
      isChatImage(file) &&
      chatImageCount(this.#draft(scope).chatUploadFileList) >= CHAT_IMAGE_LIMIT
    ) {
      this.#reject(ref, 'image-count', scope);
      return false;
    }
    const dispatch = (payload: UploadFileListDispatch) =>
      this.dispatchChatUploadFileList(payload, scope);
    const id = crypto.randomUUID();
    const draftId = crypto.randomUUID();
    dispatch({
      type: 'addFiles',
      files: [{ id, uploadId: id, file, status: 'pending' }],
    });
    const alive = () => this.#draft(scope).chatUploadFileList.some((item) => item.uploadId === id);
    let retained = false;
    try {
      if (!(await localAttachmentStatus(ref))) throw new Error('Attachment unavailable');
      await bindLocalAttachmentMessage([{ attachment: ref }], messageId, topicId);
      if (!previewUrl && ref.mime.startsWith('image/'))
        previewUrl = (await previewLocalAttachment(ref, topicId)).dataUrl;
      retained = (await retainLocalAttachmentDraft(ref, draftId)).available;
      if (!retained) throw new Error('Attachment unavailable');
      if (!alive()) return false;
      dispatch({
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
      dispatch({
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
    scope = messageMapKey({ agentId, topicId }),
  ): Promise<void> => {
    this.setChatAttachmentScope(scope);
    const dispatch = (payload: UploadFileListDispatch) =>
      this.dispatchChatUploadFileList(payload, scope);
    const agentState = getAgentStoreState();
    const enforceWhitelist =
      !agentByIdSelectors.getAgentEnableModeById(agentId)(agentState) &&
      !agentByIdSelectors.isAgentHeterogeneousById(agentId)(agentState);
    const candidates = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
    const { supportedFiles, unsupportedFiles } = enforceWhitelist
      ? filterSupportedChatUploadFiles(candidates)
      : { supportedFiles: candidates, unsupportedFiles: [] as File[] };
    for (const file of unsupportedFiles) this.#reject(file, 'unsupported-format', scope);

    // Reserve synchronously, before execution intent, decoding or IPC can yield.
    let images = chatImageCount(this.#draft(scope).chatUploadFileList);
    const reserved: UploadFileItem[] = [];
    for (const file of supportedFiles) {
      if (!isDesktop && file.size > WEB_CHAT_FILE_MAX_BYTES) {
        this.#reject(file, 'web-size', scope);
        continue;
      }
      if (isChatImage(file) && images >= CHAT_IMAGE_LIMIT) {
        this.#reject(file, 'image-count', scope);
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
    dispatch({ files: reserved, type: 'addFiles' });
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
        dispatch({
          id: item.id,
          type: 'updateFile',
          value: { status: 'error', attachmentError: 'local-failed' },
        });
      return;
    }

    const prepare = async (reservedItem: UploadFileItem) => {
      const uploadId = reservedItem.id;
      const current = () =>
        this.#draft(scope).chatUploadFileList.find((item) => item.uploadId === uploadId);
      const update = (value: Partial<UploadFileItem>) => {
        const item = current();
        if (item) {
          if (value.processStage && value.processStage !== item.processStage)
            logChatAttachment('stage', { id: uploadId, stage: value.processStage });
          dispatch({ id: uploadId, type: 'updateFile', value });
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
              else if (current()) dispatch({ id: uploadId, type: 'removeFile' });
            },
          });
          if (!result) {
            update({ status: 'error', attachmentError: 'upload-failed' });
            return;
          }
          if (!current()) {
            if (!this.#referenced(result.id)) await fileService.removeFile(result.id);
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
    };
    if (local) {
      // IPC transfers are bounded and image decoding can allocate much more than file.size.
      // Share a queue across batches; cancellation checks run when a job starts.
      for (const item of reserved) {
        const job = this.#localIntakeQueue.then(() => prepare(item));
        this.#localIntakeQueue = job.catch(() => undefined);
        await job;
      }
    } else await Promise.all(reserved.map(prepare));
  };
}

export type FileAction = Pick<FileActionImpl, keyof FileActionImpl>;
