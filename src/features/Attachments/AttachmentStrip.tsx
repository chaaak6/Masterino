import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { RotateCcw, X } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useChatInputStore } from '@/features/ChatInput/store';
import FileViewer from '@/features/FileViewer';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';
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
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 160px;
    overflow-y: auto;
    padding: 4px 0;
  `,
  file: css`
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(100%, 250px);
    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  open: css`
    min-width: 0;
    flex: 1;
    cursor: pointer;
    background: none;
    border: 0;
    color: inherit;
    text-align: start;
    padding: 0;
  `,
}));

const AttachmentStrip = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const topicId = useChatStore((s) => s.activeTopicId);
  const draftKey = useChatInputStore((s) => s.draftKey);
  const setScope = useFileStore((s) => s.setChatAttachmentScope);
  useEffect(() => {
    setScope(draftKey || `${agentId}:${topicId || 'new'}`);
  }, [draftKey, agentId, topicId, setScope]);
  const [files, remove, retry] = useFileStore((s) => [
    s.chatUploadFileList,
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
    void remove(id).catch(() => logChatAttachment('cleanup-failed', { id }));
  const retryButton = (item: UploadFileItem) =>
    item.status === 'error' &&
    !['web-size', 'unsupported-format', 'local-failed'].includes(item.attachmentError || '') && (
      <ActionIcon
        aria-label={t('attachments.retry')}
        icon={RotateCcw}
        size="small"
        title={t('attachments.retry')}
        onClick={() => void retry(item.id, agentId, topicId)}
      />
    );
  const previewFile = (item: UploadFileItem) => {
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
              url: item.previewUrl || item.base64Url || item.fileUrl,
              onRemove: () => removeItem(item.id),
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
                disabled={!item.fileUrl && !item.previewUrl}
                title={item.file.name}
                type="button"
                onClick={() => previewFile(item)}
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
                onClick={() => removeItem(item.id)}
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
              <div key={item.id}>
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
