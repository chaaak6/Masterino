import { describe, expect, it } from 'vitest';

import { MessageAttachmentsSchema, normalizeMessageAttachments } from './attachments';

describe('message attachments', () => {
  it('coexists with legacy relations without duplicates or local fake file IDs', () => {
    const local = {
      source: 'local' as const,
      attachmentId: 'attachment',
      localResourceId: 'resource',
      deviceId: 'device',
      name: 'report.xlsx',
      mime: 'application/xlsx',
      size: 20,
      version: 'hash',
    };
    const items = normalizeMessageAttachments({
      attachments: { schemaVersion: 1, items: [local] },
      fileList: [{ id: 'file', name: 'image.png' }],
      imageList: [{ id: 'file' }],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveProperty('fileId');
  });
  it('counts untyped legacy images consistently after deduplication', () => {
    const imageList = Array.from({ length: 12 }, (_, i) => ({ id: `image-${i}` }));
    const refs = normalizeMessageAttachments({
      imageList,
      fileList: imageList.map((i) => ({
        ...i,
        name: 'legacy',
        fileType: 'application/octet-stream',
      })),
    });
    expect(refs).toHaveLength(12);
    expect(refs.filter((ref) => ref.mime.startsWith('image/'))).toHaveLength(12);
  });

  it('rejects absolute paths and base64 fields in persisted metadata', () => {
    expect(() =>
      MessageAttachmentsSchema.parse({
        schemaVersion: 1,
        items: [
          {
            source: 'local',
            attachmentId: 'a',
            deviceId: 'd',
            localResourceId: 'r',
            name: 'x',
            mime: 'image/png',
            size: 1,
            version: 'v',
            path: '/secret',
          },
        ],
      }),
    ).toThrow();
  });
});
