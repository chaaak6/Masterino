import { ArtifactType } from '@lobechat/types';
import { exportFile } from '@lobechat/utils/client';
import { ActionIcon, Button, copyToClipboard, Flexbox, Icon, Segmented, Text } from '@lobehub/ui';
import { App, ConfigProvider } from 'antd';
import { cx } from 'antd-style';
import { ArrowLeft, CodeIcon, CopyIcon, DownloadIcon, EyeIcon } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { getHtmlFileName } from '@/components/HtmlPreview/fileName';
import { isHtmlFile } from '@/components/HtmlPreview/fileType';
import { agentDocumentService } from '@/services/agentDocument';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';
import { oneLineEllipsis } from '@/styles';

interface ArtifactPersistenceEntry {
  content: string;
  task: Promise<void>;
}

const artifactPersistenceEntries = new Map<string, ArtifactPersistenceEntry>();

const persistHtmlArtifact = (
  persistenceKey: string,
  params: Parameters<typeof agentDocumentService.writeByPath>[0],
) => {
  const currentEntry = artifactPersistenceEntries.get(persistenceKey);
  if (currentEntry?.content === params.content) return currentEntry.task;

  const previousTask = currentEntry?.task.catch(() => undefined) ?? Promise.resolve();
  const nextEntry: ArtifactPersistenceEntry = {
    content: params.content,
    task: Promise.resolve(),
  };

  nextEntry.task = previousTask
    .then(async () => {
      await agentDocumentService.writeByPath(params);
    })
    .catch((error) => {
      if (artifactPersistenceEntries.get(persistenceKey) === nextEntry) {
        artifactPersistenceEntries.delete(persistenceKey);
      }

      throw error;
    });
  artifactPersistenceEntries.set(persistenceKey, nextEntry);

  return nextEntry.task;
};

const Title = () => {
  const { message } = App.useApp();
  const { t } = useTranslation(['portal', 'components']);

  const [
    displayMode,
    artifactType,
    artifactTitle,
    artifactContent,
    artifactIdentifier,
    artifactMessageId,
    isArtifactTagClosed,
    agentId,
    closeArtifact,
  ] = useChatStore((s) => {
    const messageId = chatPortalSelectors.artifactMessageId(s) || '';
    const identifier = chatPortalSelectors.artifactIdentifier(s);

    return [
      s.portalArtifactDisplayMode,
      chatPortalSelectors.artifactType(s),
      chatPortalSelectors.artifactTitle(s),
      chatPortalSelectors.artifactCode(messageId, identifier)(s),
      identifier,
      messageId,
      chatPortalSelectors.isArtifactTagClosed(messageId, identifier)(s),
      s.activeAgentId,
      s.closeArtifact,
    ];
  });

  // show switch only when artifact is closed and the type is not code
  const showSwitch = isArtifactTagClosed && artifactType !== ArtifactType.Code;
  const isHtmlArtifact = !artifactType || isHtmlFile({ fileType: artifactType });
  const showHtmlActions = isArtifactTagClosed && isHtmlArtifact;

  const getDocumentFileName = useCallback(
    () =>
      getHtmlFileName(
        artifactContent,
        artifactTitle || artifactIdentifier || `artifact-${artifactMessageId}`,
      ),
    [artifactContent, artifactIdentifier, artifactMessageId, artifactTitle],
  );

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(artifactContent);
      message.success(t('HtmlPreview.actions.copySuccess', { ns: 'components' }));
    } catch (error) {
      console.error('Failed to copy HTML artifact content:', error);
      message.error(t('HtmlPreview.actions.copyFailed', { ns: 'components' }));
    }
  }, [artifactContent, message, t]);

  const handleDownload = useCallback(() => {
    exportFile(
      artifactContent,
      getHtmlFileName(artifactContent, `chat-html-preview-${Date.now()}`),
    );
  }, [artifactContent]);

  useEffect(() => {
    if (!showHtmlActions || !agentId || !artifactContent || !artifactMessageId) return;

    const persistenceKey = `${agentId}:${artifactMessageId}:${artifactIdentifier}`;
    const filename = getDocumentFileName();
    void persistHtmlArtifact(persistenceKey, {
      agentId,
      content: artifactContent,
      createMode: 'if-missing',
      path: `./${filename}`,
    }).catch((error) => {
      console.error('Failed to persist HTML artifact to agent documents:', error);
      message.error(t('artifacts.persistence.failed', { ns: 'portal' }));
    });
  }, [
    agentId,
    artifactContent,
    artifactIdentifier,
    artifactMessageId,
    getDocumentFileName,
    message,
    showHtmlActions,
    t,
  ]);

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={12} justify={'space-between'} width={'100%'}>
      <Flexbox horizontal align={'center'} flex={1} gap={4} style={{ minWidth: 0 }}>
        <ActionIcon icon={ArrowLeft} size={'small'} onClick={() => closeArtifact()} />
        <Text className={cx(oneLineEllipsis)} type={'secondary'}>
          {artifactTitle}
        </Text>
      </Flexbox>
      <ConfigProvider
        theme={{
          token: {
            borderRadiusSM: 16,
            borderRadiusXS: 16,
            fontSize: 12,
          },
        }}
      >
        {showSwitch && (
          <Segmented
            size={'small'}
            value={displayMode}
            options={[
              {
                icon: <Icon icon={EyeIcon} />,
                label: t('artifacts.display.preview'),
                value: ArtifactDisplayMode.Preview,
              },
              {
                icon: <Icon icon={CodeIcon} />,
                label: t('artifacts.display.code'),
                value: ArtifactDisplayMode.Code,
              },
            ]}
            onChange={(value) => {
              useChatStore.setState({ portalArtifactDisplayMode: value as ArtifactDisplayMode });
            }}
          />
        )}
      </ConfigProvider>
      {showHtmlActions && (
        <Flexbox horizontal gap={8}>
          <Button icon={<CopyIcon size={14} />} size={'small'} type={'text'} onClick={handleCopy}>
            {t('HtmlPreview.actions.copy', { ns: 'components' })}
          </Button>
          <Button
            icon={<DownloadIcon size={14} />}
            size={'small'}
            type={'text'}
            onClick={handleDownload}
          >
            {t('HtmlPreview.actions.download', { ns: 'components' })}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default Title;
