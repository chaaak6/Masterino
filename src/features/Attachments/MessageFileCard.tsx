import { ActionIcon, Text } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LoaderCircle, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { formatSize } from '@/utils/format';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    position: relative;

    display: flex;
    align-items: center;

    width: 184px;
    height: 72px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};

    transition: border-color 150ms;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  open: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    height: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 0;
    border-radius: inherit;

    color: inherit;
    text-align: start;

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    &:disabled {
      cursor: default;
    }
  `,
  info: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 0;
  `,
  menu: css`
    position: absolute;
    inset-block-start: 2px;
    inset-inline-end: 2px;

    border-radius: 6px;

    background: ${cssVar.colorBgContainer};
  `,
}));

export default function MessageFileCard({
  name,
  mime,
  size,
  status,
  busy,
  unavailable,
  onPreview,
  onAdd,
  added,
}: {
  name: string;
  mime: string;
  size: number;
  status?: string;
  busy?: boolean;
  unavailable?: boolean;
  onPreview: () => void;
  onAdd?: () => void;
  added?: boolean;
}) {
  const { t } = useTranslation('chat');
  return (
    <div className={styles.card}>
      <button
        aria-busy={busy}
        aria-label={t('attachments.previewFile', { name })}
        className={styles.open}
        disabled={unavailable || busy}
        title={name}
        type="button"
        onClick={onPreview}
      >
        {busy ? (
          <LoaderCircle aria-hidden size={28} />
        ) : (
          <FileIcon fileName={name} fileType={mime} size={28} />
        )}
        <span className={styles.info}>
          <Text ellipsis fontSize={13} style={{ paddingInlineEnd: onAdd ? 10 : 0 }}>
            {name}
          </Text>
          <Text ellipsis fontSize={11} title={status} type="secondary">
            {unavailable ? status : `${formatSize(size)}${status ? ` · ${status}` : ''}`}
          </Text>
        </span>
      </button>
      {onAdd && (
        <DropdownMenu
          items={[
            {
              key: 'preview',
              label: t('localAttachment.preview'),
              disabled: unavailable || busy,
              onClick: onPreview,
            },
            {
              key: 'add',
              label: t(added ? 'localAttachment.added' : 'localAttachment.addToInput'),
              disabled: unavailable || busy,
              onClick: onAdd,
            },
          ]}
        >
          <ActionIcon
            aria-label={t('attachments.fileActions', { name })}
            className={styles.menu}
            icon={MoreHorizontal}
            size="small"
            title={t('attachments.fileActions', { name })}
          />
        </DropdownMenu>
      )}
    </div>
  );
}
