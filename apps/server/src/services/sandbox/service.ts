import { randomUUID } from 'node:crypto';

import {
  type SandboxCallToolResult,
  type SandboxExportError,
  type SandboxExportFileResult,
  selectSandboxInitFiles,
} from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';
import { sha256 } from 'js-sha256';
import mime from 'mime';

import { FileModel } from '@/database/models/file';

import {
  buildSandboxFilesInitCommand,
  SANDBOX_INIT_TIMEOUT_MS,
  type SandboxInitDownload,
} from './bootstrap';
import type {
  SandboxCommandResult,
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderKind,
  SandboxService,
  SandboxServiceOptions,
} from './types';

const log = debug('lobe-server:sandbox:service');
const EXPORT_FALLBACK_MAX_BYTES = 10 * 1024 * 1024;
const EXPORT_UPLOAD_ATTEMPTS = 2;
const SIGNED_URL_PATTERN = /https?:\/\/[^\s"')]+/gi;

const sanitizeExportErrorMessage = (message: string) =>
  message.replaceAll(SIGNED_URL_PATTERN, '[redacted-url]');

const sanitizeExportFilename = (filename: string) => {
  const baseName = filename.split(/[\\/]/).pop() || 'exported-file';
  const withoutControlCharacters = Array.from(baseName, (char) =>
    (char.codePointAt(0) || 0) < 32 ? '-' : char,
  ).join('');
  const sanitized = withoutControlCharacters
    .replaceAll(/[<>:"/\\|?*]/g, '-')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 160);

  return sanitized || 'exported-file';
};

const exportError = (
  stage: SandboxExportError['stage'],
  code: string,
  message: string,
  retryable = false,
  name?: string,
): SandboxExportError => ({
  code,
  message: sanitizeExportErrorMessage(message),
  name,
  retryable,
  stage,
});

export class SandboxMiddlewareService implements SandboxService {
  readonly capabilities: SandboxProviderCapabilities;
  readonly kind: SandboxProviderKind;

  private filesInitialized = false;

  constructor(
    private readonly provider: SandboxProvider,
    private readonly options: SandboxServiceOptions,
  ) {
    this.capabilities = provider.capabilities;
    this.kind = provider.kind;
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    await this.ensureFilesInitialized();
    return this.provider.callTool(toolName, params);
  }

  /**
   * Sync the files the user uploaded in this topic/session into the sandbox the
   * first time this service instance is used. Best-effort: any failure is
   * swallowed so it never blocks the actual tool call.
   *
   * The downloaded command is guarded by an in-sandbox marker file, which is the
   * single source of truth for idempotency: it is a cheap no-op once synced, and
   * if the sandbox session is recycled the marker disappears so the next call
   * re-syncs automatically. We intentionally do NOT cache the "done" state out of
   * band (e.g. in Redis), because that could skip the re-sync after a recycle and
   * leave the agent believing files exist when /mnt/data is empty.
   */
  private async ensureFilesInitialized(): Promise<void> {
    if (this.filesInitialized) return;
    this.filesInitialized = true;

    const { fileService, serverDB, topicId, userId } = this.options;
    if (!serverDB || !fileService || !topicId || !userId) return;
    if (!this.provider.capabilities.shell) return;

    try {
      const fileModel = new FileModel(serverDB, userId);
      const files = selectSandboxInitFiles(await fileModel.findFilesToInitInSandbox(topicId));

      if (files.length === 0) return;

      const downloads = (
        await Promise.all(
          files.map(async (file): Promise<SandboxInitDownload | null> => {
            const url = await fileService
              .createCachedPreSignedUrlForPreview(file.url)
              .catch(() => '');
            return url ? { name: file.name, url } : null;
          }),
        )
      ).filter((item): item is SandboxInitDownload => item !== null);

      if (downloads.length === 0) return;

      const command = buildSandboxFilesInitCommand(downloads);
      const result = await this.provider.callTool('runCommand', {
        command,
        timeout: SANDBOX_INIT_TIMEOUT_MS,
      });

      log(
        'Sandbox file init for topic %s: %d files, success=%s',
        topicId,
        downloads.length,
        result.success,
      );
    } catch (error) {
      log('Sandbox file init failed for topic %s: %O', topicId, error);
    }
  }

  async exportAndUploadFile(path: string, filename: string): Promise<SandboxExportFileResult> {
    const { fileService, topicId } = this.options;
    const safeFilename = sanitizeExportFilename(filename);

    if (!fileService) {
      return {
        error: exportError(
          'record',
          'FILE_SERVICE_UNAVAILABLE',
          'File storage is not configured for sandbox export',
        ),
        filename: safeFilename,
        success: false,
      };
    }

    log('Exporting file: %s from sandbox, topicId: %s', safeFilename, topicId);

    const now = Date.now();
    const today = new Date(now).toISOString().split('T')[0];
    const key = `code-interpreter-exports/${today}/${topicId}/${randomUUID()}/${safeFilename}`;
    let fileSize: number | undefined;
    let mimeType = mime.getType(safeFilename) || 'application/octet-stream';

    if (this.provider.inspectFileForExport) {
      try {
        const inspected = await this.provider.inspectFileForExport(path);
        if (!inspected.success) {
          return {
            error: exportError(
              'inspect',
              'FILE_INSPECTION_FAILED',
              inspected.error?.message || 'Unable to inspect the sandbox file',
              false,
              inspected.error?.name,
            ),
            filename: safeFilename,
            success: false,
          };
        }
        fileSize = inspected.size;
        mimeType = inspected.mimeType || mimeType;
      } catch (error) {
        return {
          error: exportError(
            'inspect',
            'FILE_INSPECTION_FAILED',
            (error as Error).message,
            false,
            (error as Error).name,
          ),
          filename: safeFilename,
          success: false,
        };
      }
    }

    let uploaded = false;
    let exportedMimeType: string | undefined;
    let lastUploadError: { message: string; name?: string } | undefined;
    let lastUploadStage: SandboxExportError['stage'] = 'upload';

    for (let attempt = 1; attempt <= EXPORT_UPLOAD_ATTEMPTS; attempt++) {
      let upload: { headers?: Record<string, string>; url: string };
      try {
        upload = await fileService.createPreSignedUpload(key, { contentType: mimeType });
      } catch (error) {
        const err = error as Error;
        lastUploadError = { message: sanitizeExportErrorMessage(err.message), name: err.name };
        lastUploadStage = 'sign';
        log(
          'Sandbox export signing attempt %d/%d failed for topic %s: %s',
          attempt,
          EXPORT_UPLOAD_ATTEMPTS,
          topicId,
          lastUploadError.message,
        );
        continue;
      }

      try {
        const exported = await this.provider.exportFileToUploadUrl({
          filename: safeFilename,
          path,
          uploadHeaders: upload.headers,
          uploadUrl: upload.url,
        });

        if (exported.success) {
          uploaded = true;
          exportedMimeType = exported.mimeType;
          fileSize ??= exported.size;
          break;
        }

        lastUploadError = {
          message: sanitizeExportErrorMessage(
            exported.error?.message || 'Worker could not upload the sandbox file',
          ),
          name: exported.error?.name,
        };
        lastUploadStage = 'upload';
        log(
          'Sandbox export upload attempt %d/%d failed for topic %s: %s',
          attempt,
          EXPORT_UPLOAD_ATTEMPTS,
          topicId,
          lastUploadError.message,
        );
      } catch (error) {
        const err = error as Error;
        lastUploadError = { message: sanitizeExportErrorMessage(err.message), name: err.name };
        lastUploadStage = 'upload';
        log(
          'Sandbox export upload attempt %d/%d threw for topic %s: %s',
          attempt,
          EXPORT_UPLOAD_ATTEMPTS,
          topicId,
          lastUploadError.message,
        );
      }
    }

    if (!uploaded) {
      if (!this.provider.readFileForExport) {
        return {
          error: exportError(
            lastUploadStage,
            lastUploadStage === 'sign' ? 'UPLOAD_SIGNING_FAILED' : 'WORKER_UPLOAD_FAILED',
            lastUploadError?.message || 'Worker could not upload the sandbox file',
            true,
            lastUploadError?.name,
          ),
          filename: safeFilename,
          mimeType,
          size: fileSize,
          success: false,
        };
      }

      if (fileSize !== undefined && fileSize > EXPORT_FALLBACK_MAX_BYTES) {
        return {
          error: exportError(
            'fallback',
            'FALLBACK_FILE_TOO_LARGE',
            'Worker upload failed and the file exceeds the 10 MiB server fallback limit',
            true,
          ),
          filename: safeFilename,
          mimeType,
          size: fileSize,
          success: false,
        };
      }

      try {
        const fallback = await this.provider.readFileForExport(path, EXPORT_FALLBACK_MAX_BYTES);
        if (!fallback.success || fallback.contentBase64 === undefined) {
          return {
            error: exportError(
              'fallback',
              'FALLBACK_READ_FAILED',
              fallback.error?.message || 'Unable to read the sandbox file for server upload',
              true,
              fallback.error?.name,
            ),
            filename: safeFilename,
            mimeType,
            size: fileSize,
            success: false,
          };
        }

        const buffer = Buffer.from(fallback.contentBase64, 'base64');
        if (buffer.byteLength > EXPORT_FALLBACK_MAX_BYTES) {
          return {
            error: exportError(
              'fallback',
              'FALLBACK_FILE_TOO_LARGE',
              'Sandbox file exceeds the 10 MiB server fallback limit',
              true,
            ),
            filename: safeFilename,
            mimeType,
            size: buffer.byteLength,
            success: false,
          };
        }

        mimeType = fallback.mimeType || mimeType;
        fileSize = buffer.byteLength;
        await fileService.uploadBuffer(key, buffer, mimeType);
        uploaded = true;
        log('Sandbox export used server fallback for topic %s (%d bytes)', topicId, fileSize);
      } catch (error) {
        return {
          error: exportError(
            'fallback',
            'FALLBACK_UPLOAD_FAILED',
            (error as Error).message,
            true,
            (error as Error).name,
          ),
          filename: safeFilename,
          mimeType,
          size: fileSize,
          success: false,
        };
      }
    }

    let metadata: { contentLength: number; contentType?: string };
    try {
      metadata = await fileService.getFileMetadata(key);
    } catch (error) {
      return {
        error: exportError(
          'metadata',
          'STORAGE_METADATA_FAILED',
          (error as Error).message,
          true,
          (error as Error).name,
        ),
        filename: safeFilename,
        mimeType,
        size: fileSize,
        success: false,
      };
    }

    fileSize = metadata.contentLength;
    mimeType = metadata.contentType || exportedMimeType || mimeType;
    const fileHash = sha256(key + now.toString());

    try {
      const { fileId, url } = await fileService.createFileRecord({
        fileHash,
        fileType: mimeType,
        name: safeFilename,
        size: fileSize,
        url: key,
      });

      return {
        fileId,
        filename: safeFilename,
        mimeType,
        size: fileSize,
        success: true,
        url,
      };
    } catch (error) {
      return {
        error: exportError(
          'record',
          'FILE_RECORD_FAILED',
          (error as Error).message,
          true,
          (error as Error).name,
        ),
        filename: safeFilename,
        mimeType,
        size: fileSize,
        success: false,
      };
    }
  }
}

export const normalizeSandboxCommandResult = (
  result: SandboxCallToolResult,
): SandboxCommandResult => {
  if (!result.success) {
    return {
      exitCode: 1,
      output: '',
      stderr: result.error?.message || 'Command execution failed',
      success: false,
    };
  }

  const raw = result.result || {};
  const rawExitCode = raw.exitCode ?? raw.exit_code;
  const exitCode = typeof rawExitCode === 'number' ? rawExitCode : 0;
  const output = String(raw.stdout || raw.output || '');
  const stderr = raw.stderr === undefined ? undefined : String(raw.stderr);
  const success = typeof raw.success === 'boolean' ? raw.success : exitCode === 0;

  return {
    exitCode,
    output,
    stderr,
    success,
  };
};
