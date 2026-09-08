import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareLocalAttachment,
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
