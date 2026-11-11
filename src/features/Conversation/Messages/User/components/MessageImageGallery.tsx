import { type AttachmentRef } from '@lobechat/types';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import ImageGallery from '@/features/Attachments/ImageGallery';
import { warnUnsupportedVisualUpload } from '@/features/ChatInput/ActionBar/visualUploadGuard';
import { useVisualMediaUploadAbility } from '@/hooks/useVisualMediaUploadAbility';
import {
  copyLocalAttachmentImage,
  localAttachmentStatus,
  previewLocalAttachment,
  revealLocalAttachmentImage,
} from '@/services/electron/localAttachmentService';
import { fileService } from '@/services/file';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useElectronStore } from '@/store/electron';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../../../store';

export default memo(
  ({
    items,
    messageId,
    topicId,
    uploadedImages,
    renderThumbnails,
  }: {
    items: AttachmentRef[];
    uploadedImages: { id: string; url: string; alt?: string }[];
    messageId: string;
    topicId?: string | null;
    renderThumbnails?: (thumbnails: ReactNode[]) => ReactNode;
  }) => {
    const { t } = useTranslation('chat');
    const context = useConversationStore((s) => s.context);
    const agentId = context.agentId;
    const [model, provider] = useAgentStore((s) => [
      agentByIdSelectors.getAgentModelById(agentId)(s),
      agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    ]);
    const ability = useVisualMediaUploadAbility(model, provider);
    const add = useFileStore((s) => s.addLocalAttachmentToInput);
    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    return (
      <ImageGallery
        renderThumbnails={renderThumbnails}
        items={items.map((ref, index) => {
          if (ref.source === 'uploaded')
            return {
              id: `uploaded:${ref.fileId}`,
              name: ref.name || t('attachments.imageName', { index: index + 1 }),
              url: uploadedImages.find((item) => item.id === ref.fileId)?.url,
              load: async () => {
                const file = await fileService.getFile(ref.fileId);
                if (!file.url) throw new Error('Preview unavailable');
                return file.url;
              },
            };
          const canUseLocalImage =
            currentDeviceId === ref.deviceId &&
            typeof window !== 'undefined' &&
            !!window.electronAPI?.invoke;
          return {
            id: ref.attachmentId,
            local: true,
            name: ref.name,
            onCopy: canUseLocalImage ? () => copyLocalAttachmentImage(ref) : undefined,
            onReveal: canUseLocalImage ? () => revealLocalAttachmentImage(ref) : undefined,
            load: async () => {
              if (!(await localAttachmentStatus(ref))) throw new Error('Attachment unavailable');
              const result = await previewLocalAttachment(ref, topicId || 'active');
              if (!result.dataUrl) throw new Error('Preview unavailable');
              return result.dataUrl;
            },
            onAdd: async () => {
              if (
                warnUnsupportedVisualUpload(
                  { name: ref.name, type: ref.mime },
                  {
                    ...ability,
                    warning: (content) => message.warning(content),
                    warningText: t('upload.clientMode.visionNotSupported'),
                  },
                )
              )
                return false;
              return add(ref, messageId, topicId || 'active', undefined, messageMapKey(context));
            },
          };
        })}
      />
    );
  },
);
