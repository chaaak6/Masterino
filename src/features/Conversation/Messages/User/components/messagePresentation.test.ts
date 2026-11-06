import { describe, expect, it } from 'vitest';

import { getMessageAttachmentItems, hasUserMessageBody } from './messagePresentation';

describe('message attachment presentation compatibility', () => {
  it('shows a legacy image listed as an untyped file once, with image behavior', () => {
    const file = { id: 'image', name: 'old.png' };
    const items = getMessageAttachmentItems({ fileList: [file], imageList: [{ id: 'image' }] });
    expect(items).toEqual([
      expect.objectContaining({
        source: 'uploaded',
        fileId: 'image',
        mime: 'image/unknown',
        name: 'old.png',
      }),
    ]);
    expect(file).toEqual({ id: 'image', name: 'old.png' });
  });
  it('keeps canonical mixed attachment order and identity while deduplicating legacy metadata', () => {
    const local = {
      source: 'local' as const,
      attachmentId: 'local',
      localResourceId: 'r',
      deviceId: 'device',
      version: 'version',
      name: 'photo.png',
      mime: 'image/png',
      size: 20,
    };
    const cloud = {
      source: 'uploaded' as const,
      attachmentId: 'cloud',
      fileId: 'file',
      name: 'report.txt',
      mime: 'text/plain',
      size: 10,
    };
    expect(
      getMessageAttachmentItems({
        attachments: { schemaVersion: 1, items: [local, cloud] },
        fileList: [{ id: 'file', name: 'report.txt' }],
      }),
    ).toEqual([local, cloud]);
  });
  it('omits the text bubble for attachment-only messages with an empty serialized editor', () => {
    expect(
      hasUserMessageBody({
        content: '',
        editorData: { root: { type: 'root', children: [{ type: 'paragraph', children: [] }] } },
      }),
    ).toBe(false);
    expect(hasUserMessageBody({ content: 'Caption' })).toBe(true);
  });
  it('preserves meaningful rich-only content and auxiliary message surfaces', () => {
    expect(
      hasUserMessageBody({
        content: '',
        editorData: { root: { type: 'root', children: [{ type: 'image' }] } },
      }),
    ).toBe(true);
    expect(
      hasUserMessageBody({ content: '', extra: { translate: { content: 'Translation' } } as any }),
    ).toBe(true);
  });
});
