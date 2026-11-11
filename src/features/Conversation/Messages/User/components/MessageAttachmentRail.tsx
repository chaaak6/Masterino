import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AttachmentRail from '@/features/Attachments/AttachmentRail';
import MessageFileCard from '@/features/Attachments/MessageFileCard';
import { useChatStore } from '@/store/chat';
import { type UIChatMessage } from '@/types/index';
import { isLocalChatAttachmentImage } from '@/utils/chatAttachments';

import LocalAttachmentItem from './LocalAttachmentItem';
import MessageImageGallery from './MessageImageGallery';
import { getMessageAttachmentItems } from './messagePresentation';

export default memo<UIChatMessage>(({ attachments, fileList, imageList, id, topicId }) => {
  const { t } = useTranslation('chat');
  const open = useChatStore((s) => s.openFilePreview);
  const items = useMemo(
    () => getMessageAttachmentItems({ attachments, fileList, imageList }),
    [attachments, fileList, imageList],
  );
  if (!items.length) return null;
  const isImage = (ref: (typeof items)[number]) =>
    ref.source === 'local' ? isLocalChatAttachmentImage(ref) : ref.mime.startsWith('image/');
  const images = items.filter(isImage);
  return (
    <MessageImageGallery
      messageId={id}
      topicId={topicId}
      items={images.map((ref, index) => ({
        ...ref,
        name: ref.name || t('attachments.imageName', { index: index + 1 }),
      }))}
      renderThumbnails={(thumbnails) => {
        let imageIndex = 0;
        return (
          <AttachmentRail>
            {items.map((ref) => {
              if (isImage(ref)) return thumbnails[imageIndex++];
              if (ref.source === 'local')
                return (
                  <LocalAttachmentItem
                    compact
                    attachment={ref}
                    key={`local:${ref.attachmentId}`}
                    messageId={id}
                    topicId={topicId}
                  />
                );
              return (
                <MessageFileCard
                  key={`uploaded:${ref.fileId}`}
                  mime={ref.mime}
                  name={ref.name}
                  size={ref.size}
                  onPreview={() => open({ fileId: ref.fileId })}
                />
              );
            })}
          </AttachmentRail>
        );
      }}
      uploadedImages={[
        ...(imageList || []),
        ...(fileList || []).map((file) => ({ id: file.id, url: file.url, alt: file.name })),
      ]}
    />
  );
});
