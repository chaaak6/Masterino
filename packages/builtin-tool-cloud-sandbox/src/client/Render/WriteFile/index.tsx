'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, Block, copyToClipboard, Flexbox, Highlighter, Text } from '@lobehub/ui';
import { Copy, Download, Eye } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HtmlPreviewDrawer, isHtmlFile } from '@/components/HtmlPreview';

import type { WriteLocalFileState } from '../../../types';

interface WriteLocalFileParams {
  content: string;
  createDirectories?: boolean;
  path: string;
}

/**
 * Get file extension from path
 */
const getFileExtension = (path: string): string => {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || 'text' : 'text';
};

/**
 * Map file extension to Highlighter language
 */
const getLanguageFromExtension = (ext: string): string => {
  const languageMap: Record<string, string> = {
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    scss: 'scss',
    sh: 'bash',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languageMap[ext] || 'text';
};

const WriteFile = memo<BuiltinRenderProps<WriteLocalFileParams, WriteLocalFileState>>(
  ({ args }) => {
    const { t } = useTranslation('plugin');
    const [previewOpen, setPreviewOpen] = useState(false);

    const filename = args.path.split(/[\\/]/).pop() || 'sandbox-file.txt';
    const isolatedMarkupFile =
      isHtmlFile({ fileName: filename }) || filename.toLowerCase().endsWith('.svg');

    const handleDownload = useCallback(() => {
      const mimeType = filename.toLowerCase().endsWith('.svg')
        ? 'image/svg+xml;charset=utf-8'
        : isolatedMarkupFile
          ? 'text/html;charset=utf-8'
          : 'text/plain;charset=utf-8';
      const blobUrl = URL.createObjectURL(new Blob([args.content], { type: mimeType }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    }, [args.content, filename, isolatedMarkupFile]);

    const handleCopy = useCallback(async () => {
      await copyToClipboard(args.content);
    }, [args.content]);

    if (args?.content === undefined) {
      return null;
    }

    const ext = getFileExtension(args.path);
    const language = getLanguageFromExtension(ext);

    return (
      <Block padding={8} variant={'outlined'}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} paddingInline={4}>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {filename}
          </Text>
          <Flexbox horizontal gap={4}>
            {isolatedMarkupFile && (
              <ActionIcon
                icon={Eye}
                size={'small'}
                title={t('builtins.lobe-cloud-sandbox.actions.preview')}
                onClick={() => setPreviewOpen(true)}
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
              title={t('builtins.lobe-cloud-sandbox.actions.copyContent')}
              onClick={handleCopy}
            />
          </Flexbox>
        </Flexbox>
        <Highlighter
          showLanguage
          wrap
          language={language}
          style={{ maxHeight: 400, overflow: 'auto' }}
          variant={'borderless'}
        >
          {args.content}
        </Highlighter>
        {isolatedMarkupFile && (
          <HtmlPreviewDrawer
            content={args.content}
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </Block>
    );
  },
);

WriteFile.displayName = 'WriteFile';

export default WriteFile;
