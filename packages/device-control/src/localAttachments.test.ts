import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  manageLocalAttachment,
  prepareLocalAttachment,
  prepareLocalAttachmentById,
  receiveLocalAttachment,
  resolveLocalAttachment,
  validatePreparedLocalAttachment,
} from './localAttachments';

describe('device attachments', () => {
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
