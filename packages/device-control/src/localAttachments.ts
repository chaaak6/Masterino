import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureScratchWorkspace } from './workspace';

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export interface LocalAttachmentRecord {
  attachmentId: string;
  deviceId: string;
  localResourceId: string;
  mime: string;
  name: string;
  size: number;
  source: 'local';
  version: string;
}
interface StoredAttachment {
  draftId: string;
  draftIds?: string[];
  lifecycleVersion?: 1;
  messageBindings?: Record<string, string>;
  path: string;
  preparedTopicIds?: string[];
  ref: LocalAttachmentRecord;
  topicId?: string;
  topicIds?: string[];
}
const segment = (id: string) => {
  if (!/^[\w-]{1,128}$/.test(id)) throw new Error('Invalid attachment identity');
  return id;
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const recordPath = (root: string, id: string) =>
  path.join(root, 'attachment-index', `${segment(id)}.json`);

/** Only this device-side index contains paths. A selected source grants no directory access. */
export async function receiveLocalAttachment(
  root: string,
  deviceId: string,
  input: { draftId: string; name: string; mime: string; originalPath?: string; data?: Uint8Array },
): Promise<LocalAttachmentRecord> {
  if (input.data && !(input.data instanceof Uint8Array))
    throw new Error('Invalid attachment bytes');
  if (input.data && input.data.byteLength > MAX_ATTACHMENT_BYTES)
    throw new Error('Attachment exceeds 100 MiB');
  let bytes: Uint8Array;
  let originalPath: string | undefined;
  if (input.originalPath) {
    originalPath = await realpath(input.originalPath);
    const info = await stat(originalPath);
    if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES)
      throw new Error('Attachment is not a supported file or exceeds 100 MiB');
    bytes = await readFile(originalPath);
    if (!input.data || digest(bytes) !== digest(input.data))
      throw new Error('Selected file bytes do not match the original path');
  } else bytes = input.data ?? new Uint8Array();
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds 100 MiB');
  const localResourceId = randomUUID();
  const dir = path.join(root, 'attachment-drafts', segment(input.draftId), localResourceId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = originalPath ?? path.join(dir, path.basename(input.name) || 'attachment');
  if (!originalPath) await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  const ref: LocalAttachmentRecord = {
    source: 'local',
    attachmentId: randomUUID(),
    localResourceId,
    deviceId,
    name: path.basename(input.name),
    mime: input.mime,
    size: bytes.byteLength,
    version: digest(bytes),
  };
  await mkdir(path.join(root, 'attachment-index'), { recursive: true, mode: 0o700 });
  await writeFile(
    recordPath(root, localResourceId),
    JSON.stringify({
      ref,
      path: await realpath(filePath),
      draftId: input.draftId,
      lifecycleVersion: 1,
      draftIds: [input.draftId],
      messageBindings: {},
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return ref;
}

export async function resolveLocalAttachment(
  root: string,
  deviceId: string,
  ref: LocalAttachmentRecord,
) {
  if (ref.deviceId !== deviceId)
    throw new Error('Attachment is unavailable on this device; select it again');
  const record: StoredAttachment = JSON.parse(
    await readFile(recordPath(root, ref.localResourceId), 'utf8'),
  );
  if (
    record.ref.attachmentId !== ref.attachmentId ||
    record.ref.version !== ref.version ||
    record.ref.deviceId !== deviceId ||
    record.ref.mime !== ref.mime ||
    record.ref.name !== ref.name ||
    record.ref.size !== ref.size
  )
    throw new Error('Attachment identity mismatch');
  const actual = await realpath(record.path);
  if (actual !== record.path) throw new Error('Attachment path changed; select it again');
  const info = await stat(actual);
  if (!info.isFile() || info.size !== ref.size || info.size > MAX_ATTACHMENT_BYTES)
    throw new Error('Attachment changed; select it again');
  const bytes = await readFile(actual);
  if (digest(bytes) !== ref.version) throw new Error('Attachment changed; select it again');
  return { bytes, path: actual, ref: record.ref };
}

/** Scripts and Office receive a managed copy, never broader access to a selected source. */
export async function prepareLocalAttachment(
  root: string,
  deviceId: string,
  ref: LocalAttachmentRecord,
  topicId: string,
) {
  if (ref.deviceId !== deviceId) throw new Error('Attachment is unavailable on this device');
  const workspace = await ensureScratchWorkspace(topicId, root);
  const dir = path.join(workspace.root, '.attachments', segment(ref.localResourceId));
  const target = path.join(dir, path.basename(ref.name) || 'attachment');
  try {
    const prepared = await validatePreparedLocalAttachment(root, deviceId, topicId, target);
    if (prepared.ref.attachmentId === ref.attachmentId && prepared.ref.version === ref.version)
      return prepared;
  } catch {
    /* First preparation, or a modified managed copy: restore the selected version. */
  }
  const source = await resolveLocalAttachment(root, deviceId, ref);
  await bindLocalAttachment(root, deviceId, ref, topicId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, source.bytes, { mode: 0o600, flag: 'wx' });
  await rename(temporary, target);
  return { path: target, ref };
}

export async function bindLocalAttachment(
  root: string,
  deviceId: string,
  ref: LocalAttachmentRecord,
  topicId: string,
) {
  await resolveLocalAttachment(root, deviceId, ref);
  const filename = recordPath(root, ref.localResourceId);
  return serializeAttachmentMutation(filename, async () => {
    const record: StoredAttachment = JSON.parse(await readFile(filename, 'utf8'));
    const temporary = `${filename}.${randomUUID()}.tmp`;
    const topicIds = [
      ...new Set([
        ...(record.topicIds ?? []),
        ...(record.topicId ? [record.topicId] : []),
        segment(topicId),
      ]),
    ];
    await writeFile(
      temporary,
      JSON.stringify({
        ...record,
        topicIds,
        preparedTopicIds: [...new Set([...(record.preparedTopicIds ?? []), topicId])],
      }),
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, filename);
  });
}

/** Main-process guard for a tool requesting a previously prepared exact file. */
export async function validatePreparedLocalAttachment(
  root: string,
  deviceId: string,
  topicId: string,
  requestedPath: string,
) {
  const actual = await realpath(requestedPath);
  const workspace = await ensureScratchWorkspace(topicId, root);
  const relative = path.relative(path.join(workspace.root, '.attachments'), actual).split(path.sep);
  if (relative.length !== 2 || relative[0] === '..') throw new Error('Not a prepared attachment');
  const record: StoredAttachment = JSON.parse(
    await readFile(recordPath(root, relative[0]), 'utf8'),
  );
  if (
    !(record.topicIds ?? [record.topicId]).includes(topicId) ||
    record.ref.deviceId !== deviceId ||
    path.basename(record.ref.name) !== relative[1]
  )
    throw new Error('Attachment is not bound to this topic/device');
  const info = await stat(actual);
  if (!info.isFile() || info.size !== record.ref.size || info.size > MAX_ATTACHMENT_BYTES)
    throw new Error('Prepared attachment changed');
  if (digest(await readFile(actual)) !== record.ref.version)
    throw new Error('Prepared attachment changed');
  return { path: actual, ref: record.ref };
}

export type LocalAttachmentLifecycleInput =
  | { action: 'retainDraft' | 'releaseDraft'; ref: LocalAttachmentRecord; draftId: string }
  | {
      action: 'bindMessage';
      ref: LocalAttachmentRecord;
      messageId: string;
      topicId: string;
      draftId?: string;
    }
  | { action: 'releaseMessage'; ref: LocalAttachmentRecord; messageId: string }
  | { action: 'status'; ref: LocalAttachmentRecord };

const attachmentMutations = new Map<string, Promise<unknown>>();
async function serializeAttachmentMutation<T>(
  filename: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = attachmentMutations.get(filename) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(operation);
  attachmentMutations.set(filename, task);
  try {
    return await task;
  } finally {
    if (attachmentMutations.get(filename) === task) attachmentMutations.delete(filename);
  }
}

/** Only metadata/stat for status; image/file bytes are loaded after an explicit user action. */
export async function manageLocalAttachment(
  root: string,
  deviceId: string,
  input: LocalAttachmentLifecycleInput,
): Promise<{ available: boolean; removed?: boolean }> {
  const { ref } = input;
  if (deviceId !== ref.deviceId) return { available: false };
  const filename = recordPath(root, ref.localResourceId);
  const perform = async () => {
    let record: StoredAttachment;
    try {
      record = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false };
      throw error;
    }
    if (
      record.ref.attachmentId !== ref.attachmentId ||
      record.ref.version !== ref.version ||
      record.ref.deviceId !== deviceId
    )
      return { available: false };
    if (input.action === 'status') {
      try {
        const actual = await realpath(record.path);
        const info = await stat(actual);
        return {
          available: actual === record.path && info.isFile() && info.size === record.ref.size,
        };
      } catch {
        return { available: false };
      }
    }
    // Pre-lifecycle records can be reused, but unknown older references must never be deleted.
    const canCollect = record.lifecycleVersion === 1;
    const drafts = new Set(record.draftIds ?? []);
    const bindings = { ...record.messageBindings };
    if (input.action === 'retainDraft') drafts.add(segment(input.draftId));
    else if (input.action === 'releaseDraft') drafts.delete(segment(input.draftId));
    else if (input.action === 'bindMessage') {
      bindings[segment(input.messageId)] = segment(input.topicId);
      if (input.draftId) drafts.delete(segment(input.draftId));
    } else if (input.action === 'releaseMessage') delete bindings[segment(input.messageId)];
    const topicIds = canCollect ? [...new Set(Object.values(bindings))] : record.topicIds;
    if (canCollect && drafts.size === 0 && Object.keys(bindings).length === 0) {
      // Never delete record.path: it can be an original selected from outside app storage.
      await rm(
        path.join(root, 'attachment-drafts', segment(record.draftId), segment(ref.localResourceId)),
        { recursive: true, force: true },
      );
      for (const topic of new Set([
        ...(record.preparedTopicIds ?? []),
        ...(record.topicIds ?? []),
      ])) {
        const workspace = await ensureScratchWorkspace(topic, root);
        await rm(path.join(workspace.root, '.attachments', segment(ref.localResourceId)), {
          recursive: true,
          force: true,
        });
      }
      await rm(filename, { force: true });
      return { available: false, removed: true };
    }
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({ ...record, draftIds: [...drafts], messageBindings: bindings, topicIds }),
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, filename);
    return { available: true };
  };
  return serializeAttachmentMutation(filename, perform);
}
