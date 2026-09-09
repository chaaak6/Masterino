import { z } from 'zod';

const metadata = {
  attachmentId: z.string().min(1),
  name: z.string(),
  mime: z.string(),
  size: z.number().nonnegative(),
  version: z.string().optional(),
};
export const AttachmentRefSchema = z.discriminatedUnion('source', [
  z
    .object({
      ...metadata,
      source: z.literal('local'),
      deviceId: z.string().min(1),
      localResourceId: z.string().min(1),
      version: z.string().min(1),
    })
    .strict(),
  z.object({ ...metadata, source: z.literal('uploaded'), fileId: z.string().min(1) }).strict(),
]);
export const MessageAttachmentsSchema = z
  .object({ schemaVersion: z.literal(1), items: z.array(AttachmentRefSchema).max(100) })
  .strict();
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
export type MessageAttachments = z.infer<typeof MessageAttachmentsSchema>;

/** Cloud-safe descriptions only. Device paths and image data never belong in this envelope. */
export function normalizeMessageAttachments(message: {
  attachments?: MessageAttachments | null;
  fileList?: { id: string; name: string; fileType?: string; size?: number }[];
  imageList?: { id: string; alt?: string }[];
}): AttachmentRef[] {
  const items: AttachmentRef[] = message.attachments
    ? MessageAttachmentsSchema.parse(message.attachments).items
    : [];
  const legacy: AttachmentRef[] = [
    ...(message.fileList ?? []).map((f) => ({
      source: 'uploaded' as const,
      attachmentId: f.id,
      fileId: f.id,
      name: f.name,
      mime: f.fileType ?? 'application/octet-stream',
      size: f.size ?? 0,
    })),
    ...(message.imageList ?? []).map((f) => ({
      source: 'uploaded' as const,
      attachmentId: f.id,
      fileId: f.id,
      name: f.alt ?? '',
      mime: 'image/unknown',
      size: 0,
    })),
  ];
  const seen = new Set<string>();
  return [...items, ...legacy].filter((item) => {
    const key =
      item.source === 'uploaded' ? `uploaded:${item.fileId}` : `local:${item.attachmentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
