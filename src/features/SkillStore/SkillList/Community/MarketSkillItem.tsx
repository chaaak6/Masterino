'use client';

import { ActionIcon, Avatar, Block, DropdownMenu, Flexbox, Icon, Modal, Tag } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar } from 'antd-style';
import { DownloadIcon, Loader2, MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { type DiscoverSkillItem } from '@/types/discover';
import { downloadFile } from '@/utils/client/downloadFile';

import { itemStyles } from '../style';

const MarketSkillDetail = lazy(() => import('../MarketSkills/MarketSkillDetail'));

const styles = createStaticStyles(({ css }) => ({
  title: css`
    cursor: pointer;

    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

const MarketSkillItem = memo<DiscoverSkillItem>(({ name, icon, description, identifier }) => {
  const { t } = useTranslation(['plugin', 'discover']);
  const { t: tc } = useTranslation('common');
  const [detailOpen, setDetailOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [loading, setLoading] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const installed = useToolStore(agentSkillsSelectors.isAgentSkill(identifier));
  const installedSkill = useToolStore(agentSkillsSelectors.getAgentSkillByIdentifier(identifier));
  const [refreshAgentSkills, deleteAgentSkill] = useToolStore((s) => [
    s.refreshAgentSkills,
    s.deleteAgentSkill,
  ]);

  const handleInstall = useCallback(async () => {
    if (!canCreate || installing) return;
    setInstalling(true);
    try {
      await agentSkillService.importFromMarket(identifier);
      await refreshAgentSkills();
    } catch (error) {
      const message = (error as Error).message;
      const conflict = message.startsWith('Your original skill differs from this release')
        ? t('publishing.originalConflict', { ns: 'discover' })
        : message.startsWith('This installed skill has local edits')
          ? t('publishing.installedConflict', { ns: 'discover' })
          : message.startsWith('A skill named ') &&
              message.endsWith('already exists. Remove it before installing this skill.')
            ? t('publishing.nameConflict', { name, ns: 'discover' })
            : message;
      toast.error(`${t('error.installError', { name })}: ${conflict}`);
    } finally {
      setInstalling(false);
    }
  }, [canCreate, identifier, installing, name, refreshAgentSkills, t]);

  const handleUninstall = useCallback(() => {
    if (!canEdit || !installedSkill) return;
    if (installedSkill.source === 'user' && installedSkill.publication?.identifier === identifier) {
      confirmModal({
        cancelText: tc('cancel'),
        content: t('publishing.unlinkDescription', { ns: 'discover' }),
        okText: t('publishing.unlink', { ns: 'discover' }),
        onOk: async () => {
          await agentSkillService.unlinkPublication(installedSkill.id, identifier);
          await refreshAgentSkills();
          toast.success(t('publishing.unlinked', { ns: 'discover' }));
        },
        title: t('publishing.unlink', { ns: 'discover' }),
      });
      return;
    }
    confirmModal({
      cancelText: tc('cancel'),
      content: t('store.actions.confirmUninstall'),
      okButtonProps: { danger: true },
      okText: t('store.actions.uninstall'),
      onOk: async () => {
        await deleteAgentSkill(installedSkill.id);
      },
      title: t('store.actions.uninstall'),
    });
  }, [canEdit, installedSkill, identifier, deleteAgentSkill, refreshAgentSkills, t, tc]);

  const handleDownload = useCallback(async () => {
    if (!installedSkill?.zipFileHash) return;
    setLoading(true);
    try {
      const result = await agentSkillService.getZipUrl(installedSkill.id);
      if (result.url) {
        await downloadFile(result.url, `${result.name || name}.zip`);
      }
    } finally {
      setLoading(false);
    }
  }, [installedSkill, name]);

  const renderAction = () => {
    if (installed) {
      return (
        <DropdownMenu
          nativeButton={false}
          placement="bottomRight"
          items={[
            {
              key: 'update',
              label: tc('update'),
              icon: <Icon icon={Plus} />,
              onClick: handleInstall,
              disabled: !canCreate || installing,
            },
            ...(installedSkill?.zipFileHash
              ? [
                  {
                    icon: <Icon icon={DownloadIcon} />,
                    key: 'download',
                    label: tc('download'),
                    onClick: handleDownload,
                  },
                  { type: 'divider' as const },
                ]
              : []),
            {
              danger: true,
              disabled: !canEdit,
              icon: <Icon icon={Trash2} />,
              key: 'uninstall',
              label:
                installedSkill?.source === 'user' &&
                installedSkill.publication?.identifier === identifier
                  ? t('publishing.unlink', { ns: 'discover' })
                  : t('store.actions.uninstall'),
              onClick: handleUninstall,
            },
          ]}
        >
          <ActionIcon disabled={!canEdit} icon={MoreVerticalIcon} loading={loading} />
        </DropdownMenu>
      );
    }

    if (installing) return <ActionIcon loading icon={Loader2} />;

    return (
      <ActionIcon
        disabled={!canCreate}
        icon={Plus}
        title={t('store.actions.install')}
        onClick={handleInstall}
      />
    );
  };

  return (
    <>
      <Flexbox className={itemStyles.container} gap={0}>
        <Block
          horizontal
          align={'center'}
          gap={12}
          paddingBlock={12}
          paddingInline={12}
          variant={'outlined'}
        >
          <Avatar avatar={icon || name} shape={'square'} size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.title} onClick={() => setDetailOpen(true)}>
                {name}
              </span>
              <Tag icon={<Icon icon={SkillsIcon} />} size={'small'} />
            </Flexbox>
            {description && <span className={itemStyles.description}>{description}</span>}
          </Flexbox>
          {renderAction()}
        </Block>
      </Flexbox>
      <Modal
        destroyOnHidden
        footer={null}
        open={detailOpen}
        styles={{ body: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } }}
        title={t('dev.title.skillDetails')}
        width={960}
        onCancel={() => setDetailOpen(false)}
      >
        <Suspense fallback={<div style={{ height: '100%' }} />}>
          <MarketSkillDetail identifier={identifier} />
        </Suspense>
      </Modal>
    </>
  );
});

MarketSkillItem.displayName = 'MarketSkillItem';

export default MarketSkillItem;
