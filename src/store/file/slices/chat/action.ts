import { type AttachmentRef, type ChatContextContent } from '@lobechat/types';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageFile } from '@lobechat/utils/compressImage';
import { toast } from '@lobehub/ui/base-ui';
import { Buffer } from 'buffer.js';
import { t } from 'i18next';

import { notification } from '@/components/AntdStaticMethods';
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
import { UPLOAD_NETWORK_ERROR } from '@/services/upload';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { type UploadFileListDispatch } from '@/store/file/reducers/uploadFileList';
import { uploadFileListReducer } from '@/store/file/reducers/uploadFileList';
import { type StoreSetter } from '@/store/types';
import { type FileListItem } from '@/types/files';
import { type UploadFileItem } from '@/types/files/upload';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore } from '../../store';
import { filterSupportedChatUploadFiles } from './uploadGuard';

const n = setNamespace('chat');

type Setter = StoreSetter<FileStore>;
export const createFileSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileActionImpl(set, get, _api);

const getTrpcErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('data' in error)) return;

  const data = (error as { data?: { code?: unknown } }).data;
  return typeof data?.code === 'string' ? data.code : undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return String(error);
};

const getUploadErrorDescription = (error: unknown): string => {
  if (error === UPLOAD_NETWORK_ERROR) return t('upload.networkError', { ns: 'error' });

  if (getTrpcErrorCode(error) === 'FORBIDDEN') {
    return t('upload.permissionDenied', { ns: 'error' });
  }

  return typeof error === 'string'
    ? error
    : t('upload.unknownError', { ns: 'error', reason: getErrorMessage(error) });
};

export class FileActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;
  #localIntakeGeneration = 0;

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
        if (file.attachment)
          void releaseLocalAttachmentDraft(file.attachment, file.attachmentDraftId).catch(
            () => undefined,
          );
      }
    this.#set({ chatUploadFileList: [] }, false, n('clearChatUploadFileList'));
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
    dispatchChatUploadFileList({ id, type: 'removeFile' });
    if (!attachment) await fileService.removeFile(id);
    else await releaseLocalAttachmentDraft(attachment, current?.attachmentDraftId);
  };

  addLocalAttachmentToInput = async (
    ref: Extract<AttachmentRef, { source: 'local' }>,
    messageId: string,
    topicId: string,
    previewUrl?: string,
  ): Promise<void> => {
    const intakeGeneration = this.#localIntakeGeneration;
    if (
      this.#get().chatUploadFileList.some(
        (file) => file.attachment?.attachmentId === ref.attachmentId,
      )
    )
      return;
    if (!(await localAttachmentStatus(ref)))
      throw new Error('Attachment is unavailable on this device; select it again');
    await bindLocalAttachmentMessage([{ attachment: ref }], messageId, topicId);
    if (!previewUrl && ref.mime.startsWith('image/'))
      previewUrl = (await previewLocalAttachment(ref, topicId)).dataUrl;
    const draftId = crypto.randomUUID();
    const retained = await retainLocalAttachmentDraft(ref, draftId);
    if (!retained.available)
      throw new Error('Attachment is unavailable on this device; select it again');
    if (intakeGeneration !== this.#localIntakeGeneration) {
      await releaseLocalAttachmentDraft(ref, draftId);
      return;
    }
    this.#get().dispatchChatUploadFileList({
      type: 'addFiles',
      files: [
        {
          attachment: ref,
          attachmentDraftId: draftId,
          id: ref.attachmentId,
          file: new File([], ref.name, { type: ref.mime }),
          previewUrl,
          status: 'success',
          processStage: 'ready_for_chat',
        },
      ],
    });
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
    const { dispatchChatUploadFileList } = this.#get();
    const intakeGeneration = this.#localIntakeGeneration;
    // 0. skip file in blacklist
    const filteredFiles = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));

    // The file-type whitelist only makes sense in plain chat mode, where files are fed
    // directly to the model. In agent mode (tool calls) or heterogeneous agents (Claude
    // Code / Codex, etc.) the agent can parse any file via scripts/terminal, so the
    // whitelist must not apply there. We key off the conversation's own agent id rather
    // than the global current agent, because the chat input can be scoped to a different
    // agent than activeAgentId (e.g. another desktop tab). See lobehub/lobehub#15770.
    const agentState = getAgentStoreState();
    const enforceFileTypeWhitelist =
      !agentByIdSelectors.getAgentEnableModeById(agentId)(agentState) &&
      !agentByIdSelectors.isAgentHeterogeneousById(agentId)(agentState);

    const { supportedFiles, unsupportedFiles } = enforceFileTypeWhitelist
      ? filterSupportedChatUploadFiles(filteredFiles)
      : { supportedFiles: filteredFiles, unsupportedFiles: [] as File[] };

    if (unsupportedFiles.length > 0) {
      toast.error(
        t('upload.validation.unsupportedFileType', {
          files: unsupportedFiles.map((file) => file.name).join(', '),
          ns: 'chat',
        }),
      );
    }

    if (supportedFiles.length === 0) return;

    const execution = isDesktop
      ? await (
          await import('@/store/projectWorkspace/topicExecutionIntent')
        ).resolvePendingTopicExecutionIntent({ agentId, topicId, isNewTopic: !topicId })
      : undefined;
    if (isDesktop && execution?.intent.target === 'local') {
      const draftId = crypto.randomUUID();
      for (const file of supportedFiles) {
        if (intakeGeneration !== this.#localIntakeGeneration) break;
        try {
          const attachment = await receiveLocalChatAttachment(file, draftId);
          if (intakeGeneration !== this.#localIntakeGeneration) {
            await releaseLocalAttachmentDraft(attachment, draftId);
            break;
          }
          dispatchChatUploadFileList({
            type: 'addFiles',
            files: [
              {
                attachment,
                attachmentDraftId: draftId,
                file,
                id: attachment.attachmentId,
                previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
                status: 'success',
                processStage: 'ready_for_chat',
              },
            ],
          });
        } catch (error) {
          const errorKey = getLocalAttachmentErrorKey(error);
          notification.error({
            message: t('upload.uploadFailed', { ns: 'error' }),
            description: errorKey ? t(errorKey, { ns: 'chat' }) : getErrorMessage(error),
          });
        }
      }
      return;
    }

    // 1. compress images and add files with base64
    const files = await Promise.all(
      supportedFiles.map((file) =>
        COMPRESSIBLE_IMAGE_TYPES.has(file.type) ? compressImageFile(file) : file,
      ),
    );

    const uploadFiles: UploadFileItem[] = await Promise.all(
      files.map(async (file) => {
        let previewUrl: string | undefined = undefined;
        let base64Url: string | undefined = undefined;

        // only image and video can be previewed, we create a previewUrl and base64Url for them
        if (file.type.startsWith('image') || file.type.startsWith('video')) {
          const data = await file.arrayBuffer();

          previewUrl = URL.createObjectURL(new Blob([data!], { type: file.type }));

          const base64 = Buffer.from(data!).toString('base64');
          base64Url = `data:${file.type};base64,${base64}`;
        }

        return { base64Url, file, id: file.name, previewUrl, status: 'pending' } as UploadFileItem;
      }),
    );

    dispatchChatUploadFileList({ files: uploadFiles, type: 'addFiles' });

    // upload files and process it
    const pools = files.map(async (file) => {
      let fileResult: { id: string; url: string } | undefined;

      try {
        fileResult = await this.#get().uploadWithProgress({
          file,
          onStatusUpdate: dispatchChatUploadFileList,
        });
      } catch (error) {
        // skip `UNAUTHORIZED` error
        if (getErrorMessage(error) !== 'UNAUTHORIZED')
          notification.error({
            description: getUploadErrorDescription(error),
            message: t('upload.uploadFailed', { ns: 'error' }),
          });

        dispatchChatUploadFileList({ id: file.name, type: 'removeFile' });
      }

      if (!fileResult) return;

      // image don't need to be chunked and embedding
      if (isChunkingUnsupported(file.type)) return;

      const updateUploadedFile = (value: Partial<UploadFileItem>) => {
        dispatchChatUploadFileList({
          id: fileResult.id,
          type: 'updateFile',
          value,
        });

        if (fileResult.id !== file.name) {
          dispatchChatUploadFileList({
            id: file.name,
            type: 'updateFile',
            value,
          });
        }
      };

      updateUploadedFile({
        errorReason: undefined,
        fileUrl: fileResult.url,
        id: fileResult.id,
        processStage: 'content_parsing',
        status: 'processing',
      });

      try {
        await ragService.parseFileContent(fileResult.id);

        updateUploadedFile({
          errorReason: undefined,
          processStage: 'ready_for_chat',
          status: 'success',
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const isStorageObjectFailure =
          errorMessage === FileStorageErrorCode.ObjectMissing ||
          errorMessage === FileStorageErrorCode.ObjectUnavailable;
        const failureStage = isStorageObjectFailure
          ? 'storage_upload_failed'
          : 'content_parse_failed';

        updateUploadedFile({
          diagnostic: {
            fileId: fileResult.id,
            message: errorMessage,
            name: error instanceof Error ? error.name : undefined,
            stage: failureStage,
          },
          errorReason: errorMessage,
          processStage: failureStage,
          status: 'error',
        });

        if (isStorageObjectFailure) {
          notification.error({
            description: getUploadErrorDescription(error),
            message: t('upload.uploadFailed', { ns: 'error' }),
          });
          console.warn('[uploadChatFiles] Uploaded storage object is missing.', error);
        } else {
          notification.warning({
            description: t('upload.parseFailedDesc', { filename: file.name, ns: 'chat' }),
            message: t('upload.parseFailed', { ns: 'chat' }),
          });
          console.warn(
            '[uploadChatFiles] File was uploaded, but content parsing failed. This is not an object storage upload failure.',
            error,
          );
        }
      }
    });

    await Promise.all(pools);
  };
}

export type FileAction = Pick<FileActionImpl, keyof FileActionImpl>;
