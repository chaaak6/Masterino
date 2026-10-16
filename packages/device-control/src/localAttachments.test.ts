import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LocalAttachmentTransfers,
  manageLocalAttachment,
  prepareLocalAttachment,
  prepareLocalAttachmentById,
  receiveLocalAttachment,
  resolveLocalAttachment,
  validatePreparedLocalAttachment,
} from './localAttachments';

describe('chunked device attachments', () => {
  it('removes an unfinished snapshot when publishing its index fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-failed-finish-'));
    const transfers = new LocalAttachmentTransfers(root, 'device');
    try {
      await writeFile(path.join(root, 'attachment-index'), 'index path unavailable');
      const { transferId } = await transfers.begin({
        draftId: 'draft',
        name: 'test.txt',
        mime: 'text/plain',
        size: 3,
      });
      await transfers.append(transferId, 0, Buffer.from('abc'));
      await expect(transfers.finish(transferId)).rejects.toThrow();
      // Renderer cancellation follows a rejected finish call.
      await transfers.cancel(transferId);
      expect(await readdir(path.join(root, 'attachment-drafts', 'draft'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts the 1 GiB boundary, rejects larger files, and removes cancelled bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-boundary-'));
    const transfers = new LocalAttachmentTransfers(root, 'device');
    try {
      await expect(
        transfers.begin({
          draftId: 'draft',
          name: 'too-large.txt',
          mime: 'text/plain',
          size: 1024 ** 3 + 1,
        }),
      ).rejects.toThrow('LOCAL_ATTACHMENT_TOO_LARGE');
      const { transferId } = await transfers.begin({
        draftId: 'draft',
        name: 'boundary.txt',
        mime: 'text/plain',
        size: 1024 ** 3,
      });
      await transfers.append(transferId, 0, Buffer.from('partial'));
      await expect(transfers.finish(transferId)).rejects.toThrow('incomplete');
      await transfers.cancel(transferId);
      expect(await readdir(path.join(root, 'attachment-drafts', 'draft'))).toEqual([]);
      await expect(transfers.append(transferId, 7, Buffer.from('later'))).rejects.toThrow(
        'Invalid attachment chunk',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('binds and prepares a streamed snapshot with its full content hash', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-stream-'));
    const transfers = new LocalAttachmentTransfers(root, 'device');
    const first = Buffer.alloc(1024 ** 2, 'a');
    const last = Buffer.from('PR144_CHUNK_END');
    try {
      const { transferId } = await transfers.begin({
        draftId: 'draft',
        name: 'stream.txt',
        mime: 'text/plain',
        size: first.length + last.length,
      });
      await expect(transfers.append(transferId, 1, first)).rejects.toThrow(
        'Invalid attachment chunk',
      );
      await transfers.append(transferId, 0, first);
      await transfers.append(transferId, first.length, last);
      const ref = await transfers.finish(transferId);
      expect(ref.version).toBe(createHash('sha256').update(first).update(last).digest('hex'));
      expect(JSON.stringify(ref)).not.toContain(root);
      await manageLocalAttachment(root, 'device', {
        action: 'bindMessage',
        ref,
        topicId: 'topic',
        messageId: 'message',
        draftId: 'draft',
      });
      const prepared = await prepareLocalAttachmentById(root, 'device', 'topic', ref.attachmentId);
      expect(await readFile(prepared.path)).toEqual(Buffer.concat([first, last]));
      await expect(
        prepareLocalAttachmentById(root, 'other', 'topic', ref.attachmentId),
      ).rejects.toThrow('ATTACHMENT_NOT_AVAILABLE');
      await expect(
        prepareLocalAttachmentById(root, 'device', 'other', ref.attachmentId),
      ).rejects.toThrow('ATTACHMENT_NOT_AVAILABLE');
      await writeFile(prepared.path, Buffer.alloc(first.length + last.length, 'b'));
      await expect(
        validatePreparedLocalAttachment(root, 'device', 'topic', prepared.path),
      ).rejects.toThrow('Prepared attachment changed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('device attachments', () => {
  it.each([false, true])(
    'cleans failed inline intake without removing the original (native path: %s)',
    async (nativePath) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-failed-inline-'));
      const original = path.join(root, 'original.txt');
      try {
        await writeFile(original, 'original');
        await writeFile(path.join(root, 'attachment-index'), 'index path unavailable');
        await expect(
          receiveLocalAttachment(root, 'device', {
            draftId: 'draft',
            name: 'test.txt',
            mime: 'text/plain',
            originalPath: nativePath ? original : undefined,
            data: Buffer.from('original'),
          }),
        ).rejects.toThrow();
        expect(await readdir(path.join(root, 'attachment-drafts', 'draft'))).toEqual([]);
        expect(await readFile(original, 'utf8')).toBe('original');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('persists device IDs and prepares a copy without granting parent directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-test-'));
    const source = path.join(root, 'original.txt');
    await writeFile(source, 'hello');
    const ref = await receiveLocalAttachment(root, 'device', {
      originalPath: source,
      data: Buffer.from('hello'),
      name: 'original.txt',
      mime: 'text/plain',
      draftId: 'draft',
    });
    expect(JSON.stringify(ref)).not.toContain(root);
    const prepared = await prepareLocalAttachment(root, 'device', ref, 'topic');
    expect(prepared.path).not.toBe(source);
    expect(await readFile(prepared.path, 'utf8')).toBe('hello');
    expect(
      (await validatePreparedLocalAttachment(root, 'device', 'topic', prepared.path)).ref,
    ).toEqual(ref);
    await expect(
      validatePreparedLocalAttachment(root, 'device', 'other-topic', prepared.path),
    ).rejects.toThrow();
    await expect(
      receiveLocalAttachment(root, 'device', {
        originalPath: source,
        data: Buffer.from('wrong'),
        name: 'original.txt',
        mime: 'text/plain',
        draftId: 'draft',
      }),
    ).rejects.toThrow('bytes do not match');
    await expect(resolveLocalAttachment(root, 'other-device', ref)).rejects.toThrow('unavailable');
    await writeFile(source, 'other');
    await expect(resolveLocalAttachment(root, 'device', ref)).rejects.toThrow('changed');
  });
  it('resolves only IDs bound to this device/topic and removes the lookup on deletion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-id-test-'));
    const ref = await receiveLocalAttachment(root, 'device', {
      draftId: 'draft',
      name: 'report.txt',
      mime: 'text/plain',
      data: Buffer.from('content'),
    });
    await expect(
      prepareLocalAttachmentById(root, 'device', 'topic', ref.attachmentId),
    ).rejects.toThrow();
    await manageLocalAttachment(root, 'device', {
      action: 'bindMessage',
      ref,
      messageId: 'message',
      topicId: 'topic',
      draftId: 'draft',
    });
    const prepared = await prepareLocalAttachmentById(root, 'device', 'topic', ref.attachmentId);
    expect(await readFile(prepared.path, 'utf8')).toBe('content');
    await expect(
      prepareLocalAttachmentById(root, 'device', 'other', ref.attachmentId),
    ).rejects.toThrow();
    await expect(
      prepareLocalAttachmentById(root, 'other', 'topic', ref.attachmentId),
    ).rejects.toThrow();
    await expect(prepareLocalAttachmentById(root, 'device', 'topic', '../bad')).rejects.toThrow();
    await manageLocalAttachment(root, 'device', {
      action: 'releaseMessage',
      ref,
      messageId: 'message',
    });
    await expect(
      prepareLocalAttachmentById(root, 'device', 'topic', ref.attachmentId),
    ).rejects.toThrow();
  });
  it('accepts pathless pasted bytes with independent IDs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-test-'));
    const ref = await receiveLocalAttachment(root, 'device', {
      data: new Uint8Array([1, 2, 3]),
      name: 'paste.png',
      mime: 'image/png',
      draftId: 'draft',
    });
    expect(ref.attachmentId).not.toBe(ref.localResourceId);
    expect((await resolveLocalAttachment(root, 'device', ref)).bytes).toEqual(
      Buffer.from([1, 2, 3]),
    );
    await expect(
      resolveLocalAttachment(root, 'device', { ...ref, localResourceId: '../secret' }),
    ).rejects.toThrow('identity');
  });
});

describe('local attachment lifecycle', () => {
  it('cancels a pathless draft by deleting only managed data and index', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-cleanup-'));
    const ref = await receiveLocalAttachment(root, 'device', {
      draftId: 'draft',
      name: 'paste.txt',
      mime: 'text/plain',
      data: Buffer.from('paste'),
    });
    const source = await resolveLocalAttachment(root, 'device', ref);
    expect(
      await manageLocalAttachment(root, 'device', {
        action: 'releaseDraft',
        ref,
        draftId: 'draft',
      }),
    ).toMatchObject({ removed: true });
    await expect(readFile(source.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await manageLocalAttachment(root, 'device', { action: 'status', ref })).toEqual({
      available: false,
    });
  });

  it('preserves originals and other message/draft references until the last release', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-cleanup-'));
    const original = path.join(root, 'original.txt');
    await writeFile(original, 'original');
    const ref = await receiveLocalAttachment(root, 'device', {
      draftId: 'draft',
      name: 'original.txt',
      mime: 'text/plain',
      originalPath: original,
      data: Buffer.from('original'),
    });
    await manageLocalAttachment(root, 'device', {
      action: 'bindMessage',
      ref,
      messageId: 'm1',
      topicId: 'topic1',
      draftId: 'draft',
    });
    await manageLocalAttachment(root, 'device', {
      action: 'bindMessage',
      ref,
      messageId: 'm2',
      topicId: 'topic2',
    });
    const copy = await prepareLocalAttachment(root, 'device', ref, 'topic1');
    await manageLocalAttachment(root, 'device', { action: 'retainDraft', ref, draftId: 'reuse' });
    await manageLocalAttachment(root, 'device', { action: 'releaseMessage', ref, messageId: 'm1' });
    expect((await manageLocalAttachment(root, 'device', { action: 'status', ref })).available).toBe(
      true,
    );
    await manageLocalAttachment(root, 'device', { action: 'releaseMessage', ref, messageId: 'm2' });
    expect((await manageLocalAttachment(root, 'device', { action: 'status', ref })).available).toBe(
      true,
    );
    await manageLocalAttachment(root, 'device', { action: 'releaseDraft', ref, draftId: 'reuse' });
    expect(await readFile(original, 'utf8')).toBe('original');
    await expect(readFile(copy.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes simultaneous message bindings so deleting one never removes the other', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-cleanup-'));
    const ref = await receiveLocalAttachment(root, 'device', {
      draftId: 'draft',
      name: 'x.txt',
      mime: 'text/plain',
      data: Buffer.from('x'),
    });
    await Promise.all(
      ['m1', 'm2'].map((messageId) =>
        manageLocalAttachment(root, 'device', {
          action: 'bindMessage',
          ref,
          messageId,
          topicId: messageId,
          draftId: 'draft',
        }),
      ),
    );
    await manageLocalAttachment(root, 'device', { action: 'releaseMessage', ref, messageId: 'm1' });
    expect((await manageLocalAttachment(root, 'device', { action: 'status', ref })).available).toBe(
      true,
    );
    expect(
      (
        await manageLocalAttachment(root, 'other-device', {
          action: 'releaseMessage',
          ref,
          messageId: 'm2',
        })
      ).available,
    ).toBe(false);
    expect((await manageLocalAttachment(root, 'device', { action: 'status', ref })).available).toBe(
      true,
    );
  });
});
