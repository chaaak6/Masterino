import { type AttachmentRef } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import ImageGallery from '@/features/Attachments/ImageGallery';
import { warnUnsupportedVisualUpload } from '@/features/ChatInput/ActionBar/visualUploadGuard';
import { useVisualMediaUploadAbility } from '@/hooks/useVisualMediaUploadAbility';
import {
  localAttachmentStatus,
  previewLocalAttachment,
} from '@/services/electron/localAttachmentService';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../../../store';

export default memo(
  ({
    items,
    messageId,
    topicId,
    uploadedImages,
  }: {
    items: AttachmentRef[];
    uploadedImages: { id: string; url: string; alt?: string }[];
    messageId: string;
    topicId?: string | null;
  }) => {
    const { t } = useTranslation('chat');
    const agentId = useConversationStore((s) => s.context.agentId);
    const [model, provider] = useAgentStore((s) => [
      agentByIdSelectors.getAgentModelById(agentId)(s),
      agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    ]);
    const ability = useVisualMediaUploadAbility(model, provider);
    const add = useFileStore((s) => s.addLocalAttachmentToInput);
    return (
      <ImageGallery
        items={items.map((ref) => {
          if (ref.source === 'uploaded')
            return {
              id: `uploaded:${ref.fileId}`,
              name: ref.name || 'Image',
              url: uploadedImages.find((item) => item.id === ref.fileId)?.url,
            };
          return {
            id: ref.attachmentId,
            name: ref.name,
            load: async () => {
              if (!(await localAttachmentStatus(ref))) throw new Error('Attachment unavailable');
              const result = await previewLocalAttachment(ref, topicId || 'active');
              if (!result.dataUrl) throw new Error('Preview unavailable');
              return result.dataUrl;
            },
            onAdd: async () => {
              if (
                warnUnsupportedVisualUpload(
                  { type: ref.mime },
                  {
                    ...ability,
                    warning: (content) => message.warning(content),
                    warningText: t('upload.clientMode.visionNotSupported'),
                  },
                )
              )
                return false;
              return add(ref, messageId, topicId || 'active');
            },
          };
        })}
      />
    );
  },
);
