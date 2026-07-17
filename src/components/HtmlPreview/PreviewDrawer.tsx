import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { exportFile } from '@lobechat/utils/client';
import {
  Block,
  Button,
  copyToClipboard,
  Flexbox,
  Highlighter,
  HtmlPreview,
  Segmented,
} from '@lobehub/ui';
import { App, Drawer } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Code2, Copy, Download, Eye } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';

import { getHtmlFileName } from './fileName';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    height: 100%;
  `,
}));

const hideHtmlPreviewActions = () => null;

interface HtmlPreviewDrawerProps {
  content: string;
  onClose: () => void;
  open: boolean;
}

const HtmlPreviewDrawer = memo<HtmlPreviewDrawerProps>(({ content, open, onClose }) => {
  const { t } = useTranslation('components');
  const { message } = App.useApp();
  const [mode, setMode] = useState<'preview' | 'code'>('preview');

  const htmlContent = content;

  const onDownload = useCallback(() => {
    exportFile(content, getHtmlFileName(content, `chat-html-preview-${Date.now()}`));
  }, [content]);

  const onCopy = useCallback(async () => {
    try {
      await copyToClipboard(content);
      message.success(t('HtmlPreview.actions.copySuccess'));
    } catch (error) {
      console.error('Failed to copy HTML preview content:', error);
      message.error(t('HtmlPreview.actions.copyFailed'));
    }
  }, [content, message, t]);

  const Title = (
    <Flexbox horizontal align={'center'} justify={'space-between'} style={{ width: '100%' }}>
      {t('HtmlPreview.title')}
      <Segmented
        value={mode}
        options={[
          {
            label: (
              <Flexbox horizontal align={'center'} gap={6}>
                <Eye size={16} />
                {t('HtmlPreview.mode.preview')}
              </Flexbox>
            ),
            value: 'preview',
          },
          {
            label: (
              <Flexbox horizontal align={'center'} gap={6}>
                <Code2 size={16} />
                {t('HtmlPreview.mode.code')}
              </Flexbox>
            ),
            value: 'code',
          },
        ]}
        onChange={(v) => setMode(v as 'preview' | 'code')}
      />
      <Flexbox horizontal gap={8}>
        <Button color={'default'} icon={<Copy size={16} />} variant={'filled'} onClick={onCopy}>
          {t('HtmlPreview.actions.copy')}
        </Button>
        <Button
          color={'default'}
          icon={<Download size={16} />}
          variant={'filled'}
          onClick={onDownload}
        >
          {t('HtmlPreview.actions.download')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Drawer
      destroyOnHidden
      height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
      open={open}
      placement="bottom"
      title={Title}
      styles={{
        body: { height: '100%', padding: 0 },
        header: { paddingBlock: 8, paddingInline: 12 },
      }}
      onClose={onClose}
    >
      {mode === 'preview' ? (
        <Block className={styles.container}>
          <HtmlPreview
            actionsRender={hideHtmlPreviewActions}
            copyable={false}
            downloadable={false}
            style={{ height: '100%' }}
            styles={{ iframe: { height: '100%' } }}
            title={t('HtmlPreview.iframeTitle')}
            variant={'borderless'}
          >
            {content}
          </HtmlPreview>
        </Block>
      ) : (
        <Block className={styles.container}>
          <Highlighter
            language={'html'}
            showLanguage={false}
            style={{ height: '100%', overflow: 'auto' }}
          >
            {htmlContent}
          </Highlighter>
        </Block>
      )}
    </Drawer>
  );
});

HtmlPreviewDrawer.displayName = 'HtmlPreviewDrawer';

export default HtmlPreviewDrawer;
