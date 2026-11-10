import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { RotateCcw, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import FileIcon from '@/components/FileIcon';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAttachmentScope } from '@/features/ChatInput/hooks/useAttachmentScope';
import { useChatInputStore } from '@/features/ChatInput/store';
import FileViewer from '@/features/FileViewer';
import {
  copyLocalAttachmentImage,
  previewLocalAttachment,
  revealLocalAttachmentImage,
} from '@/services/electron/localAttachmentService';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useFileStore } from '@/store/file';
import { getChatAttachmentDraft } from '@/store/file/slices/chat/drafts';
import { type UploadFileItem } from '@/types/files/upload';
import {
  CHAT_IMAGE_LIMIT,
  chatImageCount,
  isChatImage,
  logChatAttachment,
} from '@/utils/chatAttachments';
import { formatSize } from '@/utils/format';

import AttachmentSupport from './AttachmentSupport';
import ImageGallery from './ImageGallery';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    max-height: 160px;
    padding-block: 4px;
    padding-inline: 0;
  `,
  file: css`
    display: flex;
    gap: 8px;
    align-items: center;

    width: min(100%, 250px);
    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  open: css`
    cursor: pointer;

    flex: 1;

    min-width: 0;
    padding: 0;
    border: 0;

    color: inherit;
    text-align: start;

    background: none;
  `,
}));

const AttachmentStrip = memo(() => {
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const topicId = useChatInputStore((s) => s.topicId);
  const scope = useAttachmentScope();
  const [files, remove, retry] = useFileStore((s) => [
    getChatAttachmentDraft(s, scope).chatUploadFileList,
    s.removeChatUploadFile,
    s.retryChatUploadFile,
  ]);
  const images = files.filter((item) => isChatImage(item.file));
  const documents = files.filter((item) => !isChatImage(item.file));
  const status = (item: UploadFileItem) => {
    if (item.status === 'error' && item.fileUrl && item.attachmentError === 'unsupported-format')
      return t('attachments.uploadedUnsupported');
    if (item.status === 'error')
      return item.errorReason || t(`attachments.reason.${item.attachmentError || 'upload-failed'}`);
    if (item.status === 'pending') return t('attachments.preparing');
    if (item.status === 'uploading')
      return `${t('attachments.uploading')} ${Math.floor(item.uploadState?.progress ?? 0)}%`;
    if (item.status === 'processing')
      return t(
        item.processStage === 'content_parsing' ? 'attachments.parsing' : 'attachments.saving',
      );
    return t('attachments.ready');
  };
  const removeItem = (id: string) =>
    void remove(id, scope).catch(() => logChatAttachment('cleanup-failed', { id }));
  const retryButton = (item: UploadFileItem) =>
    item.status === 'error' &&
    !['web-size', 'unsupported-format', 'local-failed'].includes(item.attachmentError || '') && (
      <ActionIcon
        aria-label={t('attachments.retry')}
        icon={RotateCcw}
        size="small"
        title={t('attachments.retry')}
        onClick={() => void retry(item.uploadId || item.id, agentId, topicId, scope)}
      />
    );
  const imageActions = (item: UploadFileItem) => {
    const ref = item.attachment;
    if (ref?.source !== 'local') return {};
    if (ref.deviceId !== currentDeviceId || !window.electronAPI?.invoke) return { local: true };
    return {
      local: true,
      onCopy: () => copyLocalAttachmentImage(ref),
      onReveal: () => revealLocalAttachmentImage(ref),
    };
  };
  const previewFile = async (item: UploadFileItem) => {
    if (item.attachment?.source === 'local') {
      try {
        const result = await previewLocalAttachment(item.attachment, topicId || 'active');
        if (!result.path) throw new Error('Preview unavailable');
        useChatStore.getState().openLocalFile({
          filePath: result.path,
          workingDirectory: result.path.slice(0, result.path.lastIndexOf('/')),
          allowExternalFilePreview: true,
        });
      } catch {
        message.warning(t('localAttachment.unavailable'));
        logChatAttachment('preview-failed', {
          id: item.uploadId || item.id,
          reason: 'local-failed',
        });
      }
      return;
    }
    const url = item.previewUrl || item.fileUrl || item.base64Url;
    if (!url) return;
    createModal({
      title: item.file.name,
      footer: null,
      width: 'min(90vw, 1024px)',
      content: (
        <FileViewer
          chunkCount={null}
          chunkingError={null}
          createdAt={new Date()}
          embeddingError={null}
          fileType={item.file.type}
          finishEmbedding={false}
          id={item.id}
          name={item.file.name}
          size={item.file.size}
          sourceType="upload"
          updatedAt={new Date()}
          url={url}
        />
      ),
    });
  };
  return (
    <Flexbox gap={8} style={{ paddingBlockStart: files.length ? 8 : 0 }}>
      {images.length > 0 && (
        <>
          <Text aria-live="polite" fontSize={12} type="secondary">
            {t('attachments.imageCount', { count: chatImageCount(files), limit: CHAT_IMAGE_LIMIT })}
          </Text>
          <ImageGallery
            compact
            items={images.map((item) => ({
              id: item.uploadId || item.id,
              name: item.file.name,
              ...imageActions(item),
              url: item.previewUrl || item.base64Url || item.fileUrl,
              onRemove: () => removeItem(item.uploadId || item.id),
              caption: (
                <Flexbox gap={2}>
                  <Text
                    ellipsis
                    fontSize={11}
                    title={`${item.file.name} · ${item.attachment?.size ?? item.file.size} bytes`}
                  >
                    {item.file.name}
                  </Text>
                  <Text
                    fontSize={11}
                    role={item.status === 'error' ? 'alert' : 'status'}
                    type={item.status === 'error' ? 'danger' : 'secondary'}
                  >
                    {status(item)}
                  </Text>
                  {retryButton(item)}
                </Flexbox>
              ),
            }))}
          />
        </>
      )}
      {documents.length > 0 && (
        <div className={styles.row}>
          {documents.map((item) => (
            <div className={styles.file} key={item.uploadId || item.id}>
              <FileIcon fileName={item.file.name} size={28} />
              <button
                className={styles.open}
                title={item.file.name}
                type="button"
                disabled={
                  item.attachment?.source === 'local'
                    ? item.status !== 'success'
                    : !item.fileUrl && !item.previewUrl
                }
                onClick={() => void previewFile(item)}
              >
                <Text ellipsis fontSize={12}>
                  {item.file.name}
                </Text>
                <Text fontSize={11} type="secondary">
                  {formatSize(item.attachment?.size ?? item.file.size)}
                </Text>
                <Text
                  fontSize={11}
                  role={item.status === 'error' ? 'alert' : 'status'}
                  type={item.status === 'error' ? 'danger' : 'secondary'}
                >
                  {status(item)}
                </Text>
              </button>
              {retryButton(item)}
              <ActionIcon
                aria-label={t('attachments.remove', { name: item.file.name })}
                icon={X}
                size="small"
                title={t('attachments.remove', { name: item.file.name })}
                onClick={() => removeItem(item.uploadId || item.id)}
              />
            </div>
          ))}
        </div>
      )}
      {files.some((item) => item.status === 'error') && (
        <details style={{ fontSize: 12 }}>
          <summary>{t('attachments.details')}</summary>
          {files
            .filter((item) => item.status === 'error')
            .map((item) => (
              <div key={item.uploadId || item.id}>
                {item.file.name}: {item.attachment?.size ?? item.file.size} bytes ·{' '}
                {item.diagnostic?.stage || item.processStage} · {item.diagnostic?.status || '—'} ·{' '}
                {item.diagnostic?.message || item.attachmentError} · {item.uploadId || item.id}
              </div>
            ))}
        </details>
      )}
      <AttachmentSupport />
    </Flexbox>
  );
});
export default AttachmentStrip;
