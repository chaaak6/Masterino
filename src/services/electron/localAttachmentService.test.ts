import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { resolveLocalMessageAttachments } from './localAttachmentService';

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

  it('prepares document history serially to bound concurrent device reads', async () => {
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
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
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
