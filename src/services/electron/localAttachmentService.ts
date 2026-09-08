import {
  type AttachmentRef,
  normalizeMessageAttachments,
  type UIChatMessage,
} from '@lobechat/types';

type LocalRef = Extract<AttachmentRef, { source: 'local' }>;
const invoke = async <T>(method: string, input: unknown): Promise<T> => {
  if (!window.electronAPI?.invoke)
    throw new Error('Attachment is unavailable on this device; select it again');
  return window.electronAPI.invoke<T>(`localSystem.${method}`, input);
};
export const receiveLocalChatAttachment = async (file: File, draftId: string) => {
  if (file.size > 100 * 1024 * 1024) throw new Error('Attachment exceeds 100 MiB');
  // Capture BEFORE compression/Blob conversion, which would discard Electron's native path.
  const originalPath = window.electronAPI?.getPathForFile?.(file);
  if (file.type.startsWith('image/')) {
    if (file.size > 10 * 1024 * 1024)
      throw new Error('Image exceeds 10 MiB; resize it before sending');
    const bitmap = await createImageBitmap(file);
    const tooLarge =
      bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 40_000_000;
    bitmap.close();
    if (tooLarge)
      throw new Error('Image exceeds 8192 pixels or 40 megapixels; resize it before sending');
  }
  return invoke<LocalRef>('receiveAttachment', {
    draftId,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    originalPath,
    data: new Uint8Array(await file.arrayBuffer()),
  });
};
export const bindLocalChatAttachments = async (refs: AttachmentRef[], topicId: string) => {
  await Promise.all(
    refs
      .filter((ref): ref is LocalRef => ref.source === 'local')
      .map((ref) => invoke('bindAttachment', { ref, topicId })),
  );
};

/** Resolve only at request time. Neither real paths nor data URLs are written back to messages. */
export const resolveLocalMessageAttachments = async (
  messages: UIChatMessage[],
  topicId?: string,
): Promise<UIChatMessage[]> => {
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const resolvedMessages: UIChatMessage[] = [];
  for (const [index, message] of messages.entries()) {
    const resolveMessage = async (): Promise<UIChatMessage> => {
      const refs = normalizeMessageAttachments(message).filter(
        (ref): ref is LocalRef => ref.source === 'local',
      );
      if (!refs.length) {
        if (index < latestUserIndex && message.imageList?.length)
          return {
            ...message,
            imageList: [],
            content: `${message.content}\n${message.imageList.map((image) => `[Historical image ${image.id}: ${image.alt}; image data not included]`).join('\n')}`,
          };
        if (message.imageList && message.imageList.length > 10)
          throw new Error('Select at most 10 images per request');
        return message;
      }
      const localIds = new Set(refs.map((ref) => ref.attachmentId));
      if (
        index >= latestUserIndex &&
        refs.filter((ref) => ref.mime.startsWith('image/')).length +
          (message.imageList ?? []).filter((image) => !localIds.has(image.id)).length >
          10
      ) {
        throw new Error('Select at most 10 images per request');
      }
      const imageList =
        index >= latestUserIndex
          ? (message.imageList ?? []).filter((image) => !localIds.has(image.id))
          : [];
      const manifest: string[] = [];
      for (const ref of refs) {
        if (ref.mime.startsWith('image/')) {
          if (index < latestUserIndex) {
            manifest.push(
              `${ref.name} [attachment ${ref.attachmentId}; historical image not included]`,
            );
            continue;
          }
          const result = await invoke<{ dataUrl: string }>('resolveAttachment', {
            ref,
            image: true,
          });
          imageList.push({ id: ref.attachmentId, alt: ref.name, url: result.dataUrl });
        } else {
          const result = await invoke<{ path: string }>('resolveAttachment', { ref, topicId });
          manifest.push(
            JSON.stringify({
              attachmentId: ref.attachmentId,
              name: ref.name,
              mime: ref.mime,
              size: ref.size,
              path: result.path,
              version: ref.version,
            }),
          );
        }
      }
      if (imageList.length > 10) throw new Error('Select at most 10 images per request');
      return {
        ...message,
        imageList,
        content: [
          message.content,
          manifest.length
            ? `<local_attachments>\n${manifest.join('\n')}\nUse inspectOfficeDocument/readOfficeDocument for bounded reading. These are managed copies.\n</local_attachments>`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
    };
    // Each IPC may read a large file; do not allocate all historical attachments concurrently.
    resolvedMessages.push(await resolveMessage());
  }
  return resolvedMessages;
};
