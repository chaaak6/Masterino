import { LOBE_CHAT_CLOUD } from '@lobechat/business-const';
import { inferImageMimeTypeFromBytes } from '@lobechat/utils';
import { t } from 'i18next';
import { sha256 } from 'js-sha256';

import { handleFileUploadError } from '@/business/client/handleFileUploadError';
import { message } from '@/components/AntdStaticMethods';
import { fileService } from '@/services/file';
import { uploadService } from '@/services/upload';
import { type StoreSetter } from '@/store/types';
import { type FileMetadata, type FileUploadDiagnostic, type UploadFileItem } from '@/types/files';
import { type FileUploadProcessStage } from '@/types/files/upload';
import { getImageDimensions } from '@/utils/client/imageDimensions';

import { type FileStore } from '../../store';

type OnStatusUpdate = (
  data:
    | {
        id: string;
        type: 'updateFile';
        value: Partial<UploadFileItem>;
      }
    | {
        id: string;
        type: 'removeFile';
      },
) => void;

interface UploadWithProgressParams {
  abortController?: AbortController;
  file: File;
  knowledgeBaseId?: string;
  onStatusUpdate?: OnStatusUpdate;
  parentId?: string;
  /**
   * Optional flag to indicate whether to skip the file type check.
   * When set to `true`, any file type checks will be bypassed.
   * Default is `false`, which means file type checks will be performed.
   */
  skipCheckFileType?: boolean;
  /**
   * Optional source identifier for the file (e.g., 'page-editor', 'image_generation')
   */
  source?: string;
  uploadId?: string;
}

interface UploadWithProgressResult {
  dimensions?: {
    height: number;
    ratio: number;
    width: number;
  };
  filename?: string;
  id: string;
  url: string;
}

const normalizeUploadedImageFileType = async (
  file: File,
  fileArrayBuffer: ArrayBuffer,
): Promise<File> => {
  const detectedMimeType = await inferImageMimeTypeFromBytes(fileArrayBuffer);

  if (!detectedMimeType || detectedMimeType === file.type) return file;

  return new File([file], file.name, {
    lastModified: file.lastModified,
    type: detectedMimeType,
  });
};

type Setter = StoreSetter<FileStore>;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return String(error);
};

const getFailedStage = (stage: FileUploadProcessStage): FileUploadProcessStage => {
  if (stage === 'storage_uploading') return 'storage_upload_failed';

  return 'file_record_failed';
};

const getFailureDiagnostic = (
  error: unknown,
  stage: FileUploadProcessStage,
): FileUploadDiagnostic => ({
  message: getErrorMessage(error),
  name: error instanceof Error ? error.name : undefined,
  stage,
  status:
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined,
  url:
    typeof error === 'object' &&
    error !== null &&
    'url' in error &&
    typeof (error as { url?: unknown }).url === 'string'
      ? (error as { url: string }).url
      : undefined,
});

export const createFileUploadSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileUploadActionImpl(set, get, _api);

export class FileUploadActionImpl {
  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  uploadBase64FileWithProgress = async (
    base64: string,
  ): Promise<UploadWithProgressResult | undefined> => {
    try {
      // Extract image dimensions from base64 data
      const dimensions = await getImageDimensions(base64);

      const { metadata, fileType, size, hash } = await uploadService.uploadBase64ToS3(base64);

      const res = await fileService.createFile({
        fileType,
        hash,
        metadata: { ...metadata, ...dimensions },
        name: metadata.filename,
        size,
        url: metadata.path,
      });
      return { ...res, dimensions, filename: metadata.filename };
    } catch (error) {
      if (handleFileUploadError(error)) return;

      throw error;
    }
  };

  uploadWithProgress = async ({
    file,
    onStatusUpdate,
    knowledgeBaseId,
    skipCheckFileType,
    parentId,
    source,
    uploadId,
    abortController,
  }: UploadWithProgressParams): Promise<UploadWithProgressResult | undefined> => {
    const statusId = uploadId ?? file.name;
    let processStage: FileUploadProcessStage = 'pending';

    try {
      const fileArrayBuffer = await file.arrayBuffer();
      const normalizedFile = await normalizeUploadedImageFileType(file, fileArrayBuffer);

      // 1. extract image dimensions if applicable
      const dimensions = await getImageDimensions(normalizedFile);

      // 2. check file hash
      const hash = sha256(fileArrayBuffer);

      const checkStatus = await fileService.checkFileHash(hash);
      let metadata: FileMetadata;

      // 3. if file exist, just skip upload
      if (checkStatus.isExist) {
        processStage = 'file_record_creating';
        metadata = checkStatus.metadata as FileMetadata;
        onStatusUpdate?.({
          id: statusId,
          type: 'updateFile',
          value: {
            processStage,
            status: 'processing',
            uploadState: { progress: 100, restTime: 0, speed: 0 },
          },
        });
      }
      // 3. if file don't exist, need upload files
      else {
        processStage = 'storage_uploading';
        const { data, success } = await uploadService.uploadFileToS3(normalizedFile, {
          abortController,
          onNotSupported: () => {
            onStatusUpdate?.({ id: statusId, type: 'removeFile' });
            message.info({
              content: t('upload.fileOnlySupportInServerMode', {
                cloud: LOBE_CHAT_CLOUD,
                ext: normalizedFile.name.split('.').pop(),
                ns: 'error',
              }),
              duration: 5,
            });
          },
          onProgress: (status, upload) => {
            processStage = status === 'success' ? 'file_record_creating' : 'storage_uploading';
            onStatusUpdate?.({
              id: statusId,
              type: 'updateFile',
              value: {
                processStage,
                status: status === 'success' ? 'processing' : status,
                uploadState: upload,
              },
            });
          },
          skipCheckFileType,
        });
        if (!success) return;

        metadata = data;
      }

      // 4. use more powerful file type detector to get file type
      let fileType = normalizedFile.type;

      if (!normalizedFile.type) {
        const { fileTypeFromBuffer } = await import('file-type');

        const type = await fileTypeFromBuffer(fileArrayBuffer);
        fileType = type?.mime || 'text/plain';
      }

      // 5. create file to db
      processStage = 'file_record_creating';
      const data = await fileService.createFile(
        {
          fileType,
          hash,
          metadata: { ...metadata, ...dimensions },
          name: normalizedFile.name,
          parentId,
          size: normalizedFile.size,
          source,
          url: metadata.path || checkStatus.url,
        },
        knowledgeBaseId,
      );

      processStage = 'file_record_created';
      onStatusUpdate?.({
        id: statusId,
        type: 'updateFile',
        value: {
          errorReason: undefined,
          fileUrl: data.url,
          id: data.id,
          processStage,
          status: 'success',
          uploadState: { progress: 100, restTime: 0, speed: 0 },
        },
      });

      return { ...data, dimensions, filename: normalizedFile.name };
    } catch (error) {
      const failedStage = getFailedStage(processStage);

      onStatusUpdate?.({
        id: statusId,
        type: 'updateFile',
        value: {
          diagnostic: getFailureDiagnostic(error, failedStage),
          errorReason: getErrorMessage(error),
          processStage: failedStage,
          status: 'error',
        },
      });

      if (
        handleFileUploadError(error, {
          onUploadBlocked: () => onStatusUpdate?.({ id: statusId, type: 'removeFile' }),
        })
      ) {
        return;
      }

      throw error;
    }
  };
}

export type FileUploadAction = Pick<FileUploadActionImpl, keyof FileUploadActionImpl>;
