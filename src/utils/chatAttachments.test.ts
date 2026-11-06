import { describe, expect, it } from 'vitest';

import { type UploadFileItem } from '@/types/files/upload';

import {
  CHAT_IMAGE_LIMIT,
  chatImageCount,
  classifyChatAttachmentError,
  getChatAttachmentBlock,
  isChatImage,
  WEB_CHAT_FILE_MAX_BYTES,
} from './chatAttachments';

const image = (status: UploadFileItem['status'] = 'success'): UploadFileItem => ({
  id: crypto.randomUUID(),
  file: new File(['x'], 'test.png', { type: 'image/png' }),
  status,
});
describe('chat attachment policy', () => {
  it('counts all visible images including failed items until explicitly removed', () => {
    expect(isChatImage(new File([], 'SCREENSHOT.PNG'))).toBe(true);
    expect(chatImageCount([image('pending'), image('error'), image()])).toBe(3);
    expect(
      getChatAttachmentBlock(Array.from({ length: CHAT_IMAGE_LIMIT + 1 }, () => image())),
    ).toBe('image-count');
  });
  it('keeps rejection and failure blocking distinct from progress', () => {
    expect(getChatAttachmentBlock([image('pending')])).toBe('pending');
    expect(getChatAttachmentBlock([image('error')])).toBe('failed');
    expect(getChatAttachmentBlock([image()])).toBeUndefined();
    expect(
      getChatAttachmentBlock(
        [],
        [{ id: 'rejected', name: 'file.txt', size: 1, reason: 'web-size', web: true }],
      ),
    ).toBe('failed');
  });
  it('classifies truncation only with the matching upload failure and oversized body', () => {
    const error = {
      status: 400,
      message: 'Upload is incomplete or its checksum does not match. Please retry.',
    };
    expect(
      classifyChatAttachmentError(error, { size: WEB_CHAT_FILE_MAX_BYTES + 1, web: true }),
    ).toBe('web-size');
    for (const size of [10_000_000, WEB_CHAT_FILE_MAX_BYTES - 1, WEB_CHAT_FILE_MAX_BYTES])
      expect(classifyChatAttachmentError(error, { size, web: true })).toBe('incomplete-upload');
    expect(
      classifyChatAttachmentError(
        { status: 400, message: 'Other error' },
        { size: WEB_CHAT_FILE_MAX_BYTES + 1, web: true },
      ),
    ).toBe('upload-failed');
    expect(
      classifyChatAttachmentError(error, { size: WEB_CHAT_FILE_MAX_BYTES + 1, web: false }),
    ).toBe('incomplete-upload');
  });
  it('limits download guidance to explicit web capability failures', () => {
    expect(classifyChatAttachmentError({ status: 413 }, { size: 1, web: true })).toBe('web-size');
    expect(
      classifyChatAttachmentError(new Error("Unsupported file type 'xlsm'"), {
        size: 1,
        web: true,
        parsing: true,
      }),
    ).toBe('unsupported-format');
    expect(classifyChatAttachmentError({ status: 401 }, { size: 1, web: true })).toBe(
      'unauthorized',
    );
    expect(classifyChatAttachmentError({ status: 403 }, { size: 1, web: true })).toBe(
      'permission-denied',
    );
    for (const status of [500])
      expect(classifyChatAttachmentError({ status }, { size: 1, web: true })).toBe('upload-failed');
    expect(
      classifyChatAttachmentError(new Error('unknown'), { size: 1, web: true, parsing: true }),
    ).toBe('parse-failed');
  });
});
