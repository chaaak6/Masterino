import { type AttachmentRef } from '@lobechat/types';
import { Block, Button, Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import FileIcon from '@/components/FileIcon';
import MessageFileCard from '@/features/Attachments/MessageFileCard';
import { warnUnsupportedVisualUpload } from '@/features/ChatInput/ActionBar/visualUploadGuard';
import { useVisualMediaUploadAbility } from '@/hooks/useVisualMediaUploadAbility';
import {
  localAttachmentStatus,
  previewLocalAttachment,
} from '@/services/electron/localAttachmentService';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';
import { logChatAttachment } from '@/utils/chatAttachments';
import { formatSize } from '@/utils/format';

import { useConversationStore } from '../../../store';
import ImageFileListViewer from './ImageFileListViewer';

type LocalRef = Extract<AttachmentRef, { source: 'local' }>;
const LocalAttachmentItem = memo<{
  attachment: LocalRef;
  compact?: boolean;
  messageId: string;
  topicId?: string | null;
}>(({ attachment, compact, messageId, topicId }) => {
  const { t } = useTranslation('chat');
  const context = useConversationStore((s) => s.context);
  const agentId = context.agentId;
  const [model, provider] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  ]);
  const ability = useVisualMediaUploadAbility(model, provider);
  const addToInput = useFileStore((s) => s.addLocalAttachmentToInput);
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const [available, setAvailable] = useState<boolean>();
  const [pending, setPending] = useState<'preview' | 'add'>();
  const [preview, setPreview] = useState<string>();
  const [added, setAdded] = useState(false);
  useEffect(() => {
    let active = true;
    setAvailable(undefined);
    setPreview(undefined);
    setAdded(false);
    void localAttachmentStatus(attachment).then(
      (value) => {
        if (active) setAvailable(value);
      },
      () => {
        if (active) setAvailable(false);
      },
    );
    return () => {
      active = false;
    };
  }, [attachment]);

  const run = async (action: 'preview' | 'add') => {
    if (
      action === 'add' &&
      attachment.mime.startsWith('image/') &&
      warnUnsupportedVisualUpload(
        { type: attachment.mime },
        {
          ...ability,
          warning: (content) => message.warning(content),
          warningText: t('upload.clientMode.visionNotSupported'),
        },
      )
    )
      return;
    setPending(action);
    logChatAttachment('message-file-action', { id: attachment.attachmentId, reason: action });
    try {
      if (action === 'add') {
        setAdded(
          await addToInput(
            attachment,
            messageId,
            topicId ?? 'active',
            preview,
            messageMapKey(context),
          ),
        );
      } else {
        const result = await previewLocalAttachment(attachment, topicId ?? 'active');
        if (result.dataUrl) setPreview(result.dataUrl);
        else if (result.path)
          openLocalFile({
            filePath: result.path,
            // IPC above validated that this reference belongs to this device. Supplying
            // deviceId here would route through the remote workspace-only preview API.
            workingDirectory: result.path.slice(0, result.path.lastIndexOf('/')),
            allowExternalFilePreview: true,
          });
      }
    } catch {
      logChatAttachment('message-file-action-failed', {
        id: attachment.attachmentId,
        reason: action,
      });
      setAvailable(false);
    } finally {
      setPending(undefined);
    }
  };

  if (compact)
    return (
      <MessageFileCard
        added={added}
        busy={!!pending}
        mime={attachment.mime}
        name={attachment.name}
        size={attachment.size}
        unavailable={!available}
        status={
          available === undefined
            ? t('localAttachment.checking')
            : available
              ? t('attachments.localFile')
              : t('localAttachment.unavailable')
        }
        onAdd={() => void run('add')}
        onPreview={() => void run('preview')}
      />
    );
  return (
    <Flexbox gap={8}>
      <Block horizontal align="center" gap={12} padding={12} variant="outlined">
        <FileIcon fileName={attachment.name} fileType={attachment.mime} size={32} />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Text ellipsis>{attachment.name}</Text>
          <Text fontSize={12} type="secondary">
            {formatSize(attachment.size)} ·{' '}
            {available === undefined
              ? t('localAttachment.checking')
              : available
                ? t('localAttachment.deviceOnly')
                : t('localAttachment.unavailable')}
          </Text>
        </Flexbox>
        <Button
          disabled={!available || !!pending}
          loading={pending === 'preview'}
          size="small"
          onClick={() => void run('preview')}
        >
          {t('localAttachment.preview')}
        </Button>
        <Button
          disabled={!available || !!pending}
          loading={pending === 'add'}
          size="small"
          onClick={() => void run('add')}
        >
          {t(added ? 'localAttachment.added' : 'localAttachment.addToInput')}
        </Button>
      </Block>
      {preview && (
        <ImageFileListViewer
          items={[{ id: attachment.attachmentId, alt: attachment.name, url: preview }]}
        />
      )}
    </Flexbox>
  );
});
export default LocalAttachmentItem;
