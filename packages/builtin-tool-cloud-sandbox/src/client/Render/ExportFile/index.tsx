'use client';

import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, copyToClipboard, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Copy, Download, Eye, RotateCcw } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import type { ExportFileState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
  statusIcon: css`
    font-size: 12px;
  `,
}));

interface ExportFileParams {
  path: string;
}

const ExportFile = memo<BuiltinRenderProps<ExportFileParams, ExportFileState>>(
  ({ args, messageId, pluginState }) => {
    const { t } = useTranslation('plugin');
    const [openFilePreview, reInvokeToolMessage] = useChatStore((s) => [
      s.openFilePreview,
      s.reInvokeToolMessage,
    ]);
    const isSuccess = pluginState?.success;

    const handleDownload = useCallback(() => {
      if (!pluginState?.downloadUrl || !pluginState?.filename) return;
      const separator = pluginState.downloadUrl.includes('?') ? '&' : '?';
      const link = document.createElement('a');
      link.href = `${pluginState.downloadUrl}${separator}download=1`;
      document.body.append(link);
      link.click();
      link.remove();
    }, [pluginState?.downloadUrl, pluginState?.filename]);

    const handleCopyLink = useCallback(async () => {
      if (!pluginState?.downloadUrl) return;
      const url = new URL(pluginState.downloadUrl, window.location.origin);
      url.searchParams.set('download', '1');
      await copyToClipboard(url.toString());
    }, [pluginState?.downloadUrl]);

    const handlePreview = useCallback(() => {
      if (pluginState?.fileId) openFilePreview({ fileId: pluginState.fileId });
    }, [openFilePreview, pluginState?.fileId]);

    const handleRetry = useCallback(async () => {
      await reInvokeToolMessage(messageId);
    }, [messageId, reInvokeToolMessage]);

    return (
      <Flexbox className={styles.container} gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          {pluginState === undefined ? null : isSuccess ? (
            <CheckCircleFilled
              className={styles.statusIcon}
              style={{ color: cssVar.colorSuccess }}
            />
          ) : (
            <CloseCircleFilled className={styles.statusIcon} style={{ color: cssVar.colorError }} />
          )}
          <Text code as={'span'} fontSize={12}>
            {isSuccess
              ? t('builtins.lobe-cloud-sandbox.export.success', {
                  filename: pluginState?.filename || args.path,
                })
              : t('builtins.lobe-cloud-sandbox.export.failed', { path: args.path })}
          </Text>
          {isSuccess && pluginState?.downloadUrl && (
            <>
              {pluginState.fileId && (
                <ActionIcon
                  icon={Eye}
                  size={'small'}
                  title={t('builtins.lobe-cloud-sandbox.actions.preview')}
                  onClick={handlePreview}
                />
              )}
              <ActionIcon
                icon={Download}
                size={'small'}
                title={t('builtins.lobe-cloud-sandbox.actions.download')}
                onClick={handleDownload}
              />
              <ActionIcon
                icon={Copy}
                size={'small'}
                title={t('builtins.lobe-cloud-sandbox.actions.copyLink')}
                onClick={handleCopyLink}
              />
            </>
          )}
          {!isSuccess && pluginState !== undefined && (
            <ActionIcon
              icon={RotateCcw}
              size={'small'}
              title={t('builtins.lobe-cloud-sandbox.actions.retry')}
              onClick={handleRetry}
            />
          )}
        </Flexbox>
        {!isSuccess && pluginState?.error?.message && (
          <Text fontSize={12} style={{ paddingInlineStart: 20 }} type={'secondary'}>
            {pluginState.error.message}
          </Text>
        )}
      </Flexbox>
    );
  },
);

ExportFile.displayName = 'ExportFile';

export default ExportFile;
