import { type UIChatMessage } from '@lobechat/types';
import { createInstance } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import enChat from '../../../locales/en-US/chat.json';
import zhChat from '../../../locales/zh-CN/chat.json';
import defaultChat from '../../../packages/locales/src/default/chat';
import {
  getLocalAttachmentErrorKey,
  receiveLocalChatAttachment,
  resolveLocalMessageAttachments,
} from './localAttachmentService';

const localImage = {
  attachmentId: 'a',
  localResourceId: 'r',
  source: 'local' as const,
  deviceId: 'd',
  name: 'image.png',
  mime: 'image/png',
  size: 3,
  version: 'v',
};
describe('local attachment model context', () => {
  it('keeps only selected current images and never mutates persisted descriptors', async () => {
    const invoke = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,AQID' });
    window.electronAPI = { invoke, onStreamInvoke: vi.fn() };
    const messages = [
      {
        id: 'old',
        role: 'user',
        content: 'old',
        imageList: [{ id: 'old-image', alt: 'old.png', url: 'https://storage/old.png' }],
      },
      {
        id: 'current',
        role: 'user',
        content: 'look',
        attachments: { schemaVersion: 1, items: [localImage] },
      },
    ] as UIChatMessage[];
    const result = await resolveLocalMessageAttachments(messages, 'topic');
    expect(result[0].imageList).toEqual([]);
    expect(result[0].content).toContain('old-image');
    expect(result[1].imageList?.[0].url).toBe('data:image/png;base64,AQID');
    expect(messages[1].imageList).toBeUndefined();
    expect(JSON.stringify(messages)).not.toContain('base64');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('keeps attachment hashes internal and explains the first Office version argument', async () => {
    const ref = {
      ...localImage,
      mime: 'application/xlsx',
      name: 'report.xlsx',
      version: 'a'.repeat(64),
    };
    const invoke = vi.fn().mockResolvedValue({ path: '/managed/report.xlsx' });
    window.electronAPI = { invoke, onStreamInvoke: vi.fn() };
    const messages = [
      { role: 'user', content: 'Inspect report', attachments: { schemaVersion: 1, items: [ref] } },
    ] as UIChatMessage[];
    const [result] = await resolveLocalMessageAttachments(messages, 'topic');
    expect(result.content).not.toContain(ref.version);
    expect(result.content).not.toContain('"version":');
    expect(result.content).toContain('Omit version on the first Office call');
    expect(result.content).toContain('only copy version returned by an Office tool');
    expect(ref.version).toBe('a'.repeat(64));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.content).toContain(ref.attachmentId);
    expect(result.content).not.toContain('/managed/');
    expect(result.content).not.toContain('\"path\":');
  });

  it('rejects excess selected images before reading any image bytes', async () => {
    const invoke = vi.fn();
    window.electronAPI = { invoke, onStreamInvoke: vi.fn() };
    await expect(
      resolveLocalMessageAttachments([
        {
          id: 'x',
          role: 'user',
          content: '',
          attachments: {
            schemaVersion: 1,
            items: Array.from({ length: 11 }, (_, index) => ({
              ...localImage,
              attachmentId: String(index),
              localResourceId: String(index),
            })),
          },
        },
      ] as UIChatMessage[]),
    ).rejects.toThrow('at most 10');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps document history as IDs without reading files during assembly', async () => {
    let active = 0;
    let peak = 0;
    const invoke = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { path: '/managed/report.xlsx' };
    });
    window.electronAPI = { invoke: invoke as any, onStreamInvoke: vi.fn() };
    const messages = Array.from({ length: 3 }, (_, index) => ({
      id: String(index),
      role: 'user',
      content: '',
      attachments: {
        schemaVersion: 1,
        items: [{ ...localImage, mime: 'application/xlsx', name: 'report.xlsx' }],
      },
    })) as UIChatMessage[];
    await resolveLocalMessageAttachments(messages, 'topic');
    expect(invoke).not.toHaveBeenCalled();
    expect(peak).toBe(0);
  });

  it('fails explicitly on a missing device resource', async () => {
    window.electronAPI = {
      invoke: vi.fn().mockRejectedValue(new Error('unavailable on this device')),
      onStreamInvoke: vi.fn(),
    };
    await expect(
      resolveLocalMessageAttachments([
        {
          id: 'x',
          role: 'user',
          content: '',
          attachments: { schemaVersion: 1, items: [localImage] },
        },
      ] as UIChatMessage[]),
    ).rejects.toThrow('unavailable');
  });
});

describe('local attachment intake error codes', () => {
  it.each([
    ['LOCAL_ATTACHMENT_TOO_LARGE', 'fileTooLarge'],
    ['LOCAL_IMAGE_TOO_LARGE', 'imageTooLarge'],
    ['LOCAL_IMAGE_RESOLUTION_EXCEEDED', 'imageResolutionExceeded'],
    ['LOCAL_IMAGE_INVALID', 'invalidImage'],
  ])('maps %s through Electron error envelopes', (code, key) => {
    expect(
      getLocalAttachmentErrorKey(new Error(`Error invoking remote method: Error: ${code}`)),
    ).toBe(`localAttachment.errors.${key}`);
  });

  it.each([
    ['application/pdf', 100 * 1024 * 1024 + 1, 'LOCAL_ATTACHMENT_TOO_LARGE'],
    ['image/png', 10 * 1024 * 1024 + 1, 'LOCAL_IMAGE_TOO_LARGE'],
  ])('rejects oversized %s before reading file bytes', async (type, size, code) => {
    const file = new File([], 'large', { type });
    Object.defineProperty(file, 'size', { value: size });
    await expect(receiveLocalChatAttachment(file, 'draft')).rejects.toThrow(code);
  });

  it('closes rejected image bitmaps and returns a translatable resolution code', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 8193, height: 1, close }),
    );
    try {
      await expect(
        receiveLocalChatAttachment(new File([], 'wide.png', { type: 'image/png' }), 'draft'),
      ).rejects.toThrow('LOCAL_IMAGE_RESOLUTION_EXCEEDED');
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('resolves local attachment labels and errors using the application flat-key configuration', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { chat: enChat }, 'zh-CN': { chat: zhChat } },
  });
  const key = getLocalAttachmentErrorKey(new Error('LOCAL_IMAGE_TOO_LARGE'))!;
  expect(defaultChat[key]).toBe(enChat[key]);
  expect(i18n.t(key, { ns: 'chat' })).toBe('Image exceeds 10 MiB. Resize it before sending.');
  expect(i18n.t('localAttachment.preview', { ns: 'chat' })).toBe('Preview');
  await i18n.changeLanguage('zh-CN');
  expect(i18n.t(key, { ns: 'chat' })).toBe('图片超过 10 MiB，请缩小后再发送。');
  expect(i18n.t('localAttachment.preview', { ns: 'chat' })).not.toBe('localAttachment.preview');
});
