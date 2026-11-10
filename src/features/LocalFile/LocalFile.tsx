import { Button, Flexbox, Popover } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { Space } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLink, FolderOpen } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;

    padding-block: 2px;
    padding-inline: 4px 8px;
    border-radius: 4px;

    color: ${cssVar.colorText};

    :hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    overflow: hidden;
    display: block;

    line-height: 20px;
    color: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface LocalFileProps {
  isDirectory?: boolean;
  name: string;
  path?: string;
  /**
   * When true, disable interactive actions (Open / Show in Folder).
   * Used in share pages where local file operations are not available.
   */
  readonly?: boolean;
}

export const LocalFile = ({
  name,
  path,
  isDirectory = false,
  readonly = false,
}: LocalFileProps) => {
  const { t } = useTranslation('components');

  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const run = async (folder: boolean) => {
    if (readonly || pending.current) return;
    if (!path) {
      toast.error(t('LocalFile.action.invalidPath'));
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const result = folder
        ? await localFileService.openFileFolder(path)
        : await localFileService.openLocalFileOrFolder(path, isDirectory);
      if (!result.success) throw new Error(result.error || t('LocalFile.action.unavailable'));
    } catch (error) {
      toast.error(
        t('LocalFile.action.failed', {
          reason: error instanceof Error ? error.message : t('LocalFile.action.unavailable'),
        }),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const handleOpenFile = () => {
    void run(false);
  };
  const handleOpenFolder = () => {
    void run(true);
  };

  const fileContent = (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={4}
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
      onClick={isDirectory && !readonly ? handleOpenFile : undefined}
    >
      <FileIcon fileName={name} isDirectory={isDirectory} size={22} variant={'raw'} />
      <Flexbox horizontal align={'baseline'} gap={4} style={{ overflow: 'hidden', width: '100%' }}>
        <div className={styles.title}>{name}</div>
      </Flexbox>
    </Flexbox>
  );

  // Directory or readonly mode (e.g. share page): no popover, just display
  if (isDirectory || readonly) {
    return fileContent;
  }

  // File: show popover with two actions
  const popoverContent = (
    <Space.Compact>
      <Button
        disabled={busy}
        icon={ExternalLink}
        size="small"
        title={t('LocalFile.action.open')}
        onClick={handleOpenFile}
      >
        {t('LocalFile.action.open')}
      </Button>
      <Button
        disabled={busy}
        icon={FolderOpen}
        size="small"
        title={t('LocalFile.action.showInFolder')}
        onClick={handleOpenFolder}
      >
        {t('LocalFile.action.showInFolder')}
      </Button>
    </Space.Compact>
  );

  return (
    <Popover
      content={popoverContent}
      trigger="hover"
      styles={{
        content: { padding: 0 },
      }}
    >
      {fileContent}
    </Popover>
  );
};
